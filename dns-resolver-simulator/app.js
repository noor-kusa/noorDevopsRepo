/* ---------------------------------------------------------------------
   Fake DNS database: zones keyed by fully-qualified zone name.
   Each zone holds a flat list of records: {name, type, value, ttl}
   name/zone keys are always fully qualified with a trailing dot.
--------------------------------------------------------------------- */
const STORAGE_KEY = "dnsSimDB.v1";

function defaultDB() {
  return {
    zones: {
      ".": {
        records: [
          { name: "com.", type: "NS", value: "a.gtld-servers.net.", ttl: 518400 }
        ]
      },
      "com.": {
        records: [
          { name: "example.com.", type: "NS", value: "ns1.example-dns.com.", ttl: 172800 }
        ]
      },
      "example.com.": {
        records: [
          { name: "example.com.", type: "NS", value: "ns1.example-dns.com.", ttl: 86400 },
          { name: "example.com.", type: "A", value: "93.184.216.34", ttl: 300 },
          { name: "example.com.", type: "MX", value: "10 mail.example.com.", ttl: 3600 },
          { name: "example.com.", type: "TXT", value: "v=spf1 -all", ttl: 3600 },
          { name: "mail.example.com.", type: "A", value: "93.184.216.35", ttl: 300 },
          { name: "www.example.com.", type: "CNAME", value: "example.com.", ttl: 300 },
          { name: "shop.example.com.", type: "CNAME", value: "www.example.com.", ttl: 300 }
        ]
      }
    }
  };
}

function loadDB() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupted storage */ }
  return defaultDB();
}

function saveDB() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
}

let db = loadDB();

/* ---------------------------------------------------------------------
   Name helpers
--------------------------------------------------------------------- */
function normalizeName(name) {
  name = name.trim().toLowerCase();
  if (name === "" || name === ".") return ".";
  if (!name.endsWith(".")) name += ".";
  return name;
}

function isSuffix(name, zoneKey) {
  if (zoneKey === ".") return true;
  return name === zoneKey || name.endsWith("." + zoneKey);
}

/* ---------------------------------------------------------------------
   Resolution engine
   Walks root -> ... -> authoritative zone for `name`, following NS
   referrals by longest-suffix match, then follows CNAME chains by
   restarting the walk at the target name. Produces a flat `steps` log.
--------------------------------------------------------------------- */
function findReferral(zone, currentZoneKey, name) {
  let best = null;
  for (const rec of zone.records) {
    if (rec.type !== "NS") continue;
    if (rec.name === currentZoneKey) continue; // not a deeper delegation
    if (!isSuffix(name, rec.name)) continue;
    if (!db.zones[rec.name]) continue; // no zone data for that delegation
    if (!best || rec.name.length > best.name.length) best = rec;
  }
  return best;
}

function findAnswer(zone, name, type) {
  return zone.records.filter(r => r.name === name && r.type === type);
}

function findCname(zone, name) {
  return zone.records.find(r => r.name === name && r.type === "CNAME");
}

function walkFromRoot(name, type, steps) {
  let currentZoneKey = ".";
  const MAX_HOPS = 10;

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const zone = db.zones[currentZoneKey];
    if (!zone) {
      steps.push({ kind: "error", text: `Zone "${currentZoneKey}" has no data in the fake database.` });
      return { error: "zone-missing" };
    }

    const answers = findAnswer(zone, name, type);
    if (answers.length > 0) {
      steps.push({
        kind: "answer",
        zoneKey: currentZoneKey,
        name, type,
        records: answers
      });
      return { answers };
    }

    const cname = findCname(zone, name);
    if (cname) {
      steps.push({
        kind: "cname",
        zoneKey: currentZoneKey,
        name,
        target: cname.value,
        ttl: cname.ttl
      });
      return { cname };
    }

    const referral = findReferral(zone, currentZoneKey, name);
    if (referral) {
      steps.push({
        kind: "referral",
        fromZoneKey: currentZoneKey,
        toZoneKey: referral.name,
        server: referral.value,
        ttl: referral.ttl
      });
      currentZoneKey = referral.name;
      continue;
    }

    steps.push({
      kind: "nxdomain",
      zoneKey: currentZoneKey,
      name, type,
      text: `"${currentZoneKey}" is authoritative for this name but holds no ${type} record for "${name}".`
    });
    return { error: "nxdomain" };
  }

  steps.push({ kind: "error", text: "Too many referral hops (possible misconfigured delegation)." });
  return { error: "too-many-hops" };
}

function resolve(rawName, type) {
  const name = normalizeName(rawName);
  const steps = [];
  const visited = new Set();
  let currentName = name;
  let finalAnswer = null;
  let error = null;

  for (let chainHop = 0; chainHop < 8; chainHop++) {
    if (visited.has(currentName)) {
      steps.push({ kind: "error", text: `CNAME loop detected at "${currentName}".` });
      error = "cname-loop";
      break;
    }
    visited.add(currentName);

    const result = walkFromRoot(currentName, type, steps);

    if (result.answers) {
      finalAnswer = { name: currentName, records: result.answers };
      break;
    }
    if (result.cname) {
      currentName = normalizeName(result.cname.value);
      continue;
    }
    error = result.error || "unknown";
    break;
  }

  return { queriedName: name, type, steps, finalAnswer, error };
}

/* ---------------------------------------------------------------------
   TTL cache
--------------------------------------------------------------------- */
let cache = new Map(); // key `${name}|${type}` -> {name, type, records, expiresAt}

function cacheKey(name, type) { return `${name}|${type}`; }

function getCached(name, type) {
  const entry = cache.get(cacheKey(name, type));
  if (!entry) return null;
  if (Date.now() >= entry.expiresAt) {
    cache.delete(cacheKey(name, type));
    return null;
  }
  return entry;
}

function setCached(name, type, records) {
  const ttl = Math.min(...records.map(r => r.ttl));
  cache.set(cacheKey(name, type), {
    name, type, records,
    ttl,
    cachedAt: Date.now(),
    expiresAt: Date.now() + ttl * 1000
  });
}

/* ---------------------------------------------------------------------
   Rendering: resolution path
--------------------------------------------------------------------- */
function el(id) { return document.getElementById(id); }

function hopHtml(kind, title, detail) {
  return `<div class="hop ${kind}">
    <div class="hop-title">${title}</div>
    ${detail ? `<div class="hop-detail">${detail}</div>` : ""}
  </div>`;
}

function renderSteps(steps) {
  const hopsEl = el("hops");
  hopsEl.innerHTML = steps.map(step => {
    switch (step.kind) {
      case "referral":
        return hopHtml("referral",
          `Referral: "${step.fromZoneKey}" zone doesn't have the answer, refers to "${step.toZoneKey}" name servers`,
          `${step.toZoneKey}  ${step.ttl}  IN  NS  ${step.server}`);
      case "cname":
        return hopHtml("cname",
          `CNAME found at "${step.zoneKey}": "${step.name}" is an alias`,
          `${step.name}  ${step.ttl}  IN  CNAME  ${step.target}`);
      case "answer":
        return hopHtml("answer",
          `Answer from "${step.zoneKey}" (authoritative)`,
          step.records.map(r => `${r.name}  ${r.ttl}  IN  ${r.type}  ${r.value}`).join("<br>"));
      case "nxdomain":
        return hopHtml("error-hop", `No record found`, step.text);
      case "cached":
        return hopHtml("cached", `Served from cache`, step.text);
      case "error":
      default:
        return hopHtml("error-hop", `Error`, step.text);
    }
  }).join("");
}

function renderFinalAnswer(result, fromCache) {
  const finalEl = el("final-answer");
  if (!result.finalAnswer) {
    finalEl.hidden = false;
    finalEl.textContent = `Lookup failed for ${result.queriedName} (${result.type}): ${result.error}`;
    finalEl.style.borderColor = "var(--error)";
    finalEl.style.background = "color-mix(in srgb, var(--error) 15%, transparent)";
    return;
  }
  finalEl.hidden = false;
  finalEl.style.borderColor = "var(--good)";
  finalEl.style.background = "color-mix(in srgb, var(--good) 15%, transparent)";
  const recs = result.finalAnswer.records.map(r => `${r.name} ${r.ttl} IN ${r.type} ${r.value}`).join("\n");
  finalEl.textContent = (fromCache ? "[CACHED] " : "") + `Answer:\n${recs}`;
}

/* ---------------------------------------------------------------------
   dig +trace style text output
--------------------------------------------------------------------- */
function buildTraceText(result, fromCache) {
  const lines = [];
  lines.push(`; <<>> DigSim 1.0 <<>> ${result.queriedName} ${result.type}`);
  lines.push(`;; global options: +cmd`);
  lines.push(`;; QUESTION SECTION:`);
  lines.push(`;${result.queriedName.padEnd(24)} IN  ${result.type}`);
  lines.push("");

  if (fromCache) {
    lines.push(`;; Answer already cached from a previous lookup, TTL not yet expired.`);
    lines.push("");
  }

  for (const step of result.steps) {
    if (step.kind === "referral") {
      lines.push(`${step.toZoneKey.padEnd(24)} ${String(step.ttl).padEnd(7)} IN  NS  ${step.server}`);
      lines.push(`;; Received referral to ${step.toZoneKey} name servers.`);
      lines.push("");
    } else if (step.kind === "cname") {
      lines.push(`${step.name.padEnd(24)} ${String(step.ttl).padEnd(7)} IN  CNAME  ${step.target}`);
      lines.push(`;; Following CNAME to ${step.target}`);
      lines.push("");
    } else if (step.kind === "answer") {
      lines.push(`;; ANSWER SECTION:`);
      step.records.forEach(r => {
        lines.push(`${r.name.padEnd(24)} ${String(r.ttl).padEnd(7)} IN  ${r.type}  ${r.value}`);
      });
      lines.push("");
    } else if (step.kind === "nxdomain" || step.kind === "error") {
      lines.push(`;; ${step.text}`);
      lines.push("");
    }
  }

  lines.push(`;; Query time: ${5 + Math.floor(Math.random() * 40)} msec`);
  lines.push(`;; WHEN: ${new Date().toString()}`);
  lines.push(`;; (SIMULATED — no real network query was made)`);
  return lines.join("\n");
}

/* ---------------------------------------------------------------------
   Lookup flow
--------------------------------------------------------------------- */
function runLookup() {
  const rawName = el("lookup-name").value;
  const type = el("lookup-type").value;
  const errorEl = el("lookup-error");
  errorEl.textContent = "";

  if (!rawName.trim()) {
    errorEl.textContent = "Enter a domain name.";
    return;
  }

  const name = normalizeName(rawName);
  const cached = getCached(name, type);

  el("path-card").hidden = false;
  el("trace-card").hidden = false;

  if (cached) {
    const remaining = Math.max(0, Math.round((cached.expiresAt - Date.now()) / 1000));
    const steps = [{
      kind: "cached",
      text: `"${name}" (${type}) was resolved earlier and is still cached (${remaining}s remaining of its ${cached.ttl}s TTL).`
    }];
    renderSteps(steps);
    const fauxResult = { queriedName: name, type, steps, finalAnswer: { name, records: cached.records }, error: null };
    renderFinalAnswer(fauxResult, true);
    el("trace-output").textContent = buildTraceText(fauxResult, true);
    renderCacheTable();
    return;
  }

  const result = resolve(name, type);
  renderSteps(result.steps);
  renderFinalAnswer(result, false);
  el("trace-output").textContent = buildTraceText(result, false);

  if (result.finalAnswer) {
    setCached(result.finalAnswer.name, type, result.finalAnswer.records);
  }
  renderCacheTable();
}

el("btn-resolve").addEventListener("click", runLookup);
el("lookup-name").addEventListener("keydown", e => { if (e.key === "Enter") runLookup(); });

el("btn-clear-cache").addEventListener("click", () => {
  cache.clear();
  renderCacheTable();
});

/* ---------------------------------------------------------------------
   Cache table with live TTL countdown
--------------------------------------------------------------------- */
function renderCacheTable() {
  const tbody = el("cache-tbody");
  tbody.innerHTML = "";
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now >= entry.expiresAt) { cache.delete(key); continue; }
    const remaining = Math.max(0, Math.round((entry.expiresAt - now) / 1000));
    const pct = Math.max(0, Math.min(100, (remaining / entry.ttl) * 100));
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${entry.name}</td><td>${entry.type}</td>
      <td>${entry.records.map(r => r.value).join(", ")}</td>
      <td><span class="ttl-bar-wrap"><span class="ttl-bar-fill" style="width:${pct}%"></span></span>${remaining}s</td>
      <td><button data-key="${key}" class="btn-evict">Evict</button></td>`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll(".btn-evict").forEach(btn => {
    btn.addEventListener("click", () => {
      cache.delete(btn.dataset.key);
      renderCacheTable();
    });
  });
}

setInterval(renderCacheTable, 1000);

/* ---------------------------------------------------------------------
   Admin panel
--------------------------------------------------------------------- */
el("btn-toggle-admin").addEventListener("click", () => {
  const body = el("admin-body");
  body.hidden = !body.hidden;
  el("btn-toggle-admin").textContent = body.hidden ? "Show" : "Hide";
  if (!body.hidden) renderAdmin();
});

function renderAdmin() {
  const zoneKeys = Object.keys(db.zones);

  const zonesTbody = el("zones-tbody");
  zonesTbody.innerHTML = zoneKeys.map(key => {
    const zone = db.zones[key];
    const deletable = key !== "." ;
    return `<tr><td>${key}</td><td>${zone.records.length}</td>
      <td>${deletable ? `<button data-zone="${key}" class="btn-del-zone">Delete</button>` : ""}</td></tr>`;
  }).join("");
  zonesTbody.querySelectorAll(".btn-del-zone").forEach(btn => {
    btn.addEventListener("click", () => {
      delete db.zones[btn.dataset.zone];
      saveDB();
      renderAdmin();
    });
  });

  const parentSelect = el("new-zone-parent");
  parentSelect.innerHTML = zoneKeys.map(k => `<option value="${k}">${k}</option>`).join("");

  const recordZoneSelect = el("record-zone-select");
  const prevSelected = recordZoneSelect.value;
  recordZoneSelect.innerHTML = zoneKeys.map(k => `<option value="${k}">${k}</option>`).join("");
  if (zoneKeys.includes(prevSelected)) recordZoneSelect.value = prevSelected;

  renderRecordsTable();
}

function renderRecordsTable() {
  const zoneKey = el("record-zone-select").value;
  const zone = db.zones[zoneKey];
  const tbody = el("records-tbody");
  if (!zone) { tbody.innerHTML = ""; return; }

  tbody.innerHTML = zone.records.map((rec, idx) => `
    <tr>
      <td>${rec.name}</td><td>${rec.type}</td><td>${rec.value}</td><td>${rec.ttl}</td>
      <td><button data-idx="${idx}" class="btn-del-record">Delete</button></td>
    </tr>`).join("");

  tbody.querySelectorAll(".btn-del-record").forEach(btn => {
    btn.addEventListener("click", () => {
      zone.records.splice(Number(btn.dataset.idx), 1);
      saveDB();
      renderAdmin();
    });
  });
}

el("record-zone-select").addEventListener("change", renderRecordsTable);

el("btn-add-zone").addEventListener("click", () => {
  const errorEl = el("zone-error");
  errorEl.textContent = "";

  const newKeyRaw = el("new-zone-name").value.trim().toLowerCase();
  const parent = el("new-zone-parent").value;
  const nsHost = el("new-zone-ns").value.trim();
  const ttl = Number(el("new-zone-ttl").value);

  if (!newKeyRaw) { errorEl.textContent = "Enter a zone name."; return; }
  const newKey = normalizeName(newKeyRaw);
  if (db.zones[newKey]) { errorEl.textContent = "That zone already exists."; return; }
  if (!nsHost) { errorEl.textContent = "Enter a delegated name server hostname."; return; }
  if (!Number.isFinite(ttl) || ttl <= 0) { errorEl.textContent = "TTL must be a positive number."; return; }

  db.zones[newKey] = { records: [{ name: newKey, type: "NS", value: normalizeName(nsHost), ttl }] };
  db.zones[parent].records.push({ name: newKey, type: "NS", value: normalizeName(nsHost), ttl });

  saveDB();
  el("new-zone-name").value = "";
  el("new-zone-ns").value = "";
  renderAdmin();
});

el("btn-add-record").addEventListener("click", () => {
  const errorEl = el("record-error");
  errorEl.textContent = "";

  const zoneKey = el("record-zone-select").value;
  const zone = db.zones[zoneKey];
  const nameRaw = el("rec-name").value.trim();
  const type = el("rec-type").value;
  const value = el("rec-value").value.trim();
  const ttl = Number(el("rec-ttl").value);

  if (!zone) { errorEl.textContent = "Select a zone first."; return; }
  if (!nameRaw) { errorEl.textContent = "Enter a record name."; return; }
  if (!value) { errorEl.textContent = "Enter a value."; return; }
  if (!Number.isFinite(ttl) || ttl <= 0) { errorEl.textContent = "TTL must be a positive number."; return; }

  const name = normalizeName(nameRaw);
  if (!isSuffix(name, zoneKey)) {
    errorEl.textContent = `Warning: "${name}" is not within "${zoneKey}" — added anyway, but it won't be reachable by the resolver.`;
  }

  zone.records.push({ name, type, value: type === "A" || type === "CNAME" ? value : value, ttl });
  saveDB();
  el("rec-name").value = "";
  el("rec-value").value = "";
  renderAdmin();
});

el("btn-reset-db").addEventListener("click", () => {
  db = defaultDB();
  saveDB();
  cache.clear();
  renderAdmin();
  renderCacheTable();
});

/* Initial admin render (hidden but keeps selects populated) */
renderAdmin();
