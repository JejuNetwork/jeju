# Fork Your Own Network

Create your own L2 appchain in minutes. Every network you launch becomes part of the Jeju ecosystem with built-in cross-chain interoperability.

## Overview

Jeju is both a network and a framework. When you fork Jeju, you get:

- **Your own branded L2** - Custom name, colors, domain
- **Full infrastructure** - Sequencer, RPC, explorer
- **Cross-chain by default** - Connected to all Jeju networks
- **Shared liquidity** - Access to federated XLPs
- **Agent interoperability** - ERC-8004 identities work everywhere

## Quick Start

```bash
# Interactive wizard
jeju fork

# Or with options
jeju fork --name "MyChain" --chain-id 123456 --yes
```

## The Fork Wizard

The interactive wizard guides you through:

### Step 1: Basic Info
- **Network name** - What your network is called (e.g., "Acme Chain")
- **Tagline** - A short description
- **Chain ID** - Pick any unused number

### Step 2: Network Setup
- **L1 chain** - Where your network settles:
  - Sepolia (recommended for testing)
  - Ethereum (production)
  - Base (L2 on L2)
- **Domain** - Your network's domain (e.g., acme.network)

### Step 3: Tokens (Optional)
- **Gas token symbol** - Usually ETH
- **Governance token** - Your network's native token

## What Gets Generated

```
.fork/mychain/
├── branding.json      # ← Edit this to customize everything
├── chain.json         # Chain configuration
├── genesis.json       # Genesis block
├── federation.json    # Cross-chain settings
├── keys.json          # Operator keys (KEEP SECURE!)
├── deploy-l1.ts       # L1 contract deployment
├── deploy-l2.ts       # L2 contract deployment  
├── register-federation.ts  # Join the Jeju federation
├── k8s/               # Kubernetes manifests
└── README.md          # Network-specific instructions
```

## Customizing Your Network

### The Branding File

`branding.json` controls all branding across your entire network:

```json
{
  "network": {
    "name": "Acme",
    "displayName": "Acme Network",
    "tagline": "The blockchain for builders"
  },
  "urls": {
    "website": "https://acme.network",
    "docs": "https://docs.acme.network"
  },
  "branding": {
    "primaryColor": "#ff6b00",
    "secondaryColor": "#1a1a2e"
  },
  "cli": {
    "name": "acme",
    "banner": ["  ACME NETWORK  "]
  }
}
```

All apps, services, and the CLI automatically use these values.

### Colors & Theme

```json
{
  "branding": {
    "primaryColor": "#your-color",
    "secondaryColor": "#your-secondary", 
    "accentColor": "#your-accent",
    "backgroundColor": "#0f172a",
    "textColor": "#f8fafc"
  }
}
```

### Feature Flags

Enable/disable features for your network:

```json
{
  "features": {
    "flashblocks": true,           // 200ms sub-blocks
    "erc4337": true,               // Account abstraction
    "crossChain": true,            // Cross-chain messaging
    "governance": true,            // On-chain governance
    "staking": true,               // Node staking
    "identityRegistry": true       // ERC-8004 identity
  }
}
```

## Deployment

### Prerequisites

1. **Fund your deployer** - Send ETH to the deployer address in `keys.json`
2. **Infrastructure** - Kubernetes cluster or bare metal servers
3. **DNS** - Point your domain to your infrastructure

### Step 1: Deploy L1 Contracts

```bash
cd .fork/mychain
bun run deploy-l1.ts
```

Deploys L1 bridge contracts, dispute game factory, and system config.

### Step 2: Start L2 Nodes

**Using Kubernetes:**
```bash
kubectl apply -f k8s/
```

**Or manually:**
```bash
# Start sequencer (op-reth)
op-reth node --chain genesis.json --http --http.port 8545

# Start op-node
op-node --l2 http://localhost:8551 --l1 <YOUR_L1_RPC>
```

### Step 3: Deploy L2 Contracts

```bash
bun run deploy-l2.ts
```

Deploys Identity Registry, Solver Registry, Liquidity Vault, and Governance.

### Step 4: Join the Federation

```bash
bun run register-federation.ts
```

This registers your network with the Jeju federation, enabling:
- Cross-chain identity
- Shared liquidity pools
- Solver network access
- Discovery in explorers

## Federation Benefits

When you join the Jeju federation:

| Feature | Description |
|---------|-------------|
| **Cross-chain identity** | Users keep their ERC-8004 identity across all networks |
| **Shared liquidity** | Access to federated XLP pools |
| **Solver network** | Use existing solvers for cross-chain intents |
| **Discovery** | Your network appears in federated explorers |
| **Interoperability** | Seamless messaging with other Jeju networks |

## Your CLI

After forking, your CLI automatically uses your network name:

```bash
# If you named your network "acme"
acme dev              # Start localnet
acme fork list        # List your forks
acme status           # Check status
```

To install globally:
```bash
bun link
acme --help
```

## Apps & Services

All apps automatically pick up your branding:

| App | Purpose | Customization |
|-----|---------|---------------|
| Wallet | User wallet | Uses `branding.json` colors |
| Gateway | Bridge & staking | Uses chain config |
| Bazaar | NFTs & DeFi | Uses network name |
| Compute | AI inference | Uses branding |
| Node | Run services | Uses chain config |

## Part of the Jeju Network

Every network you launch with Jeju becomes part of the broader ecosystem:

- **OP Stack compatible** - Built on the proven OP Stack
- **Superchain ready** - Designed for Superchain integration
- **Federated** - Cross-chain by default, not an afterthought
- **AI-native** - Built for agents and humans

## Next Steps

1. [Deploy your first contracts](/deployment/contracts)
2. [Set up monitoring](/applications/monitoring)
3. [Run a compute node](/guides/run-compute-node)
4. [Become a solver](/guides/become-solver)

