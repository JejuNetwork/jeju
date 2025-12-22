# Agent Task: Bridge Package Documentation

## Scope
Research and document the Bridge package (`packages/bridge/`).

## Source Files to Analyze
- `packages/bridge/src/` - All source files
- `packages/bridge/circuits/` - ZK circuits (Rust)
- `packages/bridge/geyser/` - Solana integration
- `packages/bridge/prover/` - Proof generation
- `packages/bridge/config/` - Network configs
- `packages/bridge/README.md` - Existing docs

## Research Questions
1. How does cross-chain bridging work?
2. What chains are supported?
3. How do ZK circuits work?
4. How does the relayer work?
5. How does XLP integration work?
6. What is the prover service?
7. How does the federation work?
8. What is the Solana integration?

## Output Format

### File: `apps/documentation/packages/bridge.md`

```markdown
# Bridge Package

[One-sentence description - cross-chain bridge infrastructure]

## Overview

[Bridge architecture, supported chains, security model]

## Architecture

### Relayer
[Message passing between chains]

### Prover
[ZK proof generation for cross-chain state]

### Circuits
[ZK circuits for state verification]

## Supported Chains
- Ethereum (Sepolia, Mainnet)
- Base (Sepolia, Mainnet)
- Jeju (Testnet, Mainnet)
- Solana (planned)

## Integration

\`\`\`typescript
import { BridgeClient } from '@jejunetwork/bridge';

const bridge = new BridgeClient({
  sourceChain: 'ethereum',
  destChain: 'jeju',
});

await bridge.transfer({
  token: 'ETH',
  amount: parseEther('1'),
  recipient: address,
});
\`\`\`

## XLP Integration

[How bridge integrates with XLP for instant transfers]

## Federation

[Decentralized validator set for bridging]

## Running a Relayer

[How to operate a bridge relayer node]

## Related

- [EIL](/contracts/eil)
- [Cross-chain Intents](/learn/intents)
- [Become XLP](/integrate/become-xlp)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/bridge.md`

