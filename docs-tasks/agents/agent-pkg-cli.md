# Agent Task: CLI Package Documentation

## Scope
Research and document the CLI package (`packages/cli/`).

## Source Files to Analyze
- `packages/cli/src/` - All commands
- `packages/cli/bin/` - Entry points
- `packages/cli/templates/` - Code templates
- `packages/cli/README.md` - Existing docs
- `packages/cli/package.json` - Dependencies

## Research Questions
1. What commands are available?
2. How is the CLI installed?
3. What subcommands exist?
4. How does project scaffolding work?
5. How does deployment work via CLI?
6. What configuration options exist?
7. How does the `fork` command work?
8. What network management commands exist?

## Output Format

### File: `apps/documentation/reference/cli.md`

```markdown
# CLI Reference

[One-sentence description - command-line tools for Jeju]

## Installation

\`\`\`bash
bun add -g @jejunetwork/cli
# or
bun run jeju [command]
\`\`\`

## Commands

### jeju init
Create a new Jeju project.

\`\`\`bash
jeju init [project-name] [--template <template>]
\`\`\`

**Options:**
- `--template` - Project template (dapp, agent, service)

### jeju dev
Start local development environment.

\`\`\`bash
jeju dev [--minimal] [--port <port>]
\`\`\`

### jeju deploy
Deploy contracts or applications.

\`\`\`bash
jeju deploy [target] [--network <network>]
\`\`\`

### jeju fork
Fork Jeju to create a new network.

\`\`\`bash
jeju fork [--name <name>] [--chain-id <id>]
\`\`\`

### jeju keys
Manage deployment keys.

\`\`\`bash
jeju keys generate
jeju keys export
jeju keys import <key>
\`\`\`

### jeju status
Check network and service status.

\`\`\`bash
jeju status [--network <network>]
\`\`\`

## Configuration

[Configuration file format, environment variables]

## Examples

### Create and Deploy a DApp
\`\`\`bash
jeju init my-dapp --template dapp
cd my-dapp
jeju dev
# In another terminal
jeju deploy --network testnet
\`\`\`

## Related

- [Quick Start](/getting-started/quick-start)
- [Deployment](/deployment/overview)

---
<details>
<summary>📋 Copy as Context</summary>

\`\`\`
[Full page content]
\`\`\`

</details>
```

## Research Output Location
`docs-tasks/research/cli.md`

