# Gateway

Gateway is the infrastructure portal for Jeju Network. It's where users bridge assets, stake tokens, register nodes, and manage infrastructure. Think of it as the control panel for interacting with Jeju's core protocol.

**URLs:** Localnet at http://127.0.0.1:4001, testnet at https://gateway-testnet.jeju.network, mainnet at https://gateway.jeju.network

## Bridging

Bridging moves assets between external chains (Ethereum, Base) and Jeju. There are two modes available.

### Standard Bridge (OP Bridge)

The standard bridge uses Optimism's native bridge infrastructure. Deposits from L1 to L2 take approximately 10 minutes. Withdrawals from L2 to L1 require a 7-day challenge period for security.

### Fast Bridge (EIL)

The fast bridge uses XLPs (Cross-chain Liquidity Providers) for instant transfers. Deposits complete in approximately 30 seconds, and withdrawals take about 15 minutes.

XLPs front liquidity for users who want instant transfers. When a user deposits on L1, an XLP immediately credits them on L2. The XLP then claims the funds later via the standard bridge. XLPs charge a small fee (0.1-0.5%) for this service.

### Using the Bridge

Navigate to `/bridge`, select your source chain (Ethereum or Base), choose the token and amount, then select either Standard mode (lower fee, longer wait) or Fast EIL mode (higher fee, instant). Confirm the transaction in your wallet and wait for confirmation.

ETH and USDC support fast bridging with 0.1% fees. JEJU has 0.2% fast bridge fees, and other ERC-20 tokens have 0.5% fees with limited availability.

## Staking

Staking lets you earn fees by providing liquidity. There are two types of staking available.

### Liquidity Staking (Paymaster Pools)

When users pay gas in tokens like USDC, the Paymaster needs liquidity to cover the actual ETH gas cost. Stakers provide this liquidity and earn 50% of the swap fees.

The process works like this: a user pays gas in USDC, the Paymaster swaps USDC to ETH using staked liquidity, the Paymaster pays gas in ETH, and stakers receive their share of the fees.

To stake, navigate to `/stake`, choose a pool (ETH, USDC, or JEJU), enter the amount, approve the token spend, and confirm the stake transaction. Fees are paid continuously as transactions occur and can be claimed anytime from the dashboard. APY varies based on network usage.

### Unstaking

Navigate to `/stake`, click "Unstake" on your position, enter the amount, wait for the 7-day cooldown period, then claim your tokens. The cooldown prevents flash-loan attacks and ensures liquidity stability for the paymaster.

## Node Registration

RPC nodes can stake to join the network and earn rewards for serving requests.

### Requirements

Nodes need at least 8 CPU cores, 16 GB RAM, 500 GB SSD storage, 100 Mbps bandwidth, and a minimum stake of 1,000 JEJU or equivalent.

### Registration Process

Navigate to `/nodes`, click "Register Node", enter your RPC endpoint URL (must be publicly accessible), select your stake token and amount, then submit the registration. Your node will be validated by the network and start receiving RPC requests and earning rewards once validated.

Nodes earn from base rewards (inflation distributed to staked nodes) and request fees (micropayments for RPC requests when x402 is enabled). Nodes can be slashed for extended downtime over 4 hours, serving incorrect data, or malicious behavior.

## Token Registry

Any ERC-20 token can be registered for gas payments via the paymaster. Once registered, users holding that token can pay gas fees with it instead of ETH. This is useful for DAOs wanting members to transact without ETH, games wanting seamless UX with game tokens, and DeFi protocols wanting single-token experiences.

### Registration Process

Navigate to `/tokens`, click "Register Token", enter the token address, price oracle address (Chainlink-compatible), and min/max fee bounds. Pay the 0.1 ETH registration fee and submit. The token must be ERC-20 compliant, have a reliable price oracle, and have sufficient liquidity for swaps.

## Agent Registry

ERC-8004 agents are registered here to obtain on-chain identity. An ERC-8004 agent is an autonomous entity with an on-chain identity (address plus metadata), an A2A endpoint for task execution, an MCP endpoint for knowledge queries, and verifiable capabilities.

Navigate to `/apps`, click "Register App", enter the name, description, A2A endpoint URL, MCP endpoint URL, and metadata URI (IPFS link to full metadata), then submit. Once registered, other agents and applications can discover and interact with your agent.

## Intent Viewer

The intent viewer monitors OIF (Open Intents Framework) operations in real-time. Intents are declarative requests that solvers fulfill. Instead of specifying exact transaction steps, users declare what they want (like "swap 100 USDC on Ethereum for at least 99.5 USDT on Jeju") and solvers compete to fulfill the intent with the best execution.

Navigate to `/intents` to view all pending intents. You can filter by source/destination chain, token pair, user address, or status.

## API Endpoints

Gateway exposes several API endpoints. The web UI runs on port 4001, the node API on port 4002, A2A on port 4003, and WebSocket on port 4012.

### A2A Skills

Agents can interact with Gateway using these skills: `bridge` for bridging tokens (parameters: sourceChain, destChain, token, amount), `stake` for staking tokens (pool, amount), `unstake` for unstaking (pool, amount), `register_node` for registering RPC nodes (endpoint, stake), and `register_token` for registering tokens (address, oracle).

```bash
curl -X POST http://localhost:4003/a2a \
  -H "Content-Type: application/json" \
  -d '{
    "type": "task",
    "task": {
      "skill": "bridge",
      "parameters": {
        "sourceChain": 1,
        "destinationChain": 420691,
        "token": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
        "amount": "1000000000"
      }
    }
  }'
```

## Setup & Configuration

Install with `cd apps/gateway && bun install`.

Create `.env` with `VITE_WALLETCONNECT_PROJECT_ID` (required), `VITE_NETWORK` (localnet/testnet/mainnet), and optional overrides for `VITE_RPC_URL` and `VITE_INDEXER_URL`.

Run development with `bun run dev`. For production, run `bun run build` then `bun run preview`.

## Testing

Run unit tests with `bun run test:unit`, E2E tests with `bun run test:e2e` (requires running chain), and wallet tests with `bun run test:wallet` (requires headed browser).

## Deployment

### Localnet

Gateway starts automatically with `bun run dev` from the root.

### Testnet/Mainnet

Build the production bundle:

```bash
bun run build
```

Deploy via Kubernetes:

```bash
cd packages/deployment/kubernetes/helmfile
helmfile -e testnet -l app=gateway sync
```

### Required Secrets for Production

Configure in AWS Secrets Manager or environment:
- `VITE_WALLETCONNECT_PROJECT_ID` — WalletConnect project ID
- Contract addresses are loaded from `packages/config/contracts.json`

### Docker

```bash
docker build -t jeju-gateway .
docker run -p 4001:4001 -e VITE_NETWORK=testnet jeju-gateway
```

## Common Issues

"Insufficient liquidity for fast bridge" means there's not enough XLP liquidity for instant bridging. Use standard mode or try a smaller amount.

"Price oracle not responding" means the registered token's price oracle is not returning data. Contact the token issuer.

"Node validation failed" means your RPC endpoint is not accessible or not returning correct data. Ensure the endpoint is publicly accessible, the SSL certificate is valid, and the node is fully synced.

## Next Steps

- [Become an XLP](/guides/become-xlp) — Provide bridge liquidity
- [Run an RPC Node](/guides/run-rpc-node) — Join the node network
- [Register a Token](/guides/register-token) — Enable gas payments
