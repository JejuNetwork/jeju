# Agent Task: Getting Started Documentation

## Scope
Write comprehensive getting started documentation including setup, networks, and configuration.

## Source Files to Analyze
- `README.md` - Root readme
- `apps/documentation/getting-started/` - Existing docs
- `packages/config/` - Configuration patterns
- `packages/cli/` - CLI commands
- `package.json` - Scripts

## Research Questions
1. What are the prerequisites?
2. What is the fastest path to running locally?
3. What networks are available?
4. How is configuration handled?
5. What test accounts exist?
6. How do developers connect wallets?
7. What are common troubleshooting issues?
8. What are the next steps after setup?

## Output Files

### 1. `apps/documentation/getting-started/quick-start.md`

```markdown
# Quick Start

Run Jeju locally in 5 minutes.

## Prerequisites

### macOS
\`\`\`bash
brew install --cask docker
brew install kurtosis-tech/tap/kurtosis
curl -fsSL https://bun.sh/install | bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
\`\`\`

### Linux
[Linux commands]

### Windows (WSL2)
[Windows commands]

### Verify
\`\`\`bash
docker --version && kurtosis version && bun --version && forge --version
\`\`\`

## Start Localnet

\`\`\`bash
git clone https://github.com/elizaos/jeju && cd jeju
bun install
bun run dev
\`\`\`

## What's Running

| Service | Port | URL |
|---------|------|-----|
| L1 (Ethereum) | 8545 | http://127.0.0.1:8545 |
| L2 (Jeju) | 9545 | http://127.0.0.1:9545 |
| Gateway | 4001 | http://127.0.0.1:4001 |
| Bazaar | 4006 | http://127.0.0.1:4006 |
| Indexer | 4350 | http://127.0.0.1:4350/graphql |

## Verify It Works

\`\`\`bash
cast block latest --rpc-url http://127.0.0.1:9545
\`\`\`

## Add to Wallet

[MetaMask config]

## Troubleshooting

[Common issues and fixes]

## Next Steps

- [Deploy a Contract](/deployment/contracts)
- [Use the SDK](/build/sdk/installation)
- [Connect to Testnet](/getting-started/networks)

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/getting-started/networks.md`

```markdown
# Networks

Available Jeju networks and how to connect.

## Networks

### Mainnet
| Property | Value |
|----------|-------|
| Chain ID | 420691 |
| RPC | https://rpc.jejunetwork.org |
| Explorer | https://explorer.jejunetwork.org |
| Bridge | https://bridge.jejunetwork.org |

### Testnet
[Testnet details]

### Localnet
[Localnet details]

## Connect via SDK

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({
  network: 'mainnet', // or 'testnet' or 'localnet'
});
\`\`\`

## Connect via Wallet

[Wallet connection instructions]

## Faucets

[Testnet faucets]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/getting-started/configuration.md`

```markdown
# Configuration

Environment variables and configuration files.

## Environment Variables

[All env vars with descriptions]

## Configuration Files

[Config file locations and formats]

## Network-Specific Config

[How to configure for different networks]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 4. `apps/documentation/getting-started/test-accounts.md`

```markdown
# Test Accounts

Development accounts for testing.

## Default Test Account

\`\`\`
Address: 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
Private Key: 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
\`\`\`

Pre-funded with 10,000 ETH on localnet.

## Additional Accounts

[More test accounts]

## Security Warning

[Never use these on mainnet]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/getting-started.md`

