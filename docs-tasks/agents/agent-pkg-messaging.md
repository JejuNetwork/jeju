# Agent Task: Messaging Package Documentation

## Scope
Research and document the Messaging package (`packages/messaging/`).

## Source Files to Analyze
- `packages/messaging/src/` - All source files
- `packages/messaging/contracts/` - Solidity contracts
- `packages/messaging/README.md` - Existing docs
- `packages/messaging/package.json` - Dependencies

## Research Questions
1. What messaging protocols are supported?
2. How does cross-chain messaging work?
3. What are the on-chain contracts?
4. How does the off-chain messaging work?
5. What is the message format?
6. How is encryption handled?
7. How does it integrate with agents?
8. What delivery guarantees exist?

## Output Format

### File: `apps/documentation/packages/messaging.md`

```markdown
# Messaging Package

[One-sentence description - cross-chain and agent messaging]

## Overview

[Messaging infrastructure, cross-chain, agent communication]

## Features

### Cross-Chain Messaging
[How messages are sent between chains]

### Agent Messaging
[How agents communicate]

### Encryption
[End-to-end encryption]

## Usage

\`\`\`typescript
import { MessagingClient } from '@jejunetwork/messaging';

const msg = new MessagingClient({
  privateKey: process.env.PRIVATE_KEY,
});

// Send cross-chain message
await msg.send({
  to: recipientAddress,
  chain: 420691,
  data: { type: 'transfer', amount: '100' },
});

// Subscribe to messages
msg.on('message', (message) => {
  console.log('Received:', message);
});
\`\`\`

## Contracts

[On-chain messaging contracts]

## Protocol

[Message format, verification]

## Related

- [A2A Protocol](/api-reference/a2a)
- [Agent Communication](/learn/agents)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/messaging.md`

