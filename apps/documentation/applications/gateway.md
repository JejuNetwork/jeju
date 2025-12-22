# Gateway

The main portal for Jeju Network. Bridge assets, stake JEJU, register nodes, and manage tokens.

**Live at:** https://gateway.jejunetwork.org

## What It Does

| Feature | Description |
|---------|-------------|
| **Bridge** | Move ETH/tokens from Ethereum, Base to Jeju instantly |
| **Staking** | Stake JEJU to earn protocol fees |
| **Token Registry** | Register tokens for gas payments |
| **Node Registration** | Register as RPC/compute/storage provider |
| **JNS** | Register .jeju domains |

## Using the Bridge

Gateway uses EIL (Ethereum Interop Layer) for instant bridging. No 7-day waits.

1. Connect wallet
2. Select source chain (Ethereum or Base)
3. Enter amount
4. Click Bridge
5. Receive on Jeju in ~30 seconds

Behind the scenes, XLPs (liquidity providers) credit you instantly on Jeju, then claim your deposit from the source chain later.

**Supported assets:** ETH, USDC, USDT, WBTC, and registered tokens.

## Staking JEJU

Stake JEJU to:
- Earn protocol fee share
- Vote in governance
- Qualify for node operation

| Stake Duration | APY Boost |
|---------------|-----------|
| No lock | Base rate |
| 3 months | +10% |
| 6 months | +25% |
| 12 months | +50% |

## Registering a Token

Register your ERC-20 for gas payments:

1. Go to Gateway → Token Registry
2. Click "Register Token"
3. Provide:
   - Token contract address
   - Chainlink price oracle address
   - Registration fee (100 JEJU)
4. Once registered, users can pay gas in your token

**Requirements:**
- Token must have Chainlink-compatible oracle
- Minimum $10,000 liquidity on Jeju DEX

## Registering a Node

Register as an infrastructure provider:

1. Go to Gateway → Nodes
2. Click "Register Node"
3. Select type (RPC, Compute, Storage)
4. Stake required ETH
5. Enter your endpoint URL

| Node Type | Stake | Purpose |
|-----------|-------|---------|
| RPC | 0.5 ETH | Serve RPC requests |
| Compute | 1 ETH | AI inference |
| Storage | 0.5 ETH | IPFS storage |

## JNS (Jeju Name Service)

Register human-readable names:

1. Go to Gateway → JNS
2. Search for available name
3. Select duration (1-5 years)
4. Pay registration fee
5. Use `yourname.jeju` instead of 0x addresses

## Run Gateway Locally

```bash
cd apps/gateway
bun install
bun run dev
```

Runs on http://localhost:4001

## Environment Variables

```bash
VITE_RPC_URL=http://127.0.0.1:9545
VITE_CHAIN_ID=1337
VITE_WALLETCONNECT_PROJECT_ID=your_project_id
VITE_INDEXER_URL=http://127.0.0.1:4350/graphql
```

Full list in `apps/gateway/.env.example`.

## API Endpoints

Gateway also exposes APIs:

| Endpoint | Port | Purpose |
|----------|------|---------|
| `/api/bridge` | 4001 | Bridge status |
| `/api/nodes` | 4001 | Node registry |
| `/api/tokens` | 4001 | Token registry |
| `/ws` | 4001 | Real-time events |

## Customization

Fork and customize Gateway for your project:

```bash
cd apps/gateway
cp .env.example .env.local
# Edit branding in src/config/branding.ts
bun run build
```

---

<details>
<summary>📋 Copy as Context</summary>

```
Gateway - Jeju Network Portal

Live: https://gateway.jejunetwork.org

Features:
- Bridge: Ethereum/Base → Jeju, instant via EIL (~30s)
- Staking: Stake JEJU for fees + governance
- Token Registry: Register tokens for gas payments
- Node Registration: RPC (0.5 ETH), Compute (1 ETH), Storage (0.5 ETH)
- JNS: Register .jeju domains

Bridge flow:
1. Connect wallet
2. Select source chain
3. Enter amount
4. Click Bridge
5. Receive in ~30s (XLPs front liquidity)

Token registration:
- Need Chainlink oracle
- Need $10k liquidity
- Pay 100 JEJU fee

Run locally:
cd apps/gateway && bun install && bun run dev
Port 4001

Env vars: VITE_RPC_URL, VITE_CHAIN_ID, VITE_WALLETCONNECT_PROJECT_ID
```

</details>
