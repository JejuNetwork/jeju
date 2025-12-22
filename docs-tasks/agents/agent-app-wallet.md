# Agent Task: Wallet App Documentation

## Scope
Research and document the Wallet application (`apps/wallet/`).

## Source Files to Analyze
- `apps/wallet/` - All source files
- `apps/wallet/package.json` - Dependencies

## Research Questions
1. What type of wallet is this (extension, embedded, mobile)?
2. What features does it provide?
3. How does it integrate with paymasters for gasless tx?
4. What chains does it support?
5. How does it handle ERC-4337?
6. What security features does it have?
7. How does account abstraction work?
8. How does it integrate with Jeju apps?

## Output Format

### File: `apps/documentation/apps/wallet.md`

```markdown
# Wallet

[One-sentence description]

## Overview

[2-3 paragraphs explaining wallet purpose, AA features, gasless support]

## Features

### Account Abstraction
[Smart contract wallets, recovery, multi-sig]

### Gasless Transactions
[Paymaster integration, sponsored gas]

### Multi-Chain
[Supported networks, bridging]

### Security
[Key management, biometrics, recovery]

## Architecture

[Wallet architecture, key storage, transaction flow]

## Integration

### For Developers
[How to integrate wallet into dapps]

### For Users
[Getting started with wallet]

## Configuration

[Settings, network config]

## Development

\`\`\`bash
cd apps/wallet
bun install
bun run dev
\`\`\`

## Related

- [Gasless Transactions](/learn/gasless)
- [SDK Payments](/build/sdk/payments)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/wallet.md`

