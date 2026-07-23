/* ---------------------------------------------------------------------
   IPv4 bit math
--------------------------------------------------------------------- */
function ipv4ToInt(ip) {
  const parts = ip.trim().split(".");
  if (parts.length !== 4) throw new Error(`"${ip}" is not a valid IPv4 address`);
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`"${ip}" is not a valid IPv4 address`);
    const n = Number(part);
    if (n < 0 || n > 255) throw new Error(`"${ip}" is not a valid IPv4 address`);
    result = (result << 8) + n;
  }
  return result >>> 0;
}

function intToIpv4(int) {
  return [24, 16, 8, 0].map(shift => (int >>> shift) & 255).join(".");
}

function cidrToMaskInt(prefix) {
  return prefix === 0 ? 0 : (0xFFFFFFFF << (32 - prefix)) >>> 0;
}

function parseCidr(cidrStr) {
  const [ipPart, prefixPart] = cidrStr.trim().split("/");
  if (prefixPart === undefined) throw new Error(`"${cidrStr}" must be in CIDR form, e.g. 10.0.0.0/8`);
  const prefix = Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`"${cidrStr}" has an invalid prefix length`);
  }
  const ipInt = ipv4ToInt(ipPart);
  const mask = cidrToMaskInt(prefix);
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return { cidrStr: `${intToIpv4(network)}/${prefix}`, network, prefix, mask, broadcast };
}

function cidrContainsIp(cidr, ipInt) {
  return (ipInt & cidr.mask) >>> 0 === cidr.network;
}

/* A strictly contains B when A's prefix is shorter (or equal-length+identical range treated as tie)
   and B's whole range falls inside A's range. Two distinct valid CIDR blocks are always either
   disjoint or one contains the other -- partial overlap between aligned CIDR blocks is impossible. */
function cidrContainsCidr(a, b) {
  if (a.prefix >= b.prefix) return false;
  return b.network >= a.network && b.broadcast <= a.broadcast;
}

/* ---------------------------------------------------------------------
   Router hops state
--------------------------------------------------------------------- */
let hops = [
  {
    id: 1,
    name: "Router 1",
    routes: [
      { cidr: "10.21.0.0/16", target: "local" },
      { cidr: "10.0.0.0/8", target: "tgw" },
      { cidr: "0.0.0.0/0", target: "nat" }
    ]
  }
];
let nextHopId = 2;
let activeHopId = 1;

function el(id) { return document.getElementById(id); }
function getActiveHop() { return hops.find(h => h.id === activeHopId); }

/* ---------------------------------------------------------------------
   Longest prefix match with evaluation trace
--------------------------------------------------------------------- */
function evaluateRoutes(routes, ipInt) {
  const parsed = routes.map((r, idx) => {
    let cidr = null, parseError = null;
    try { cidr = parseCidr(r.cidr); } catch (e) { parseError = e.message; }
    const matched = cidr ? cidrContainsIp(cidr, ipInt) : false;
    return { idx, route: r, cidr, parseError, matched };
  });

  const matches = parsed.filter(p => p.matched);
  let winner = null;
  if (matches.length > 0) {
    const maxPrefix = Math.max(...matches.map(m => m.cidr.prefix));
    const tied = matches.filter(m => m.cidr.prefix === maxPrefix);
    winner = tied[0]; // first-added wins ties (identical/duplicate CIDRs)
    winner.tieCount = tied.length;
  }

  // Present most-specific first, matching how LPM reasoning is usually narrated.
  const ordered = parsed.slice().sort((a, b) => {
    const pa = a.cidr ? a.cidr.prefix : -1;
    const pb = b.cidr ? b.cidr.prefix : -1;
    return pb - pa;
  });

  return { ordered, winner };
}

/* ---------------------------------------------------------------------
   Multi-hop trace: follows "next-hop" targets to the next router in
   the chain; anything else is terminal.
--------------------------------------------------------------------- */
function traceRoute(destIp) {
  const ipInt = ipv4ToInt(destIp);
  const trace = [];
  let currentIndex = hops.findIndex(h => h.id === activeHopId);
  if (currentIndex === -1) currentIndex = 0;
  const visited = new Set();

  for (let step = 0; step < hops.length + 1; step++) {
    const hop = hops[currentIndex];
    if (!hop) {
      trace.push({ hopName: null, outcome: "error", text: "next-hop points beyond the last configured router." });
      break;
    }
    if (visited.has(hop.id)) {
      trace.push({ hopName: hop.name, outcome: "error", text: `Loop detected: already visited "${hop.name}".` });
      break;
    }
    visited.add(hop.id);

    const evalResult = evaluateRoutes(hop.routes, ipInt);
    trace.push({ hopName: hop.name, hopId: hop.id, eval: evalResult, outcome: null });

    if (!evalResult.winner) {
      trace[trace.length - 1].outcome = "no-route";
      break;
    }

    const target = evalResult.winner.route.target.trim();
    if (target.toLowerCase() === "next-hop") {
      if (currentIndex + 1 >= hops.length) {
        trace[trace.length - 1].outcome = "misconfigured";
        break;
      }
      trace[trace.length - 1].outcome = "continue";
      currentIndex += 1;
      continue;
    }

    if (target.toLowerCase() === "drop") {
      trace[trace.length - 1].outcome = "drop";
    } else {
      trace[trace.length - 1].outcome = "terminal";
    }
    break;
  }

  return trace;
}

/* ---------------------------------------------------------------------
   Rendering: hop tabs + route table
--------------------------------------------------------------------- */
function renderHopTabs() {
  const tabsEl = el("hop-tabs");
  tabsEl.innerHTML = hops.map(h =>
    `<button class="hop-tab ${h.id === activeHopId ? "active" : ""}" data-hop="${h.id}">${h.name}</button>`
  ).join("");
  tabsEl.querySelectorAll(".hop-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      activeHopId = Number(btn.dataset.hop);
      renderAll();
    });
  });

  el("btn-remove-hop").disabled = hops.length <= 1;
  el("active-hop-title").textContent = getActiveHop().name;
}

function renderRoutesTable() {
  const hop = getActiveHop();
  const tbody = el("routes-tbody");
  tbody.innerHTML = hop.routes.map((r, idx) => `
    <tr>
      <td>${r.cidr}</td>
      <td>${r.target}</td>
      <td><button data-idx="${idx}" class="btn-del-route">Delete</button></td>
    </tr>`).join("");
  tbody.querySelectorAll(".btn-del-route").forEach(btn => {
    btn.addEventListener("click", () => {
      hop.routes.splice(Number(btn.dataset.idx), 1);
      renderAll();
    });
  });
}

el("btn-add-route").addEventListener("click", () => {
  const errorEl = el("route-error");
  errorEl.textContent = "";
  const cidrStr = el("new-cidr").value.trim();
  const target = el("new-target").value.trim();

  if (!cidrStr) { errorEl.textContent = "Enter a destination CIDR."; return; }
  if (!target) { errorEl.textContent = "Enter a target."; return; }
  try {
    parseCidr(cidrStr);
  } catch (e) {
    errorEl.textContent = e.message;
    return;
  }

  getActiveHop().routes.push({ cidr: cidrStr, target });
  el("new-cidr").value = "";
  el("new-target").value = "";
  renderAll();
});

el("btn-add-hop").addEventListener("click", () => {
  const id = nextHopId++;
  hops.push({ id, name: `Router ${hops.length + 1}`, routes: [] });
  activeHopId = id;
  renderAll();
});

el("btn-remove-hop").addEventListener("click", () => {
  if (hops.length <= 1) return;
  const idx = hops.findIndex(h => h.id === activeHopId);
  hops.splice(idx, 1);
  hops.forEach((h, i) => { h.name = `Router ${i + 1}`; });
  activeHopId = hops[Math.max(0, idx - 1)].id;
  renderAll();
});

/* ---------------------------------------------------------------------
   Rendering: nested CIDR "Venn-style" visualization
--------------------------------------------------------------------- */
const VIZ_COLORS = ["#5b8cff", "#34d1a1", "#ff9f5b", "#c084fc", "#ff6b9d", "#5bd1e0", "#ffd15b"];

function buildContainmentForest(routes) {
  const nodes = routes.map((r, idx) => {
    let cidr = null;
    try { cidr = parseCidr(r.cidr); } catch (e) { /* skip invalid */ }
    return { idx, route: r, cidr, children: [] };
  }).filter(n => n.cidr);

  const roots = [];
  for (const node of nodes) {
    // smallest range that still strictly contains this node
    let parent = null;
    for (const candidate of nodes) {
      if (candidate === node) continue;
      if (cidrContainsCidr(candidate.cidr, node.cidr)) {
        if (!parent || candidate.cidr.prefix > parent.cidr.prefix) parent = candidate;
      }
    }
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function renderVizNode(node, depth) {
  const color = VIZ_COLORS[depth % VIZ_COLORS.length];
  const childrenHtml = node.children.length
    ? `<div class="viz-children">${node.children.map(c => renderVizNode(c, depth + 1)).join("")}</div>`
    : "";
  return `<div class="viz-node" style="border-color:${color}">
    <div class="viz-label" style="color:${color}">${node.cidr.cidrStr}</div>
    <div class="viz-target">&rarr; ${node.route.target}</div>
    ${childrenHtml}
  </div>`;
}

function renderViz() {
  const hop = getActiveHop();
  const roots = buildContainmentForest(hop.routes);
  const vizEl = el("viz");
  if (roots.length === 0) {
    vizEl.innerHTML = `<p class="hint">No valid routes to visualize yet.</p>`;
    return;
  }
  vizEl.innerHTML = roots.map(r => renderVizNode(r, 0)).join("");
}

/* ---------------------------------------------------------------------
   Rendering: trace result
--------------------------------------------------------------------- */
function outcomeLabel(outcome, target) {
  switch (outcome) {
    case "terminal": return `Delivered via target "${target}"`;
    case "drop": return `Dropped (explicit black-hole route)`;
    case "no-route": return `No route matched — destination unreachable`;
    case "continue": return `Forwards to next hop`;
    case "misconfigured": return `Misconfigured: "next-hop" but no further router exists`;
    case "error": return "Error";
    default: return "";
  }
}

function renderEvalLine(p) {
  if (p.parseError) {
    return `<div class="eval-line">Matched ${p.route.cidr}? invalid CIDR (${p.parseError})</div>`;
  }
  const isWinner = false; // set by caller via class below
  return `<div class="eval-line ${p.matched ? "matched" : ""}">Matched ${p.cidr.cidrStr}? ${p.matched ? "Yes" : "No"} (prefix /${p.cidr.prefix}, target "${p.route.target}")</div>`;
}

function renderTrace(destIp, trace) {
  el("result-card").hidden = false;
  const container = el("hop-trace");
  container.innerHTML = trace.map(step => {
    if (step.outcome === "error") {
      return `<div class="hop-block"><h3>${step.hopName || "Routing"}</h3><div class="eval-line">${step.text}</div></div>`;
    }

    const lines = step.eval.ordered.map(p => {
      const isWinner = step.eval.winner && p.idx === step.eval.winner.idx;
      const base = renderEvalLine(p);
      return isWinner ? base.replace('class="eval-line matched"', 'class="eval-line winner"') : base;
    }).join("");

    let winnerNote = "";
    if (step.eval.winner) {
      const w = step.eval.winner;
      const dupNote = w.tieCount > 1 ? ` (${w.tieCount} identical routes tied — first one added was used)` : "";
      winnerNote = `<div class="hop-outcome">Longest prefix match: <strong>${w.cidr.cidrStr}</strong> (/${w.cidr.prefix}) &rarr; target "${w.route.target}"${dupNote}. ${outcomeLabel(step.outcome, w.route.target)}.</div>`;
    } else {
      winnerNote = `<div class="hop-outcome">${outcomeLabel(step.outcome)}.</div>`;
    }

    return `<div class="hop-block"><h3>${step.hopName}</h3>${lines}${winnerNote}</div>`;
  }).join("");

  const last = trace[trace.length - 1];
  const finalEl = el("final-answer");
  if (last.outcome === "terminal") {
    finalEl.className = "final-answer ok";
    finalEl.textContent = `${destIp} is routed to target "${last.eval.winner.route.target}" via ${last.hopName}, matching ${last.eval.winner.cidr.cidrStr}.`;
  } else if (last.outcome === "drop") {
    finalEl.className = "final-answer drop";
    finalEl.textContent = `${destIp} is dropped at ${last.hopName} by an explicit black-hole route (${last.eval.winner.cidr.cidrStr}).`;
  } else if (last.outcome === "no-route") {
    finalEl.className = "final-answer drop";
    finalEl.textContent = `${destIp} has no matching route at ${last.hopName} — destination unreachable.`;
  } else {
    finalEl.className = "final-answer drop";
    finalEl.textContent = `Routing did not complete: ${step_text(last)}`;
  }
}

function step_text(last) {
  return last.text || outcomeLabel(last.outcome);
}

/* ---------------------------------------------------------------------
   Trace button
--------------------------------------------------------------------- */
el("btn-trace").addEventListener("click", () => {
  const errorEl = el("trace-error");
  errorEl.textContent = "";
  const destIp = el("dest-ip").value.trim();

  let ipInt;
  try {
    ipInt = ipv4ToInt(destIp);
  } catch (e) {
    errorEl.textContent = e.message;
    el("result-card").hidden = true;
    return;
  }

  const trace = traceRoute(destIp);
  renderTrace(destIp, trace);
});

el("dest-ip").addEventListener("keydown", e => { if (e.key === "Enter") el("btn-trace").click(); });

/* ---------------------------------------------------------------------
   Full render
--------------------------------------------------------------------- */
function renderAll() {
  renderHopTabs();
  renderRoutesTable();
  renderViz();
}

renderAll();
