# Stage 2 POC Scripts

Scripts for building and deploying the Stage 2 decentralized OP Stack proof-of-concept.

## Setup

```bash
# Clone OP Stack fork
bun run scripts/stage2-poc/setup-optimism-fork.ts

# Build OP Stack components (after modifications)
bun run scripts/stage2-poc/build-op-stack.ts
```

## Deployment

```bash
# Deploy L1 contracts
bun run scripts/stage2-poc/deploy-l1.ts

# Deploy L2 genesis
bun run scripts/stage2-poc/deploy-l2.ts

# Start sequencer network
bun run scripts/stage2-poc/start-sequencers.ts
```

## Demo

```bash
# Run all demo scenarios
bun run scripts/stage2-poc/demo.ts
```

