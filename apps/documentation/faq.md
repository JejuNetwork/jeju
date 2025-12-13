# FAQ

Common questions about Jeju.

## General

### What is Jeju?

Jeju is an Ethereum L2 built on the OP-Stack, optimized for autonomous agents and gasless applications. It features 200ms block times, multi-token gas payments, and native agent infrastructure.

### How is Jeju different from other L2s?

| Feature | Jeju | Base | Arbitrum | Optimism |
|---------|------|------|----------|----------|
| Block Time | 200ms flashblocks | 2s | 250ms | 2s |
| Native Paymasters | ✅ | ❌ | ❌ | ❌ |
| Agent Identity (ERC-8004) | ✅ | ❌ | ❌ | ❌ |
| Cross-Chain Intents | ✅ | ❌ | ❌ | ❌ |
| A2A/MCP Protocols | ✅ | ❌ | ❌ | ❌ |

### Is Jeju secure?

Yes. Jeju uses the same security model as Optimism:
- Fraud proofs with 7-day challenge period
- Settlement on Ethereum mainnet
- Battle-tested OP-Stack codebase
- Multi-sig contract ownership
- Audited contracts

### What's the relationship with elizaOS?

Jeju is the native L2 for the elizaOS ecosystem, providing infrastructure for autonomous AI agents.

## Gas & Transactions

### Do users need ETH for gas?

No. Users can pay gas in any registered token (USDC, JEJU, elizaOS, etc.) via paymasters. Apps can also sponsor gas entirely.

### How do paymasters work?

Paymasters are smart contracts that pay gas on behalf of users:

1. **Multi-token**: User pays in their preferred token
2. **Sponsored**: App pays, user pays nothing

```typescript
// User pays in USDC
const tx = await wallet.sendTransaction({
  to: recipient,
  value: amount,
  paymaster: MULTI_TOKEN_PAYMASTER,
  paymasterToken: USDC_ADDRESS,
});
```

### What tokens can I use for gas?

Any token registered in the TokenRegistry. Default supported:
- ETH (native)
- JEJU
- USDC
- elizaOS

[Register your token →](/tutorials/register-token)

### How fast are transactions?

- **200ms**: Flashblock pre-confirmation (optimistic)
- **2 seconds**: Full block inclusion (safe to build on)
- **~10 minutes**: Batch posted to DA
- **~1 hour**: State root on Ethereum
- **7 days**: Final (withdrawals available)

## Bridging

### How do I bridge assets to Jeju?

**Fast (via XLPs)**: Instant, small fee
1. Go to [Gateway](https://gateway.jeju.network)
2. Connect wallet
3. Select amount and token
4. Click Bridge

**Standard (native bridge)**: 7-day withdrawal
1. Deposit to L1 bridge contract
2. Wait for L1 confirmation
3. Funds appear on Jeju

### How long do withdrawals take?

- **Fast withdrawal** (via XLPs): Instant, 0.1% fee
- **Standard withdrawal**: 7 days (fraud proof window)

### Are there bridging fees?

- Standard bridge: L1 gas only
- Fast bridge: 0.05-0.3% to XLPs
- XLPs set their own fees

## Development

### How do I deploy contracts?

```bash
forge create src/MyContract.sol:MyContract \
  --rpc-url https://rpc.jeju.network \
  --private-key $PRIVATE_KEY
```

Or use deployment scripts:

```bash
forge script script/Deploy.s.sol \
  --rpc-url https://rpc.jeju.network \
  --broadcast --verify
```

### What development tools work?

Standard Ethereum tooling:
- **Foundry** (recommended)
- Hardhat
- Remix
- Viem / Ethers.js
- Any EVM-compatible tool

### How do I run a local node?

```bash
git clone https://github.com/elizaos/jeju && cd jeju
bun install
bun run dev
```

This starts a full local environment at `http://localhost:9545`.

### Where are the contract ABIs?

```typescript
import { 
  JejuTokenAbi,
  IdentityRegistryAbi,
  MultiTokenPaymasterAbi,
} from '@jejunetwork/contracts';
```

### How do I get testnet tokens?

1. Get Sepolia ETH from [sepoliafaucet.com](https://sepoliafaucet.com)
2. Bridge to Jeju testnet via [Gateway](https://testnet-gateway.jeju.network)
3. Use faucet for test JEJU tokens

## Agents

### What is ERC-8004?

A standard for on-chain agent/application identity. It stores:
- Name and description
- A2A and MCP endpoints
- Metadata URI
- Trust labels

### What is A2A?

Agent-to-Agent protocol. Allows agents to:
- Discover each other on-chain
- Send tasks and receive results
- Coordinate multi-agent operations

### What is MCP?

Model Context Protocol. Allows AI models (Claude, GPT, etc.) to:
- Query blockchain data
- Execute transactions
- Interact with Jeju apps

### How do I register an agent?

```typescript
await identityRegistry.register(
  "My Agent",
  "Description",
  "https://myagent.com/a2a",
  "https://myagent.com/mcp",
  "ipfs://metadata"
);
```

## Node Operations

### How do I run an RPC node?

See [Run RPC Node](/operate/rpc-node). Requirements:
- 16GB RAM
- 500GB SSD
- 1,000 JEJU stake

### How do I become an XLP?

See [Become an XLP](/operate/xlp). Requirements:
- 1+ ETH stake on L1
- Liquidity on L2
- Always-on infrastructure

### What rewards do node operators earn?

| Role | Reward Source |
|------|---------------|
| RPC Node | Block rewards + tips |
| XLP | Bridge fees (0.05-0.3%) |
| Compute Node | Inference payments |
| Storage Node | Storage fees |
| Solver | Intent spreads |

## Troubleshooting

### Transaction pending forever

1. Check gas price: `cast gas-price --rpc-url $RPC`
2. If using paymaster, verify token balance
3. Try resending with higher gas

### Paymaster rejects my transaction

Common causes:
- **AA21**: Insufficient token balance
- **AA31**: Paymaster validation failed (check oracle)
- **AA33**: Paymaster needs refill

### Bridge transfer stuck

1. Check L1 transaction confirmed
2. Wait for L2 indexing (~2 min)
3. If using fast bridge, check XLP availability
4. Contact support with tx hash

### Contract verification failed

```bash
forge verify-contract $ADDRESS src/Contract.sol:Contract \
  --chain-id 420691 \
  --etherscan-api-key $KEY \
  --constructor-args $(cast abi-encode "constructor(uint256)" 123)
```

### RPC connection refused

1. Check RPC URL: `https://rpc.jeju.network`
2. Check network status: [status.jeju.network](https://status.jeju.network)
3. Try WebSocket: `wss://ws.jeju.network`

## Getting Help

- **Discord**: [discord.gg/elizaos](https://discord.gg/elizaos)
- **GitHub Issues**: [github.com/elizaos/jeju/issues](https://github.com/elizaos/jeju/issues)
- **Twitter**: [@elizaos](https://twitter.com/elizaos)

## More Questions?

Can't find your answer? [Ask on Discord](https://discord.gg/elizaos) or [open an issue](https://github.com/elizaos/jeju/issues/new).

