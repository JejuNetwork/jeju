# Agent Task: Overview & Architecture Documentation

## Scope
Write the main landing page and architecture documentation by synthesizing all app/package research.

## Dependencies
- All app research outputs from `docs-tasks/research/`
- All package research outputs from `docs-tasks/research/`

## Research Questions
1. What is Jeju's core value proposition?
2. How do all components fit together?
3. What differentiates Jeju from other L2s?
4. What is the complete feature set?
5. Who are the target users?
6. What is the technology stack?
7. How does the network operate?
8. What is the roadmap?

## Output Files

### 1. `apps/documentation/index.md`

```markdown
---
layout: home
hero:
  name: Jeju
  text: The L2 Built for Agents
  tagline: 200ms blocks. Gasless transactions. Native agent infrastructure.
  actions:
    - theme: brand
      text: Get Started →
      link: /getting-started/quick-start
    - theme: alt
      text: Why Jeju?
      link: /learn/why-jeju
---

## Start Building in 60 Seconds

[Quick start code snippet]

## Choose Your Path

### Developers Building DApps
[SDK, RPC, DWS - alternative to Privy/Alchemy]

### Developers Deploying on Jeju
[Deploy apps, contracts, agents]

### Liquidity Providers & Integrators
[EIL, OIF, market making]

### End Users
[Using Gateway, Bazaar, Wallet]

## The Stack

[Visual representation of architecture layers]

## Network Status

[Mainnet, testnet, localnet info]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 2. `apps/documentation/learn/architecture.md`

```markdown
# Architecture

[Comprehensive architecture documentation]

## Stack Layers

### Applications Layer
[All apps and their roles]

### Smart Contracts Layer
[Contract categories and interactions]

### Jeju L2
[OP-Stack, Flashblocks, execution]

### Data Availability
[EigenDA, fallback]

### Settlement
[Ethereum, fraud proofs]

## Key Protocols

### ERC-4337 (Account Abstraction)
[How paymasters enable gasless]

### ERC-8004 (Agent Identity)
[On-chain agent registry]

### ERC-7683 (Cross-Chain Intents)
[OIF implementation]

### EIL (Ethereum Interop Layer)
[XLP-based instant bridging]

## Service Architecture

[How services communicate]

## Data Flow

[Intent execution, paymaster flow, agent communication]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

### 3. `apps/documentation/learn/why-jeju.md`

```markdown
# Why Jeju?

[Value proposition, differentiators, use cases]

## Problems Solved

### For Developers
[Alternative to Privy/Alchemy]

### For Users
[Gasless, fast, agent-native]

### For LPs/Integrators
[Cross-chain opportunity]

## Differentiators

[Speed, gasless, agents, cross-chain]

## Use Cases

[Real examples]

---
<details>
<summary>📋 Copy as Context</summary>
[Full page]
</details>
```

## Research Output Location
`docs-tasks/research/overview.md`

