# Core Concepts

Understanding Jeju's key primitives.

## Account Abstraction (ERC-4337)

Traditional Ethereum requires EOAs (externally owned accounts) to pay gas in ETH. Account abstraction changes this.

### What It Enables
- **Smart contract wallets** — Accounts with custom logic
- **Gasless transactions** — Someone else pays
- **Multi-token gas** — Pay in USDC, JEJU, etc.
- **Batched transactions** — Multiple actions in one tx
- **Social recovery** — Recover wallet without seed phrase

### How It Works

```
User creates UserOperation
        ↓
Bundler collects UserOps
        ↓
Bundler submits to EntryPoint contract
        ↓
EntryPoint validates with Paymaster
        ↓
Paymaster checks payment (tokens, sponsorship)
        ↓
Transaction executes
        ↓
Paymaster receives payment
```

### Jeju's Implementation

Jeju deploys the standard EntryPoint contracts plus:

- **MultiTokenPaymaster** — Accept any registered token for gas
- **SponsoredPaymaster** — Apps pay for user transactions
- **TokenRegistry** — Track accepted tokens and price oracles

## Paymasters

Paymasters are contracts that pay for gas on behalf of users.

### Multi-Token Paymaster

Users pay gas in any registered token:

```typescript
const userOp = {
  sender: walletAddress,
  callData: encodedCall,
  paymasterAndData: encodePaymasterData(
    MULTI_TOKEN_PAYMASTER,
    USDC_ADDRESS,
    parseUnits("5", 6) // Max 5 USDC for gas
  ),
};
```

The paymaster:
1. Checks the user has enough tokens
2. Queries the price oracle for ETH/token rate
3. Calculates required token amount
4. Pulls tokens from user after execution
5. Uses its own ETH deposit to pay actual gas

### Sponsored Paymaster

Apps deposit ETH and whitelist contracts/users:

```typescript
// App creates paymaster
const paymaster = await factory.createSponsoredPaymaster(
  appWallet,
  [gameContract], // Sponsored contracts
);

// App deposits ETH
await paymaster.deposit({ value: parseEther("10") });

// All calls to gameContract are now gasless for users
```

## Intents (ERC-7683)

Intents express *what* you want, not *how* to do it.

### Traditional Flow
1. User bridges tokens (5-20 min)
2. User swaps on DEX
3. User sends to recipient
4. Multiple transactions, multiple fees

### Intent Flow
1. User signs intent: "Send 100 USDC to 0x... on Jeju"
2. Solver fills the order (using their own liquidity)
3. User pays solver on source chain
4. One signature, solver handles complexity

### Jeju's OIF (Open Intents Framework)

```
Source Chain                    Destination Chain (Jeju)
┌─────────────┐                ┌─────────────────────┐
│ InputSettler│                │ OutputSettler       │
│   - createIntent()           │   - fillIntent()    │
│   - claimPayment()           │                     │
└─────────────┘                └─────────────────────┘
       ↑                              ↑
       │         SolverRegistry       │
       └──────────(on Jeju)───────────┘
```

Solvers stake on Jeju, monitor intents across chains, and compete to fill them.

## Agent Identity (ERC-8004)

On-chain registry for applications and AI agents.

### What's Registered
- **Name** and description
- **A2A endpoint** — Agent-to-Agent protocol
- **MCP endpoint** — Model Context Protocol (for AI models)
- **Metadata URI** — IPFS link to extended info
- **Trust labels** — Verified, trusted, partner

### Why It Matters

Agents can:
- Discover other agents on-chain
- Verify identity before interaction
- Build reputation over time
- Be discoverable by AI models via MCP

```typescript
// Query agents
const agents = await indexer.query(`{
  agents(where: { active: true }) {
    address
    name
    a2aEndpoint
  }
}`);

// Interact via A2A
const response = await fetch(agent.a2aEndpoint, {
  method: 'POST',
  body: JSON.stringify({ type: 'task', task: { ... } }),
});
```

## Cross-Chain Liquidity (EIL)

EIL = Ethereum Interop Layer. Trustless bridging without traditional bridges.

### Participants

**Users** want to move assets to Jeju.

**XLPs (Cross-chain Liquidity Providers)** stake on L1 and provide liquidity on L2:
- Stake ETH/tokens on Ethereum
- Maintain liquidity pools on Jeju
- Earn fees from every transfer

### Flow

```
1. User deposits on Ethereum (InputSettler)
2. XLP sees deposit, provides tokens on Jeju instantly
3. User has funds on Jeju in seconds
4. XLP claims user's deposit after confirmation
```

No wrapped tokens. No 7-day wait for normal transfers.

## x402 Payments

HTTP payment protocol for pay-per-request APIs.

### How It Works

```
1. Client calls API
2. Server returns 402 Payment Required + payment details
3. Client signs payment
4. Client retries with X-Payment header
5. Server verifies, serves response
6. Server settles payment on-chain
```

### Use Cases
- AI inference (pay per token)
- Storage uploads (pay per MB)
- Premium API access
- Compute rentals

```typescript
// Server middleware
app.use(x402Middleware({
  recipient: PAYMENT_ADDRESS,
  amount: parseEther("0.001"),
  facilitator: FACILITATOR_URL,
}));

// Client
const client = new X402Client({ wallet });
const response = await client.fetch("https://api.example.com/inference");
```

## Flashblocks

200ms pre-confirmation from the sequencer.

### Block Timeline

| Stage | Time | What Happens |
|-------|------|--------------|
| Flashblock | 200ms | Sequencer pre-confirms |
| Full Block | 2s | Block included in chain |
| Batch | ~10min | Posted to EigenDA |
| Settlement | ~1hr | State root on Ethereum |
| Finality | 7 days | Challenge period ends |

### When to Use What

- **Flashblock**: UI feedback, optimistic updates
- **Full Block**: State you'll build on
- **Settlement**: Cross-chain proofs
- **Finality**: Withdrawals to L1

## Next Steps

- [Architecture](/learn/architecture) — How these pieces fit together
- [Quick Start](/build/quick-start) — Start building
- [Tutorials](/tutorials/overview) — Hands-on examples

