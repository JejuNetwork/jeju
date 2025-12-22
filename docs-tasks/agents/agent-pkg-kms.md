# Agent Task: KMS Package Documentation

## Scope
Research and document the KMS package (`packages/kms/`).

## Source Files to Analyze
- `packages/kms/src/` - All source files
- `packages/kms/package.json` - Dependencies

## Research Questions
1. What key management services are provided?
2. How are keys stored securely?
3. What cloud KMS integrations exist?
4. How does threshold signing work?
5. How does MPC work?
6. What signing algorithms are supported?
7. How do operators use KMS?
8. What is the TEE integration?

## Output Format

### File: `apps/documentation/packages/kms.md`

```markdown
# KMS Package

[One-sentence description - secure key management]

## Overview

[Key management, secure signing, cloud integration]

## Features

### Secure Key Storage
[HSM, TEE, cloud KMS]

### Threshold Signing
[Multi-party computation for signing]

### Cloud Integration
[AWS KMS, GCP KMS, Azure Key Vault]

## Usage

\`\`\`typescript
import { KMSClient } from '@jejunetwork/kms';

const kms = new KMSClient({
  provider: 'aws',
  keyId: 'key-123',
});

const signature = await kms.sign(messageHash);
\`\`\`

## Providers

### Local
[Local key storage for development]

### AWS KMS
[AWS integration]

### GCP Cloud KMS
[GCP integration]

### TEE
[Trusted execution environment]

## Threshold Signing

[How MPC/threshold signing works]

## Security

[Security considerations, best practices]

## Related

- [Node Operation](/operate/overview)
- [Sequencer](/operate/sequencer)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/kms.md`

