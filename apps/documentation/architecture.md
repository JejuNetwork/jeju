# Architecture

Jeju is an OP-Stack L2 that settles on Ethereum with 200ms Flashblocks and EigenDA for data availability.

## Stack Layers

At the top are the **Applications** — Gateway, Bazaar, Compute, Storage, Crucible, and Indexer. These are user-facing services that interact with the blockchain.

Below that are the **Smart Contracts** — Tokens, Identity, Payments, OIF, EIL, Compute, and DeFi contracts. These implement the core protocol logic.

The **Jeju L2** layer runs op-reth for execution and op-node for consensus, producing 200ms Flashblocks.

**Data Availability** is handled by EigenDA with Ethereum calldata as a fallback.

Finally, the **Settlement Layer** is Ethereum mainnet where state roots are posted and fraud proofs are verified.

## OP-Stack Components

**op-reth** is the Rust execution client that processes transactions. **op-node** is the consensus client that derives L2 blocks from L1 data. **op-batcher** batches L2 transactions and posts them to EigenDA/L1. **op-proposer** posts L2 state roots to Ethereum. **op-challenger** monitors for fraud and submits proofs.

## Block Times

A **Flashblock** provides pre-confirmation from the sequencer in 200ms. A **Full block** is finalized on L2 in 2 seconds. **Batches** are posted to the data availability layer approximately every 10 minutes. **State roots** are posted to Ethereum approximately every hour. The **Challenge period** for fraud proofs is 7 days.

## Transaction Flow

A user submits a transaction to the sequencer and receives a Flashblock confirmation in 200ms. The transaction is included in a full block within 2 seconds, then batched with others in about 10 minutes. The state root is posted to Ethereum within an hour. After 7 days, withdrawals finalize.

## Fee Structure

The total fee equals the execution fee plus the L1 data fee. The execution fee (gas used times gas price) goes to the sequencer. The L1 data fee (calldata bytes times L1 gas price) covers settlement costs. L1 data fees are significantly reduced by using EigenDA.

## Security Model

Jeju uses **fraud proofs** where op-challenger monitors L2 state. The **7-day challenge period** provides time for fraud proof submission. **Data availability** is ensured by EigenDA with Ethereum calldata fallback. The **trust assumption** is Ethereum security plus one honest challenger.

## Key Protocols

### ERC-4337 (Account Abstraction)

Enables smart contract wallets and paymasters for gasless and multi-token transactions. User Operations flow through a Bundler to the EntryPoint, which calls the Paymaster before executing the transaction.

### ERC-8004 (Agent Identity)

On-chain registry for applications and AI agents. Stores metadata (name, description, endpoints), enables A2A/MCP endpoint discovery, and tracks trust labels and reputation.

### ERC-7683 (Cross-Chain Intents)

Standard for expressing user intent across chains. Users create intents, solvers fill them on the destination chain, oracles verify the source, then settlement occurs.

### EIL (Ethereum Interop Layer)

Trustless cross-chain without traditional bridges. Users deposit on the source chain, XLPs (Cross-chain Liquidity Providers) provide liquidity, and users receive funds instantly on Jeju. XLPs stake on L1, provide liquidity on L2, and earn fees.

## Service Architecture

**Gateway** on port 4001 is the primary entry point with Bridge UI, Staking, Token Registry, and Node Registration. It exposes A2A on port 4003, WebSocket on port 4012, and Node API on port 4002.

**Indexer** on port 4350 provides a GraphQL API and event indexing, serving data to all apps.

**Compute** on port 4007 offers AI Inference and SSH/Docker access.

**Storage** on port 4010 handles IPFS, Arweave, and pinning.

All services connect to the **Jeju L2** on port 9545 through the Smart Contracts Layer.

## Data Flow

### Intent Execution

A user creates an intent on the source chain via InputSettler. Solvers see the intent via the Indexer or WebSocket. The solver fills on the destination chain via OutputSettler. An oracle attests to the source chain state. The solver claims payment from InputSettler.

### Paymaster Flow

A user submits a UserOperation with paymaster data. The Bundler calls EntryPoint.handleOps(). EntryPoint calls Paymaster.validatePaymasterUserOp(). The Paymaster checks token balance and oracle price. The transaction executes, the paymaster receives tokens, and gas is paid in ETH from the paymaster's deposit.

### Agent Communication

Agent A discovers Agent B via IdentityRegistry. A reads B's A2A endpoint from on-chain metadata. A sends a task to B's /a2a endpoint. B executes the task, possibly calling other agents. Results are returned, optionally paid via x402.
