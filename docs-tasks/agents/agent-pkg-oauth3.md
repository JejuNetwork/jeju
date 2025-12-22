# Agent Task: OAuth3 Package Documentation

## Scope
Research and document the OAuth3 package (`packages/oauth3/`).

## Source Files to Analyze
- `packages/oauth3/src/` - All source files
- `packages/oauth3/docker/` - Docker configs
- `packages/oauth3/README.md` - Existing docs
- `packages/oauth3/package.json` - Dependencies

## Research Questions
1. What is OAuth3 and how does it differ from OAuth2?
2. How does wallet-based authentication work?
3. What authentication flows are supported?
4. How do dapps integrate OAuth3?
5. What is the session management?
6. How does it integrate with ERC-8004 identity?
7. What scopes/permissions are available?
8. How does token refresh work?

## Output Format

### File: `apps/documentation/packages/oauth3.md`

```markdown
# OAuth3 Package

[One-sentence description - wallet-based authentication]

## Overview

[OAuth3 concept, wallet auth, integration with Web3]

## How It Works

[Authentication flow using wallet signatures]

## Integration

### For DApp Developers

\`\`\`typescript
import { OAuth3Client } from '@jejunetwork/oauth3';

const auth = new OAuth3Client({
  clientId: 'my-app',
  redirectUri: 'https://myapp.com/callback',
});

// Start auth flow
const { authUrl } = await auth.createAuthUrl();
window.location.href = authUrl;

// Handle callback
const tokens = await auth.handleCallback(code);
\`\`\`

### For Service Providers

\`\`\`typescript
import { OAuth3Provider } from '@jejunetwork/oauth3';

const provider = new OAuth3Provider({
  privateKey: process.env.PRIVATE_KEY,
});

// Verify token
const user = await provider.verifyToken(token);
\`\`\`

## Scopes

[Available permission scopes]

## Session Management

[Token refresh, session expiry]

## Identity Integration

[How OAuth3 uses ERC-8004 identity]

## Related

- [Identity Registry](/contracts/identity)
- [SDK Identity](/build/sdk/identity)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/oauth3.md`

