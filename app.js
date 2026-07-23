/* ---------------------------------------------------------------------
   Tab switching
--------------------------------------------------------------------- */
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

/* ---------------------------------------------------------------------
   IPv4 core bit math
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
  if (prefix === 0) return 0;
  return (0xFFFFFFFF << (32 - prefix)) >>> 0;
}

function parseIpv4Cidr(input) {
  const [ipPart, prefixPart] = input.trim().split("/");
  if (prefixPart === undefined) throw new Error("Enter address in CIDR form, e.g. 192.168.1.0/24");
  const prefix = Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error("CIDR prefix must be an integer between 0 and 32");
  }
  const ipInt = ipv4ToInt(ipPart);
  return { ipInt, prefix };
}

function classifyIpv4Class(firstOctet) {
  if (firstOctet === 0) return "Reserved (this network)";
  if (firstOctet >= 1 && firstOctet <= 126) return "A";
  if (firstOctet === 127) return "A (Loopback range)";
  if (firstOctet >= 128 && firstOctet <= 191) return "B";
  if (firstOctet >= 192 && firstOctet <= 223) return "C";
  if (firstOctet >= 224 && firstOctet <= 239) return "D (Multicast)";
  return "E (Reserved/Experimental)";
}

function isInCidr(ipInt, netStr, prefix) {
  const netInt = ipv4ToInt(netStr);
  const mask = cidrToMaskInt(prefix);
  return (ipInt & mask) >>> 0 === (netInt & mask) >>> 0;
}

function classifyIpv4Scope(ipInt) {
  if (ipInt === 0xFFFFFFFF) return "Broadcast (Reserved)";
  if (isInCidr(ipInt, "127.0.0.0", 8)) return "Loopback";
  if (isInCidr(ipInt, "169.254.0.0", 16)) return "Link-Local";
  if (isInCidr(ipInt, "10.0.0.0", 8)) return "Private";
  if (isInCidr(ipInt, "172.16.0.0", 12)) return "Private";
  if (isInCidr(ipInt, "192.168.0.0", 16)) return "Private";
  if (isInCidr(ipInt, "100.64.0.0", 10)) return "Carrier-Grade NAT (Shared)";
  if (isInCidr(ipInt, "224.0.0.0", 4)) return "Multicast";
  if (isInCidr(ipInt, "240.0.0.0", 4)) return "Reserved";
  if (isInCidr(ipInt, "0.0.0.0", 8)) return "Reserved (this network)";
  return "Public";
}

function computeIpv4Subnet(ipInt, prefix) {
  const mask = cidrToMaskInt(prefix);
  const wildcard = (~mask) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | wildcard) >>> 0;
  const total = Math.pow(2, 32 - prefix);

  let first, last, usable;
  if (prefix >= 31) {
    // /31 point-to-point (RFC 3021) and /32 host route: no network/broadcast distinction
    first = network;
    last = broadcast;
    usable = prefix === 31 ? 2 : 1;
  } else {
    first = (network + 1) >>> 0;
    last = (broadcast - 1) >>> 0;
    usable = total - 2;
  }

  return { mask, wildcard, network, broadcast, first, last, total, usable };
}

/* ---------------------------------------------------------------------
   IPv4 UI wiring
--------------------------------------------------------------------- */
let lastIpv4 = null;

function runIpv4Calc() {
  const input = document.getElementById("ipv4-input").value;
  const errorEl = document.getElementById("ipv4-error");
  const resultsEl = document.getElementById("ipv4-results");
  const splitCard = document.getElementById("ipv4-split-card");
  errorEl.textContent = "";

  let parsed;
  try {
    parsed = parseIpv4Cidr(input);
  } catch (e) {
    errorEl.textContent = e.message;
    resultsEl.hidden = true;
    splitCard.hidden = true;
    lastIpv4 = null;
    return;
  }

  const { ipInt, prefix } = parsed;
  const firstOctet = (ipInt >>> 24) & 255;
  const subnet = computeIpv4Subnet(ipInt, prefix);
  const scope = classifyIpv4Scope(ipInt);

  document.getElementById("r-class").textContent = classifyIpv4Class(firstOctet);
  document.getElementById("r-scope").textContent = scope;
  document.getElementById("r-mask").textContent = intToIpv4(subnet.mask) + ` (/${prefix})`;
  document.getElementById("r-wildcard").textContent = intToIpv4(subnet.wildcard);
  document.getElementById("r-network").textContent = intToIpv4(subnet.network);
  document.getElementById("r-broadcast").textContent = intToIpv4(subnet.broadcast);
  document.getElementById("r-first").textContent = intToIpv4(subnet.first);
  document.getElementById("r-last").textContent = intToIpv4(subnet.last);
  document.getElementById("r-total").textContent = subnet.total.toLocaleString();
  document.getElementById("r-usable").textContent = subnet.usable.toLocaleString();
  document.getElementById("r-public").textContent = scope === "Public" ? "Public" : `Private/Special (${scope})`;

  resultsEl.hidden = false;
  splitCard.hidden = false;
  document.getElementById("split-viz").hidden = true;
  document.getElementById("split-table").hidden = true;

  lastIpv4 = { ipInt, prefix, network: subnet.network };
}

document.getElementById("ipv4-calc").addEventListener("click", runIpv4Calc);
document.getElementById("ipv4-input").addEventListener("keydown", e => {
  if (e.key === "Enter") runIpv4Calc();
});

/* ---------------------------------------------------------------------
   Split into N equal subnets
--------------------------------------------------------------------- */
function runSplitCalc() {
  const errorEl = document.getElementById("split-error");
  const vizEl = document.getElementById("split-viz");
  const tableEl = document.getElementById("split-table");
  const tbody = document.getElementById("split-tbody");
  errorEl.textContent = "";
  vizEl.hidden = true;
  tableEl.hidden = true;
  vizEl.innerHTML = "";
  tbody.innerHTML = "";

  if (!lastIpv4) {
    errorEl.textContent = "Calculate a network first.";
    return;
  }

  const n = Number(document.getElementById("split-n").value);
  if (!Number.isInteger(n) || n < 2) {
    errorEl.textContent = "Enter an integer number of subnets, 2 or greater.";
    return;
  }

  const bitsNeeded = Math.ceil(Math.log2(n));
  const newPrefix = lastIpv4.prefix + bitsNeeded;
  if (newPrefix > 32) {
    errorEl.textContent = `Cannot split a /${lastIpv4.prefix} into ${n} subnets — not enough address space.`;
    return;
  }

  const numSubnetsGenerated = Math.pow(2, bitsNeeded);
  const subnetSize = Math.pow(2, 32 - newPrefix);
  const baseNetwork = lastIpv4.network;

  const colors = ["#5b8cff", "#34d1a1", "#ff9f5b", "#c084fc", "#ff6b9d", "#5bd1e0"];
  const rows = [];

  for (let i = 0; i < numSubnetsGenerated; i++) {
    const netInt = (baseNetwork + i * subnetSize) >>> 0;
    const sub = computeIpv4Subnet(netInt, newPrefix);
    rows.push({
      index: i + 1,
      cidr: `${intToIpv4(netInt)}/${newPrefix}`,
      network: intToIpv4(sub.network),
      broadcast: intToIpv4(sub.broadcast),
      range: newPrefix >= 31 ? `${intToIpv4(sub.first)} - ${intToIpv4(sub.last)}` : `${intToIpv4(sub.first)} - ${intToIpv4(sub.last)}`
    });

    const seg = document.createElement("div");
    seg.className = "viz-segment";
    seg.style.background = colors[i % colors.length];
    seg.title = `${intToIpv4(netInt)}/${newPrefix}`;
    seg.textContent = numSubnetsGenerated <= 16 ? `#${i + 1}` : "";
    vizEl.appendChild(seg);
  }

  rows.forEach(r => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${r.index}</td><td>${r.cidr}</td><td>${r.network}</td><td>${r.broadcast}</td><td>${r.range}</td>`;
    tbody.appendChild(tr);
  });

  if (numSubnetsGenerated !== n) {
    errorEl.textContent = `Note: ${n} does not divide evenly into powers of 2, so the network was split into ${numSubnetsGenerated} equal subnets (the smallest power of 2 that covers ${n}).`;
    errorEl.style.color = "var(--muted)";
  } else {
    errorEl.style.color = "var(--error)";
  }

  vizEl.hidden = false;
  tableEl.hidden = false;
}

document.getElementById("split-calc").addEventListener("click", runSplitCalc);

/* ---------------------------------------------------------------------
   IPv6 core (BigInt, 128-bit)
--------------------------------------------------------------------- */
const IPV6_MAX = (1n << 128n) - 1n;

function parseIpv6ToBigInt(addr) {
  addr = addr.trim();
  if (!addr.includes(":")) throw new Error(`"${addr}" is not a valid IPv6 address`);

  let [head, tail] = addr.split("::");
  const hasDoubleColon = addr.includes("::");

  const headGroups = head === "" ? [] : head.split(":");
  const tailGroups = (tail === undefined || tail === "") ? [] : tail.split(":");

  if (!hasDoubleColon && (headGroups.length !== 8)) {
    throw new Error(`"${addr}" is not a valid IPv6 address (expected 8 groups)`);
  }

  let groups;
  if (hasDoubleColon) {
    const missing = 8 - headGroups.length - tailGroups.length;
    if (missing < 0) throw new Error(`"${addr}" is not a valid IPv6 address`);
    groups = [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
  } else {
    groups = headGroups;
  }

  if (groups.length !== 8) throw new Error(`"${addr}" is not a valid IPv6 address`);

  let value = 0n;
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) throw new Error(`"${addr}" contains an invalid group "${g}"`);
    value = (value << 16n) | BigInt(parseInt(g, 16));
  }
  return value;
}

function bigIntToIpv6Expanded(value) {
  const groups = [];
  for (let i = 7; i >= 0; i--) {
    const part = (value >> BigInt(i * 16)) & 0xFFFFn;
    groups.push(part.toString(16).padStart(4, "0"));
  }
  return groups.join(":");
}

function bigIntToIpv6Compressed(value) {
  const groups = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(((value >> BigInt(i * 16)) & 0xFFFFn).toString(16));
  }

  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (groups[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart; }
    } else {
      curStart = -1; curLen = 0;
    }
  }

  if (bestLen < 2) return groups.join(":");

  const before = groups.slice(0, bestStart).join(":");
  const after = groups.slice(bestStart + bestLen).join(":");
  return `${before}::${after}`;
}

function cidrToMaskBigInt(prefix) {
  if (prefix === 0) return 0n;
  return (IPV6_MAX << BigInt(128 - prefix)) & IPV6_MAX;
}

function parseIpv6Cidr(input) {
  const [addrPart, prefixPart] = input.trim().split("/");
  if (prefixPart === undefined) throw new Error("Enter address in CIDR form, e.g. 2001:db8::/32");
  const prefix = Number(prefixPart);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) {
    throw new Error("Prefix must be an integer between 0 and 128");
  }
  const value = parseIpv6ToBigInt(addrPart);
  return { value, prefix };
}

function isInCidrV6(value, netStr, prefix) {
  const net = parseIpv6ToBigInt(netStr);
  const mask = cidrToMaskBigInt(prefix);
  return (value & mask) === (net & mask);
}

function classifyIpv6Scope(value) {
  if (value === 1n) return "Loopback";
  if (value === 0n) return "Unspecified";
  if (isInCidrV6(value, "fe80::", 10)) return "Link-Local";
  if (isInCidrV6(value, "fc00::", 7)) return "Unique Local (Private)";
  if (isInCidrV6(value, "ff00::", 8)) return "Multicast";
  if (isInCidrV6(value, "2000::", 3)) return "Global Unicast (Public)";
  return "Reserved/Other";
}

function computeIpv6Subnet(value, prefix) {
  const mask = cidrToMaskBigInt(prefix);
  const network = value & mask;
  const last = network | (IPV6_MAX ^ mask);
  const total = 2n ** BigInt(128 - prefix);
  return { network, last, total };
}

/* ---------------------------------------------------------------------
   IPv6 UI wiring
--------------------------------------------------------------------- */
function runIpv6Calc() {
  const input = document.getElementById("ipv6-input").value;
  const errorEl = document.getElementById("ipv6-error");
  const resultsEl = document.getElementById("ipv6-results");
  errorEl.textContent = "";

  let parsed;
  try {
    parsed = parseIpv6Cidr(input);
  } catch (e) {
    errorEl.textContent = e.message;
    resultsEl.hidden = true;
    return;
  }

  const { value, prefix } = parsed;
  const scope = classifyIpv6Scope(value);
  const subnet = computeIpv6Subnet(value, prefix);

  document.getElementById("r6-scope").textContent = scope;
  document.getElementById("r6-expanded").textContent = bigIntToIpv6Expanded(value);
  document.getElementById("r6-compressed").textContent = bigIntToIpv6Compressed(value);
  document.getElementById("r6-network").textContent = bigIntToIpv6Compressed(subnet.network);
  document.getElementById("r6-last").textContent = bigIntToIpv6Compressed(subnet.last);
  document.getElementById("r6-prefix").textContent = `/${prefix}`;
  document.getElementById("r6-total").textContent = subnet.total.toLocaleString();

  resultsEl.hidden = false;
}

document.getElementById("ipv6-calc").addEventListener("click", runIpv6Calc);
document.getElementById("ipv6-input").addEventListener("keydown", e => {
  if (e.key === "Enter") runIpv6Calc();
});

/* ---------------------------------------------------------------------
   Reverse mode: smallest CIDR containing two IPs
--------------------------------------------------------------------- */
function clz32(x) {
  if (x === 0) return 32;
  let n = 0;
  while ((x & 0x80000000) === 0) { x = (x << 1) >>> 0; n++; }
  return n;
}

function commonPrefixLenBigInt(a, b, bits) {
  let count = 0;
  for (let i = bits - 1; i >= 0; i--) {
    const bitA = (a >> BigInt(i)) & 1n;
    const bitB = (b >> BigInt(i)) & 1n;
    if (bitA !== bitB) break;
    count++;
  }
  return count;
}

function runReverseCalc() {
  const ip1raw = document.getElementById("rev-ip1").value.trim();
  const ip2raw = document.getElementById("rev-ip2").value.trim();
  const errorEl = document.getElementById("rev-error");
  const resultsEl = document.getElementById("rev-results");
  errorEl.textContent = "";

  const isV6a = ip1raw.includes(":");
  const isV6b = ip2raw.includes(":");

  try {
    if (isV6a !== isV6b) {
      throw new Error("Both addresses must be the same version (both IPv4 or both IPv6)");
    }

    if (isV6a) {
      const a = parseIpv6ToBigInt(ip1raw);
      const b = parseIpv6ToBigInt(ip2raw);
      const prefix = commonPrefixLenBigInt(a, b, 128);
      const mask = cidrToMaskBigInt(prefix);
      const network = a & mask;
      const total = 2n ** BigInt(128 - prefix);

      document.getElementById("rev-cidr").textContent = `${bigIntToIpv6Compressed(network)}/${prefix}`;
      document.getElementById("rev-network").textContent = bigIntToIpv6Compressed(network);
      document.getElementById("rev-total").textContent = total.toLocaleString();
    } else {
      const a = ipv4ToInt(ip1raw);
      const b = ipv4ToInt(ip2raw);
      const xor = (a ^ b) >>> 0;
      const prefix = xor === 0 ? 32 : clz32(xor);
      const mask = cidrToMaskInt(prefix);
      const network = (a & mask) >>> 0;
      const total = Math.pow(2, 32 - prefix);

      document.getElementById("rev-cidr").textContent = `${intToIpv4(network)}/${prefix}`;
      document.getElementById("rev-network").textContent = intToIpv4(network);
      document.getElementById("rev-total").textContent = total.toLocaleString();
    }

    resultsEl.hidden = false;
  } catch (e) {
    errorEl.textContent = e.message;
    resultsEl.hidden = true;
  }
}

document.getElementById("rev-calc").addEventListener("click", runReverseCalc);

/* Run once on load with the default example values */
window.addEventListener("DOMContentLoaded", () => {
  runIpv4Calc();
  runIpv6Calc();
});
