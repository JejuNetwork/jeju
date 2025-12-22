# Jeju Documentation Overhaul Plan

## Overview

This plan organizes the complete documentation rewrite into parallelizable agent tasks. Each agent researches source code and rewrites documentation for their assigned scope.

## Documentation Structure

```
apps/documentation/
├── index.md                    # Landing page
├── getting-started/
│   ├── quick-start.md         # 5-minute setup
│   ├── networks.md            # Mainnet/testnet/localnet
│   ├── configuration.md       # Environment, config files
│   └── test-accounts.md       # Dev accounts & faucets
├── learn/
│   ├── why-jeju.md            # Value proposition
│   ├── architecture.md        # Technical architecture
│   ├── concepts.md            # Core concepts
│   ├── gasless.md             # ERC-4337, paymasters
│   ├── intents.md             # ERC-7683, OIF
│   └── agents.md              # ERC-8004, A2A, MCP
├── build/
│   ├── overview.md            # Developer getting started
│   ├── sdk/
│   │   ├── installation.md
│   │   ├── client.md
│   │   ├── identity.md
│   │   ├── payments.md
│   │   ├── defi.md
│   │   ├── compute.md
│   │   ├── storage.md
│   │   └── crosschain.md
│   ├── contracts/
│   │   ├── overview.md
│   │   ├── tokens.md
│   │   ├── identity.md
│   │   ├── payments.md
│   │   ├── defi.md
│   │   ├── oif.md
│   │   └── eil.md
│   ├── rpc/
│   │   └── endpoints.md
│   └── dws/
│       ├── overview.md
│       ├── api.md
│       └── integration.md
├── apps/
│   ├── overview.md
│   ├── gateway.md
│   ├── bazaar.md
│   ├── crucible.md
│   ├── indexer.md
│   ├── monitoring.md
│   ├── wallet.md
│   ├── factory.md
│   ├── autocrat.md
│   ├── dws.md
│   ├── node.md
│   ├── otto.md
│   └── vpn.md
├── packages/
│   ├── overview.md
│   ├── sdk.md
│   ├── cli.md
│   ├── contracts.md
│   ├── config.md
│   ├── types.md
│   ├── shared.md
│   ├── bridge.md
│   ├── oauth3.md
│   ├── kms.md
│   ├── messaging.md
│   ├── eliza-plugin.md
│   ├── bots.md
│   ├── token.md
│   ├── db.md
│   └── deployment.md
├── operate/
│   ├── overview.md
│   ├── rpc-node.md
│   ├── compute-node.md
│   ├── storage-node.md
│   ├── sequencer.md
│   ├── solver.md
│   └── xlp.md
├── integrate/
│   ├── overview.md            # For integrating projects
│   ├── eil.md                 # Cross-chain liquidity
│   ├── oif.md                 # Intent framework
│   ├── become-xlp.md          # LP guide
│   ├── become-solver.md       # Solver guide
│   └── market-making.md       # MM strategies
├── api-reference/
│   ├── rpc.md
│   ├── graphql.md
│   ├── a2a.md
│   ├── mcp.md
│   └── x402.md
├── deployment/
│   ├── overview.md
│   ├── localnet.md
│   ├── testnet.md
│   ├── mainnet.md
│   ├── contracts.md
│   ├── infrastructure.md
│   └── superchain.md
├── tutorials/
│   ├── overview.md
│   ├── gasless-nft.md
│   ├── trading-agent.md
│   ├── x402-api.md
│   └── register-token.md
└── reference/
    ├── addresses.md
    ├── cli.md
    ├── env-vars.md
    ├── ports.md
    └── test-accounts.md
```

## User Paths

### Path 1: Developer Building Dapps (Alternative to Privy/Alchemy)
- Getting Started → SDK → RPC/DWS → Build Guide → Tutorials

### Path 2: Developer Deploying Apps on Jeju
- Getting Started → Architecture → Deploy → Apps Guide → Operate

### Path 3: Liquidity Provider / Market Maker / Integrator
- Learn → EIL/OIF → Become XLP/Solver → Market Making → API Reference

### Path 4: End User
- Gateway/Bazaar app docs → Wallet setup → Tutorials

## Agent Task Breakdown

### Tier 1: Research Agents (Run in Parallel)

#### Apps (13 agents)
- `agent-app-gateway.md` - Gateway app research
- `agent-app-bazaar.md` - Bazaar app research
- `agent-app-crucible.md` - Crucible app research
- `agent-app-indexer.md` - Indexer app research
- `agent-app-monitoring.md` - Monitoring app research
- `agent-app-wallet.md` - Wallet app research
- `agent-app-factory.md` - Factory app research
- `agent-app-autocrat.md` - Autocrat app research
- `agent-app-dws.md` - DWS app research
- `agent-app-node.md` - Node app research
- `agent-app-otto.md` - Otto app research
- `agent-app-vpn.md` - VPN app research
- `agent-app-example.md` - Example app research

#### Packages (15 agents)
- `agent-pkg-sdk.md` - SDK package research
- `agent-pkg-cli.md` - CLI package research
- `agent-pkg-contracts.md` - Contracts package research
- `agent-pkg-config.md` - Config package research
- `agent-pkg-types.md` - Types package research
- `agent-pkg-shared.md` - Shared utilities research
- `agent-pkg-bridge.md` - Bridge package research
- `agent-pkg-oauth3.md` - OAuth3 package research
- `agent-pkg-kms.md` - KMS package research
- `agent-pkg-messaging.md` - Messaging package research
- `agent-pkg-eliza.md` - Eliza plugin research
- `agent-pkg-bots.md` - Bots package research
- `agent-pkg-token.md` - Token package research
- `agent-pkg-db.md` - DB package research
- `agent-pkg-deployment.md` - Deployment package research

### Tier 2: Section Writers (After Tier 1)

#### Core Sections (6 agents)
- `agent-overview.md` - Main landing page & architecture
- `agent-getting-started.md` - Quick start, setup, networks
- `agent-deployment.md` - Deployment docs all networks
- `agent-api-reference.md` - RPC, GraphQL, A2A, x402
- `agent-operate.md` - Node operator guides
- `agent-tutorials.md` - Step-by-step tutorials

### Tier 3: User Path Agents (After Tier 2)

#### User-Focused Sections (4 agents)
- `agent-path-dapp-dev.md` - For developers using SDK/RPC/DWS
- `agent-path-app-dev.md` - For developers deploying on Jeju
- `agent-path-integrator.md` - For LPs, MMs, EIL/OIF integrators
- `agent-path-user.md` - For end users of apps

### Tier 4: Final Review (After Tier 3)
- `agent-final-review.md` - Cross-reference, consistency, links

## Output Requirements

Each doc page must:
1. Be concise but comprehensive
2. Use friendly, clear language
3. Include working code examples
4. Have a "Copy as Context" block at the bottom
5. Cross-link related pages
6. Include CLI commands where applicable
7. Show TypeScript examples (not JavaScript)

## Copy-as-Context Block Format

Each page ends with:

```markdown
---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content as plain text for LLM context]
\`\`\`

</details>
```

## Execution Order

1. **Phase 1**: Run all Tier 1 agents in parallel (28 agents)
2. **Phase 2**: Run Tier 2 agents (6 agents) - they read Tier 1 outputs
3. **Phase 3**: Run Tier 3 agents (4 agents) - they organize user paths
4. **Phase 4**: Run final review agent

## File Locations

- Agent task files: `docs-tasks/agents/`
- Research outputs: `docs-tasks/research/`
- Final docs: `apps/documentation/`

