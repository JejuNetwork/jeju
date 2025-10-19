# 🎯 Run This First

## Absolute Quickest Start

```bash
# 1. Start everything (from repo root)
bun run dev

# 2. Run unit tests (instant validation)
cd apps/gateway
NODE_ENV=test bun run test:unit

# 3. See: 32/32 tests passing ✅
```

## What Just Happened?

You verified that all 4 protocol tokens (elizaOS, CLANKER, VIRTUAL, CLANKERMON) are:
- ✅ Properly configured
- ✅ Have complete metadata
- ✅ Treated equally throughout the system
- ✅ Correctly filtered for bridging

## Next: Run Contract Tests

```bash
# Requires localnet running on port 9545
bun run test:contracts
```

## Then: Run A2A Tests

```bash
# Requires A2A server on port 4003
bun run test:a2a
```

## Finally: Run E2E Tests

```bash
# Requires all servers + deployed contracts
bun run test:e2e:headed
```

## See Full Docs

- `QUICKSTART.md` - Detailed quick start
- `README.md` - Complete guide
- `TEST_CHECKLIST.md` - Pre-deployment validation

