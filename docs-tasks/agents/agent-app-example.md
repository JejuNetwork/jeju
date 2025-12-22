# Agent Task: Example App Documentation

## Scope
Research and document the Example application (`apps/example-app/`).

## Source Files to Analyze
- `apps/example-app/src/` - Source files
- `apps/example-app/build.ts` - Build script
- `apps/example-app/deploy.ts` - Deploy script
- `apps/example-app/README.md` - Existing docs
- `apps/example-app/jeju-manifest.json` - Manifest

## Research Questions
1. What is this example app demonstrating?
2. What patterns does it showcase?
3. How does jeju-manifest.json work?
4. How is the build process structured?
5. How is deployment handled?
6. What contracts does it interact with?
7. What SDK features does it use?
8. How can developers use this as a template?

## Output Format

### File: `apps/documentation/apps/example-app.md`

```markdown
# Example App

[One-sentence description - template for building Jeju apps]

## Overview

[2-3 paragraphs about what the example demonstrates, how to use as template]

## What It Demonstrates

### Jeju Manifest
[How to configure app for Jeju deployment]

### SDK Integration
[How to use @jejunetwork/sdk]

### Contract Interaction
[How to interact with Jeju contracts]

### Build & Deploy
[Build and deployment patterns]

## Project Structure

[Directory structure explanation]

## Getting Started

\`\`\`bash
# Clone as template
cp -r apps/example-app my-app
cd my-app

# Install dependencies
bun install

# Run locally
bun run dev

# Deploy to Jeju
bun run deploy
\`\`\`

## Jeju Manifest

\`\`\`json
{
  "name": "my-app",
  "type": "dapp",
  "commands": { "dev": "bun run dev" },
  "ports": { "main": 3000 },
  "autoStart": false
}
\`\`\`

## Customization

[How to customize for your use case]

## Related

- [Deploy DApp](/deployment/contracts)
- [SDK Getting Started](/build/sdk/installation)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/example-app.md`

