# Agent Task: Contracts Package Documentation

## Scope
Research and document the Contracts package (`packages/contracts/`).

## Source Files to Analyze
- `packages/contracts/src/` - All Solidity contracts (300+ files)
- `packages/contracts/script/` - Deployment scripts
- `packages/contracts/test/` - Test files
- `packages/contracts/abis/` - ABI exports
- `packages/contracts/deployments/` - Deployed addresses
- `packages/contracts/README.md` - Existing docs

## Contract Categories to Document
- `tokens/` - ERC-20, JEJU token
- `identity/` - IdentityRegistry, ERC-8004
- `payments/` - Paymasters, TokenRegistry
- `defi/` - AMM, pools, perps
- `oif/` - InputSettler, OutputSettler, SolverRegistry
- `eil/` - L1StakeManager, CrossChainPaymaster
- `governance/` - DAO, voting, timelock
- `staking/` - Staking contracts
- `compute/` - Compute marketplace
- `storage/` - Storage contracts
- `jns/` - Jeju Name Service

## Research Questions
1. What is the contract hierarchy?
2. What are the core contracts?
3. How are upgrades handled?
4. What access control patterns are used?
5. How do contracts interact with each other?
6. What events are emitted?
7. What are deployment addresses per network?
8. How do developers integrate these contracts?

## Output Format

### Files to Generate
1. `apps/documentation/contracts/overview.md`
2. `apps/documentation/contracts/tokens.md`
3. `apps/documentation/contracts/identity.md`
4. `apps/documentation/contracts/payments.md`
5. `apps/documentation/contracts/defi.md`
6. `apps/documentation/contracts/oif.md`
7. `apps/documentation/contracts/eil.md`
8. `apps/documentation/contracts/jns.md`
9. `apps/documentation/contracts/staking.md`
10. `apps/documentation/contracts/compute.md`

### Template

```markdown
# [Contract Category]

[One-sentence description]

## Overview

[2-3 paragraphs about this contract category]

## Contracts

### ContractName

**Address (Mainnet):** `0x...`
**Address (Testnet):** `0x...`

[Contract description]

#### Key Functions

\`\`\`solidity
function functionName(param1 type, param2 type) external returns (type);
\`\`\`

[Function description, parameters, return value]

#### Events

\`\`\`solidity
event EventName(address indexed user, uint256 amount);
\`\`\`

## Integration

### Using SDK
\`\`\`typescript
import { JejuClient } from '@jejunetwork/sdk';

const client = new JejuClient({ network: 'mainnet' });
// Contract interaction
\`\`\`

### Direct Contract Calls
\`\`\`bash
cast call $CONTRACT_ADDRESS "functionName()" --rpc-url $RPC
\`\`\`

## Deployment

[How to deploy this contract]

## Security

[Security considerations, audits]

## Related

- [Related docs]

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/contracts.md`

