# Agent Task: Token Package Documentation

## Scope
Research and document the Token package (`packages/token/`).

## Source Files to Analyze
- `packages/token/src/` - All source files
- `packages/token/deployments/` - Token deployments
- `packages/token/README.md` - Existing docs
- `packages/token/package.json` - Dependencies

## Research Questions
1. What is the JEJU token?
2. What tokenomics are implemented?
3. How does the token distribution work?
4. What utility does the token provide?
5. How does staking work?
6. What vesting schedules exist?
7. How does the presale work?
8. What governance features exist?

## Output Format

### File: `apps/documentation/packages/token.md`

```markdown
# Token Package

[One-sentence description - JEJU token management]

## Overview

[JEJU token, utility, distribution]

## JEJU Token

**Symbol:** JEJU
**Decimals:** 18
**Total Supply:** [amount]

### Utility
- Gas payments (via paymaster)
- Staking for node operators
- Governance voting
- Fee discounts

## Distribution

[Token allocation breakdown]

## Staking

\`\`\`typescript
import { TokenClient } from '@jejunetwork/token';

const token = new TokenClient({
  network: 'mainnet',
  privateKey: process.env.PRIVATE_KEY,
});

await token.stake(parseEther('1000'));
\`\`\`

## Vesting

[Vesting schedules for different allocations]

## Presale

[Presale mechanism]

## Governance

[Token-weighted voting]

## Contract Addresses

| Network | Address |
|---------|---------|
| Mainnet | `0x...` |
| Testnet | `0x...` |

## Related

- [Token Contracts](/contracts/tokens)
- [Staking](/contracts/staking)
- [Governance](/build/sdk/governance)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/token.md`

