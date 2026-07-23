/* ---------------------------------------------------------------------
   Layer + protocol data model
--------------------------------------------------------------------- */
const TCPIP_GROUPS = {
  7: "Application", 6: "Application", 5: "Application",
  4: "Transport",
  3: "Internet",
  2: "Network Access", 1: "Network Access"
};

const TCPIP_ORDER = ["Application", "Transport", "Internet", "Network Access"];

const PROTOCOLS = {
  HTTP: {
    transport: "TCP",
    port: 80,
    appHeader: () => "GET / HTTP/1.1 | Host: example.com",
    appDesc: "formats the message as an HTTP request"
  },
  DNS: {
    transport: "UDP",
    port: 53,
    appHeader: () => "DNS Query: Type=A, Name=example.com",
    appDesc: "formats the message as a DNS query"
  },
  SMTP: {
    transport: "TCP",
    port: 25,
    appHeader: () => "MAIL FROM:<sender@host.com> RCPT TO:<receiver@host.com>",
    appDesc: "formats the message as an SMTP mail transaction"
  }
};

/* Build the 7 layer definitions (index 0 = Layer 7 ... index 6 = Layer 1).
   Each def carries the exact open/close strings applied during encoding,
   so decoding can strip them back off deterministically. */
function buildLayerDefs(protocolKey, srcPort) {
  const cfg = PROTOCOLS[protocolKey];
  const srcIP = "192.168.1.10";
  const dstIP = "93.184.216.34";
  const srcMAC = "AA:BB:CC:11:22:33";
  const dstMAC = "DE:AD:BE:EF:00:01";

  return [
    {
      num: 7, osiName: "Application", tcpipGroup: TCPIP_GROUPS[7],
      func: "Network process to application — the interface users and apps talk to",
      protocolExample: `${protocolKey}`,
      open: `[${protocolKey}: ${cfg.appHeader()}]`, close: `[/${protocolKey}]`,
      encodeDesc: `Layer 7 (Application) ${cfg.appDesc}.`,
      decodeDesc: `Layer 7 (Application) reads the ${protocolKey} header and hands the final message to the app.`
    },
    {
      num: 6, osiName: "Presentation", tcpipGroup: TCPIP_GROUPS[6],
      func: "Translation, encoding, compression, encryption",
      protocolExample: "TLS / ASCII / UTF-8",
      open: `[ENC:UTF-8]`, close: `[/ENC]`,
      encodeDesc: "Layer 6 (Presentation) encodes the data (character set, optional compression/encryption).",
      decodeDesc: "Layer 6 (Presentation) decodes/decrypts the data back to its original representation."
    },
    {
      num: 5, osiName: "Session", tcpipGroup: TCPIP_GROUPS[5],
      func: "Establishes, manages, and tears down the dialog between hosts",
      protocolExample: "RPC / sockets / NetBIOS",
      open: `[SESSION:0x4a2f]`, close: `[/SESSION]`,
      encodeDesc: "Layer 5 (Session) opens a session and tags the data with a session identifier.",
      decodeDesc: "Layer 5 (Session) verifies the session identifier and keeps the dialog synchronized."
    },
    {
      num: 4, osiName: "Transport", tcpipGroup: TCPIP_GROUPS[4],
      func: "End-to-end delivery, port addressing, segmentation, reliability",
      protocolExample: cfg.transport,
      open: `[${cfg.transport} sport=${srcPort} dport=${cfg.port}]`, close: `[/${cfg.transport}]`,
      encodeDesc: `Layer 4 (Transport) breaks the data into a ${cfg.transport === "TCP" ? "segment" : "datagram"} and adds source port ${srcPort} / destination port ${cfg.port}.`,
      decodeDesc: `Layer 4 (Transport) reads the port numbers and delivers the ${cfg.transport === "TCP" ? "segment" : "datagram"} to the waiting application on port ${cfg.port}.`
    },
    {
      num: 3, osiName: "Network", tcpipGroup: TCPIP_GROUPS[3],
      func: "Logical addressing and routing between networks",
      protocolExample: "IP / ICMP",
      open: `[IP src=${srcIP} dst=${dstIP}]`, close: `[/IP]`,
      encodeDesc: `Layer 3 (Network) wraps the segment into a packet with source IP ${srcIP} and destination IP ${dstIP}.`,
      decodeDesc: "Layer 3 (Network) checks the destination IP and passes the packet up to Transport."
    },
    {
      num: 2, osiName: "Data Link", tcpipGroup: TCPIP_GROUPS[2],
      func: "Node-to-node delivery, MAC addressing, framing, error detection",
      protocolExample: "Ethernet / Wi-Fi",
      open: `[ETH src=${srcMAC} dst=${dstMAC}]`, close: `[FCS]`,
      encodeDesc: "Layer 2 (Data Link) frames the packet with MAC addresses and appends an FCS trailer for error checking.",
      decodeDesc: "Layer 2 (Data Link) checks the FCS trailer, strips the Ethernet frame, and passes the packet up to Network."
    },
    {
      num: 1, osiName: "Physical", tcpipGroup: TCPIP_GROUPS[1],
      func: "Transmits raw bits as electrical, optical, or radio signals",
      protocolExample: "Ethernet PHY / DSL / radio",
      open: `<<BITS `, close: `>>`,
      encodeDesc: "Layer 1 (Physical) converts the frame into raw bits and puts them on the medium (no real header — pure signal encoding).",
      decodeDesc: "Layer 1 (Physical) receives raw bits off the medium and reconstructs the frame."
    }
  ];
}

/* ---------------------------------------------------------------------
   Packet math: depth = how many layers (from Layer 7 inward... no —
   from the outside in) are currently wrapped around the message.
   depth 0 = raw message. depth 7 = full packet, ready for the wire.
   Layers are applied in encode order [L7, L6, ..., L1], so after `depth`
   layers are applied, the nesting from outermost to innermost is the
   reverse of layerDefs[0..depth-1].
--------------------------------------------------------------------- */
function nestingAtDepth(layerDefs, depth) {
  return layerDefs.slice(0, depth).slice().reverse();
}

function plainTextAtDepth(layerDefs, message, depth) {
  let payload = message;
  for (let i = 0; i < depth; i++) {
    payload = layerDefs[i].open + payload + layerDefs[i].close;
  }
  return payload;
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function htmlAtDepth(layerDefs, message, depth) {
  const nesting = nestingAtDepth(layerDefs, depth); // outer -> inner
  let html = `<span class="payload">${escapeHtml(message)}</span>`;
  // apply innermost-first so outer ends up outermost in the final string
  for (let i = nesting.length - 1; i >= 0; i--) {
    const def = nesting[i];
    html = `<span class="tag" style="color:var(--l${def.num})">${escapeHtml(def.open)}</span>${html}<span class="tag" style="color:var(--l${def.num})">${escapeHtml(def.close)}</span>`;
  }
  return html;
}

/* ---------------------------------------------------------------------
   Build the full 16-step timeline: start, 7 encode, 1 wire, 7 decode
--------------------------------------------------------------------- */
function buildTimeline(layerDefs, message) {
  const timeline = [];

  timeline.push({
    type: "start", def: null, depth: 0, side: "sender",
    description: "Original message ready to send."
  });

  for (let i = 0; i < 7; i++) {
    timeline.push({
      type: "encode", def: layerDefs[i], depth: i + 1, side: "sender",
      description: layerDefs[i].encodeDesc
    });
  }

  timeline.push({
    type: "wire", def: null, depth: 7, side: "wire",
    description: "Transmission: the full frame travels across the physical medium as a bitstream."
  });

  for (let j = 0; j < 7; j++) {
    const removedDef = layerDefs[6 - j];
    timeline.push({
      type: "decode", def: removedDef, depth: 6 - j, side: "receiver",
      description: removedDef.decodeDesc
    });
  }

  return timeline;
}

/* ---------------------------------------------------------------------
   App state
--------------------------------------------------------------------- */
let state = {
  layerDefs: null,
  message: "",
  timeline: [],
  stepIndex: 0,
  playing: false,
  playTimer: null
};

const OSI_ORDER_TOP_DOWN = [7, 6, 5, 4, 3, 2, 1];

function el(id) { return document.getElementById(id); }

/* ---------------------------------------------------------------------
   Rendering
--------------------------------------------------------------------- */
function renderLegend(layerDefs) {
  const tbody = el("legend-tbody");
  tbody.innerHTML = "";
  layerDefs.forEach(def => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td><span style="color:var(--l${def.num})">&#9632;</span> L${def.num} ${def.osiName}</td>
      <td>${def.tcpipGroup}</td><td>${def.func}</td><td>${def.protocolExample}</td>`;
    tbody.appendChild(tr);
  });
}

function layerBoxHtml(def, activeNum) {
  const activeClass = def.num === activeNum ? "active" : "";
  return `<div class="layer-box ${activeClass}" style="--layer-color: var(--l${def.num})">
    <div class="lname">L${def.num} ${def.osiName}</div>
    <div class="lfunc">${def.func}</div>
    <div class="lproto">${def.protocolExample}</div>
  </div>`;
}

function tcpipBoxHtml(groupName, activeGroup) {
  const activeClass = groupName === activeGroup ? "active" : "";
  const members = OSI_ORDER_TOP_DOWN.filter(n => TCPIP_GROUPS[n] === groupName);
  const colorNum = members[0];
  return `<div class="layer-box ${activeClass}" style="--layer-color: var(--l${colorNum})">
    <div class="lname">${groupName}</div>
    <div class="lfunc">Covers OSI layer${members.length > 1 ? "s" : ""} ${members.join(", ")}</div>
  </div>`;
}

function renderStacks(mode, activeNum) {
  const activeGroup = activeNum ? TCPIP_GROUPS[activeNum] : null;

  const senderOsi = el("stack-sender-osi");
  const receiverOsi = el("stack-receiver-osi");
  const senderTcpip = el("stack-sender-tcpip");
  const receiverTcpip = el("stack-receiver-tcpip");

  const showOsi = mode === "osi" || mode === "both";
  const showTcpip = mode === "tcpip" || mode === "both";

  senderOsi.hidden = !showOsi;
  receiverOsi.hidden = !showOsi;
  senderTcpip.hidden = !showTcpip;
  receiverTcpip.hidden = !showTcpip;

  if (showOsi) {
    const osiHtml = state.layerDefs.map(def => layerBoxHtml(def, activeNum)).join("");
    senderOsi.innerHTML = osiHtml;
    receiverOsi.innerHTML = osiHtml;
  }

  if (showTcpip) {
    const tcpipHtml = TCPIP_ORDER.map(g => tcpipBoxHtml(g, activeGroup)).join("");
    senderTcpip.innerHTML = tcpipHtml;
    receiverTcpip.innerHTML = tcpipHtml;
  }
}

function renderPacketBubble(side) {
  const bubble = el("packet-bubble");
  bubble.classList.remove("at-sender", "at-wire", "at-receiver");
  if (side === "sender") bubble.classList.add("at-sender");
  else if (side === "wire") bubble.classList.add("at-wire");
  else bubble.classList.add("at-receiver");
}

function renderStep() {
  const step = state.timeline[state.stepIndex];
  if (!step) return;

  const mode = el("model-select").value;
  renderStacks(mode, step.def ? step.def.num : null);
  renderPacketBubble(step.side);

  el("step-description").textContent =
    `Step ${state.stepIndex + 1} / ${state.timeline.length} — ${step.description}`;

  el("packet-view").innerHTML = htmlAtDepth(state.layerDefs, state.message, step.depth);

  el("scrubber").value = state.stepIndex;

  const finalEl = el("final-message");
  if (step.type === "decode" && step.depth === 0) {
    const decoded = plainTextAtDepth(state.layerDefs, state.message, 0);
    finalEl.hidden = false;
    finalEl.textContent = `✓ Delivered to receiving application: "${decoded}"`;
  } else {
    finalEl.hidden = true;
  }
}

/* ---------------------------------------------------------------------
   Playback controls
--------------------------------------------------------------------- */
function goToStep(index) {
  state.stepIndex = Math.max(0, Math.min(state.timeline.length - 1, index));
  renderStep();
}

function stopPlaying() {
  state.playing = false;
  if (state.playTimer) clearTimeout(state.playTimer);
  state.playTimer = null;
  el("btn-play").textContent = "▶ Play";
}

function startPlaying() {
  if (!state.timeline.length) return;
  state.playing = true;
  el("btn-play").textContent = "⏸ Pause";
  const tick = () => {
    if (!state.playing) return;
    if (state.stepIndex >= state.timeline.length - 1) {
      stopPlaying();
      return;
    }
    goToStep(state.stepIndex + 1);
    state.playTimer = setTimeout(tick, 1100);
  };
  state.playTimer = setTimeout(tick, 1100);
}

function sendMessage() {
  const msgInput = el("msg-input");
  const errorEl = el("error-msg");
  errorEl.textContent = "";

  const message = msgInput.value.trim();
  if (!message) {
    errorEl.textContent = "Enter a message first.";
    return;
  }

  stopPlaying();

  const protocolKey = el("protocol-select").value;
  const srcPort = 40000 + Math.floor(Math.random() * 20000);
  const layerDefs = buildLayerDefs(protocolKey, srcPort);
  const timeline = buildTimeline(layerDefs, message);

  state.layerDefs = layerDefs;
  state.message = message;
  state.timeline = timeline;
  state.stepIndex = 0;

  el("scrubber").max = timeline.length - 1;
  renderLegend(layerDefs);
  renderStep();
  startPlaying();
}

function resetAll() {
  stopPlaying();
  state = { layerDefs: null, message: "", timeline: [], stepIndex: 0, playing: false, playTimer: null };
  el("step-description").textContent = "Ready. Click Send to begin.";
  el("packet-view").innerHTML = "";
  el("final-message").hidden = true;
  el("scrubber").value = 0;
  ["stack-sender-osi", "stack-receiver-osi", "stack-sender-tcpip", "stack-receiver-tcpip"].forEach(id => {
    el(id).innerHTML = "";
  });
  renderPacketBubble("sender");
}

/* ---------------------------------------------------------------------
   Event wiring
--------------------------------------------------------------------- */
el("btn-send").addEventListener("click", sendMessage);
el("msg-input").addEventListener("keydown", e => { if (e.key === "Enter") sendMessage(); });

el("btn-play").addEventListener("click", () => {
  if (!state.timeline.length) return;
  if (state.playing) stopPlaying();
  else startPlaying();
});

el("btn-prev").addEventListener("click", () => { stopPlaying(); goToStep(state.stepIndex - 1); });
el("btn-next").addEventListener("click", () => { stopPlaying(); goToStep(state.stepIndex + 1); });
el("btn-reset").addEventListener("click", resetAll);

el("scrubber").addEventListener("input", e => {
  if (!state.timeline.length) return;
  stopPlaying();
  goToStep(Number(e.target.value));
});

el("model-select").addEventListener("change", () => {
  if (state.timeline.length) renderStep();
});

/* Initial render with a default legend so the page isn't empty on load */
renderLegend(buildLayerDefs("HTTP", 50123));
