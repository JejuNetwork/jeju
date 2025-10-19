# End-to-End Tests

Core Jeju infrastructure E2E tests.

## Tests

### Core Infrastructure

- **`defi.e2e.test.ts`** - DeFi protocol integration (Uniswap V4, Synthetix, Compound)
- **`uniswap-v4-integration.test.ts`** - Uniswap V4 deployment and functionality

These tests verify core Jeju DeFi infrastructure that's part of the base protocol.

## Vendor App E2E Tests

Vendor-specific E2E tests have been moved to their respective vendor app directories:

- **Cloud Platform:** `vendor/cloud/tests/e2e/`
- **Cross-Game (ERC-8004):** `vendor/tests/`
- **Individual Apps:** Each vendor app has its own `tests/` directory

## Running Tests

```bash
# Run core infrastructure E2E tests
bun test tests/e2e/

# Run all tests (including vendor if available)
bun run test
```

## Prerequisites

### Core Tests
- Localnet running (`bun run dev -- --minimal`)
- Contracts deployed
- Bun runtime

### Vendor Tests
See individual vendor app directories for their specific requirements.

## Adding New Core E2E Tests

Core E2E tests should:
1. Test fundamental Jeju infrastructure (not vendor apps)
2. Not depend on specific vendor applications
3. Work on a fresh localnet deployment
4. Be placed in this directory

For vendor-specific tests, add them to the vendor app's own test directory.

