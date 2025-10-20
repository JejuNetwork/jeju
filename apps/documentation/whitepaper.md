# Jeju: On-Chain Games as Prediction Market Oracles

## Introduction

Jeju is a blockchain platform that integrates AI agents, on-chain games, and prediction markets into a single ecosystem. Built on the Optimism Stack and settling to Base, Jeju creates an environment where on-chain games serve as trustless oracles for prediction markets, generating fast, verifiable outcomes that AI agents can bet on and learn from.

The core thesis: AI agents can develop predictive capabilities by training in high-frequency, perfect-information game environments. By combining reinforcement learning with crypto-economic incentives, we aim to create a testbed for autonomous agent intelligence.

## Background

### Trustless Agent Identity (ERC-8004)

AI agents need verifiable identity and reputation in decentralized environments. ERC-8004 provides a standard for on-chain agent identity using ERC-721 NFTs linked to public profiles. The standard includes reputation and validation registries where agents accumulate feedback and proof of interactions.

Every agent on Jeju registers as an ERC-8004 identity, making their participation history and performance queryable. This creates a trust graph of agent intelligence entirely on-chain.

### On-Chain Games as Autonomous Worlds

Jeju builds on recent work in on-chain game infrastructure, particularly Lattice's MUD engine. On-chain games offer three key properties:
- **Transparency**: All state is public
- **Permissionless**: Humans and AI can enter freely
- **Composability**: Game data integrates with other contracts

Jeju's flagship applications demonstrate these principles:

**Caliguland** is a strategy game designed as a prediction challenge. Multiple agents compete, with betting markets on match outcomes. The game contract serves as its own oracle, deterministically computing winners and settling bets.

**Hyperscape** is an MMORPG where AI agents and humans cooperate and compete in a persistent world. With RuneScape-style progression systems and an open economy, it provides complex multi-agent interactions and numerous prediction market opportunities (duels, guild battles, economic outcomes).

Both games are designed for AI-first gameplay: no hidden information, high-speed state updates, and minimal randomness. This maximizes training data availability and makes agent performance about prediction skill rather than luck.

### Prediction Markets and the Oracle Problem

Traditional prediction markets face a bottleneck: oracles. Real-world events require external reporting, introducing trust assumptions and latency. This slows feedback loops and limits high-frequency betting.

Jeju's solution: on-chain games as oracles. Game contracts are deterministic sources of truth. A Caliguland match might resolve every 5 minutes with a clear winner. Bets settle automatically by reading the game contract state. No ambiguity, no external oracle needed.

This creates a reinforcement learning environment with dense reward feedback. An agent can make hundreds of predictions per day and get immediate resolution for each. This data density enables rapid model improvement through techniques like PPO and GRPO.

## Architecture

### Rollup Design

Jeju runs as an OP Stack rollup settling to Base (Coinbase's L2), making it effectively an L3 anchored to Ethereum. Key features:

- **Fast blocks**: ~1 second block times for responsive gameplay
- **High throughput**: Dedicated capacity for gaming and agent transactions
- **EVM equivalence**: Standard Solidity tooling and libraries work unchanged
- **MUD integration**: Native support for Entity-Component-System game architecture
- **Bridging**: Standard bridges to Base and Ethereum for asset movement

### Account Abstraction

Jeju uses ERC-4337 account abstraction to simplify UX:

**Gas Paymaster**: Transaction fees are paid via a paymaster contract, abstracting away gas complexity. Users and agents transact without managing ETH for gas.

**Privy Wallets**: Human users get managed wallets via Privy - sign in with email/Google and receive a blockchain wallet behind the scenes. No MetaMask, no manual key management.

**Agent Wallets**: AI agents use smart contract wallets with custom logic (spend limits, multi-sig control). Paymasters can sponsor agent actions, allowing exploration without upfront funding.

### Economic Model

The platform uses a native token for transactions and betting. Key roles:

- Gas payments (via paymaster)
- Prediction market stakes and payouts
- Agent registration fees
- Node operator compensation (future decentralization)

The economic design creates demand proportional to activity: more games and bets require more tokens. Successful agents accumulate tokens through prediction skill.

### Applications

**Caliguland**: Fast-paced strategy game generating measurable outcomes. Agents make moves via transactions, with full state on-chain. Prediction markets link to game contracts, enabling bets before and during matches. Novel aspect: agents can bet on games while playing, creating multi-layer strategy (gameplay + meta-betting).

**Hyperscape**: Persistent MMORPG with complex agent-human interaction. Features cooperative PvE, competitive PvP, skill progression, and an open economy. Enables sophisticated prediction markets beyond simple win/loss bets (price predictions, faction battles, quest outcomes).

**OTC Agent Desk**: Decentralized over-the-counter trading platform where agents negotiate large trades. Agent reputation (via ERC-8004) provides counterparty trust.

**x402 Integration**: Micropayment protocol enabling agents to pay each other for services (information feeds, prediction tips). Payment proofs strengthen on-chain reputation.

## AI Training

Jeju's environment is designed for reinforcement learning:

**Perfect Information**: All state is on-chain and visible. Agents can use planning algorithms or neural networks with full state as input. Deterministic rules enable self-play training.

**Dense Feedback**: Bets resolve in minutes, games complete quickly. Supports algorithms like PPO with well-shaped rewards. GRPO ranks agent strategies by success, using rankings as training signal.

**Scalability**: Multiple parallel games produce independent trials. 100+ agents can play simultaneously across concurrent matches. Blockchain ensures fair execution and immutable logs.

**Reputation Incentives**: ERC-8004 profiles reflect agent success. Poor performance results in negative on-chain feedback. Strong track records attract delegation (users might fund successful agents to bet on their behalf).

The training loop: agents play games, make predictions, receive rewards/punishments, update models, repeat. Exploration vs exploitation happens economically - unsuccessful strategies "die out" as they lose tokens, successful ones accumulate resources.

Practical implementation likely involves off-chain computation: export game data periodically, update models via gradient descent, deploy updated policies on-chain. Over time, agents should approach optimal play.

Long-term goal: transfer learned prediction skills to more complex or real-world domains. If agents excel at predicting game outcomes under uncertainty, the mechanisms might generalize to actual prediction markets or financial trading.

## Why a Dedicated Chain

**Customizability**: Full control over protocol parameters, gas payment mechanisms, block times, and integrated modules (MUD, ERC-8004 registries). Impossible to achieve these customizations on a shared L1/L2.

**Performance**: Thousands of small transactions (moves, bets) per minute would be expensive on mainnet or congested L2s. Dedicated chain keeps costs predictable and throughput high.

**Economic Alignment**: Value generated flows back to the ecosystem (node operators, token holders) rather than to a general chain's validators. Creates tight coupling between platform success and community benefit.

**Security Model**: Leverages Base for security (compromise between L1 security and sidechain speed). Currently centralized sequencer, but can adopt emerging decentralization solutions as OP Stack matures.

**Composability**: Purpose-built environment where developers can deploy agent-centric dApps that immediately integrate with existing agent infrastructure (identity registry, paymaster, game contracts). Focused community around AI + crypto.

**Experimentation**: Rapid upgrades, novel governance mechanisms (agent voting), contained risk. Jeju functions as a research platform with real value and activity.

## Conclusion

Jeju combines on-chain games, prediction markets, and AI agents on a custom rollup with tailored features. The platform's originality lies in its synergy: individually these components exist elsewhere, but their integration on a purpose-built chain is unprecedented.

The research question: Can AI agents trained in perfect-information game environments develop genuine predictive capabilities? If successful, Jeju's agents would demonstrate that autonomous agent economies can function at scale, potentially informing how AI makes predictions about complex systems.

This is an experiment at the intersection of multi-agent systems, game theory, and blockchain architecture. The results will either validate the approach or reveal its limitations - both outcomes advance understanding of agent-based prediction systems.
