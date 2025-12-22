# Agent Task: SDK Package Documentation

## Scope
Research and document the SDK package (`packages/sdk/`).

## Source Files to Analyze
- `packages/sdk/src/` - All modules (50+ files)
- `packages/sdk/src/index.ts` - Exports
- `packages/sdk/src/client.ts` - Main client
- `packages/sdk/test/` - Test files showing usage
- `packages/sdk/package.json` - Dependencies
- `packages/sdk/README.md` - Existing docs

## Key Modules to Document
- `a2a/` - Agent-to-Agent protocol
- `agents/` - Agent management
- `amm/` - AMM interactions
- `bridge/` - Cross-chain bridge
- `compute/` - Compute services
- `crosschain/` - Cross-chain intents
- `defi/` - DeFi operations
- `dws/` - Decentralized Web Services
- `identity/` - ERC-8004 identity
- `names/` - JNS name service
- `payments/` - Paymaster, gasless
- `staking/` - Staking operations
- `storage/` - IPFS/storage

## Research Questions
1. How is JejuClient initialized?
2. What are all available modules?
3. What dependencies are required?
4. How does wallet connection work?
5. How are transactions signed and sent?
6. How do gasless transactions work?
7. What is the pattern for contract interactions?
8. How is error handling done?

## Output Format

### Files to Generate
1. `apps/documentation/build/sdk/installation.md`
2. `apps/documentation/build/sdk/client.md`
3. `apps/documentation/build/sdk/identity.md`
4. `apps/documentation/build/sdk/payments.md`
5. `apps/documentation/build/sdk/defi.md`
6. `apps/documentation/build/sdk/compute.md`
7. `apps/documentation/build/sdk/storage.md`
8. `apps/documentation/build/sdk/crosschain.md`

### Template for Each Module

```markdown
# SDK: [Module Name]

[One-sentence description]

## Installation

\`\`\`bash
bun add @jejunetwork/sdk
\`\`\`

## Basic Usage

\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY,
});

// Module-specific example
\`\`\`

## Methods

### methodName()
[Description, parameters, return type, example]

## Types

[Key TypeScript types for this module]

## Examples

### Example 1: [Use Case]
\`\`\`typescript
// Full working example
\`\`\`

## Error Handling

[Common errors, how to handle]

## Related

- [Other relevant docs]

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/sdk.md`

