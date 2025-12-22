# Agent Task: VPN App Documentation

## Scope
Research and document the VPN application (`apps/vpn/`).

## Source Files to Analyze
- `apps/vpn/` - All source files (Rust and TypeScript)
- `apps/vpn/package.json` - Dependencies

## Research Questions
1. What is the VPN's primary purpose?
2. How does it differ from traditional VPNs?
3. What protocols are used (WireGuard, etc.)?
4. How does decentralized routing work?
5. How do exit nodes work?
6. What is the payment model?
7. How does node registration work?
8. What privacy features are included?

## Output Format

### File: `apps/documentation/apps/vpn.md`

```markdown
# VPN

[One-sentence description - decentralized VPN service]

## Overview

[2-3 paragraphs about decentralized VPN, privacy, node network]

## Features

### Decentralized Routing
[How traffic is routed through node network]

### Privacy
[Privacy guarantees, no-logging]

### Payment
[Pay-per-use, token payments]

### Exit Nodes
[Running exit nodes, rewards]

## Architecture

### Client
[VPN client implementation]

### Node Network
[Exit node registration, selection]

### Payment Channel
[Micro-payment for bandwidth]

## Usage

### Client Setup
[How to use VPN as client]

### Run Exit Node
[How to operate an exit node]

## Requirements

### Client
[Client requirements]

### Exit Node
[Hardware, bandwidth, legal]

## Configuration

[VPN configuration options]

## Development

\`\`\`bash
cd apps/vpn
bun install
bun run dev
\`\`\`

## Related

- [Node Operation](/operate/overview)
- [Token Payments](/build/sdk/payments)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/vpn.md`

