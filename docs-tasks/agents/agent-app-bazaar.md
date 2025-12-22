# Agent Task: Bazaar App Documentation

## Scope
Research and document the Bazaar application (`apps/bazaar/`).

## Source Files to Analyze
- `apps/bazaar/app/` - Next.js app routes
- `apps/bazaar/components/` - UI components
- `apps/bazaar/lib/` - Core logic and utilities
- `apps/bazaar/hooks/` - React hooks
- `apps/bazaar/config/` - Configuration
- `apps/bazaar/README.md` - Existing docs
- `apps/bazaar/package.json` - Dependencies

## Research Questions
1. What is Bazaar's primary purpose?
2. What DeFi features does it provide (swap, pools, perps)?
3. How does the NFT marketplace work?
4. What is the launchpad functionality?
5. How does JNS (Jeju Name Service) work?
6. What contracts does it interact with?
7. How does gasless trading work?
8. What is the OTC trading flow?

## Output Format

### File: `apps/documentation/apps/bazaar.md`

```markdown
# Bazaar

[One-sentence description]

## Overview

[2-3 paragraphs explaining Bazaar's purpose, DeFi features, and user value]

## Features

### Token Swap
[AMM swap functionality, supported pairs, slippage]

### Liquidity Pools
[How to provide liquidity, pool rewards]

### Perpetuals
[Perps trading, leverage, liquidation]

### NFT Marketplace
[Minting, buying, selling NFTs]

### Launchpad
[Token launches, fair launch mechanism]

### JNS (Jeju Name Service)
[Domain registration, resolution]

### OTC Trading
[Peer-to-peer token trades]

## Architecture

[Key modules, state management, contract interactions]

## User Flows

### Swap Flow
[Step-by-step swap process]

### Add Liquidity Flow
[Step-by-step LP process]

## Gasless Trading

[How ERC-4337 enables gasless swaps]

## Configuration

[Environment variables, config options]

## Development

\`\`\`bash
cd apps/bazaar
bun install
bun run dev
\`\`\`

## Related

- [SDK DeFi Module](/build/sdk/defi)
- [Payment Contracts](/contracts/payments)
- [Gasless Transactions](/learn/gasless)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/bazaar.md`

