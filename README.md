# noorDevopsRepo

A set of small frontend-only web apps built for networking/DevOps coursework. Each one is a standalone HTML/CSS/JS project — just open its `index.html` in a browser, no build step or server required.

## Projects

- **[IP / CIDR Subnet Calculator](./index.html)** *(lives in the repo root: `index.html`, `style.css`, `app.js`)*
  IP classes, subnet mask/network/broadcast/usable-range math, public/private classification, splitting a network into N equal subnets with a visualization, IPv6 parsing, and a reverse mode that finds the smallest CIDR block containing two given IPs.

- **[OSI / TCP-IP Encapsulation Visualizer](./osi-encapsulation)**
  Animates a message being wrapped layer 7→1 with bracket-notation headers (protocol-specific for HTTP/DNS/SMTP), sent across a wire, then unwrapped 1→7 on the receiver. Includes an OSI/TCP-IP/both model-view toggle and a live packet inspector.

- **[DNS Resolution Simulator](./dns-resolver-simulator)**
  Walks a fake root → TLD → authoritative DNS hierarchy (A/NS/MX/CNAME/TXT records), follows CNAME chains, handles NXDOMAIN, renders a `dig +trace`-style text output, caches answers by TTL with a live countdown, and includes an admin panel to edit zones/records.

- **[Routing Table / Longest-Prefix-Match Simulator](./routing-table-simulator)**
  Build custom routing tables (CIDR + target), trace a destination IP through longest-prefix-match with a plain-English explanation, visualize nested/overlapping CIDR blocks, and chain a packet through 2–3 router hops via a reserved `next-hop` target.

## Note on the subnet calculator's folder

The first project lives directly in the repo root (`index.html`, `style.css`, `app.js`) rather than its own subfolder, since it was the first tool built here.
