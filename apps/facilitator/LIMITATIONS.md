# x402 Facilitator - Known Limitations

## Contract-Level Limitations

### Network Hardcoding
**Issue:** The `X402Facilitator.sol` contract hardcodes `"jeju"` network and `"exact"` scheme in signature verification.

**Location:** `packages/contracts/src/x402/X402Facilitator.sol` lines 147-148, 222-223, 327-328

**Impact:**
- Contract will ONLY verify payments signed for `"jeju"` network
- Payments signed for other networks (Base, Ethereum, etc.) will fail verification
- Contract is effectively Jeju-only

**Workaround:**
- Deploy separate contract instances per network
- Or use different facilitator contracts for different networks

**Future Fix:**
- Make network/scheme configurable in contract constructor
- Or pass network/scheme as parameters to `settle()` function

---

### Scheme Support
**Status:** ✅ Both `"exact"` and `"upto"` schemes are supported.

**Implementation:**
- Contract accepts both schemes in signature verification
- Service validates `exact` (amount == maxAmountRequired) and `upto` (amount <= maxAmountRequired)
- `/supported` endpoint returns both schemes

---

## Service-Level Limitations

### Nonce Cache Persistence
**Issue:** Nonce cache is in-memory and lost on restart.

**Impact:**
- Brief window for duplicate payment attempts after restart
- On-chain contract is authoritative, so duplicates will fail on-chain

**Mitigation:**
- On-chain nonce check is always performed
- Local cache is optimization only

**Future Fix:**
- Add Redis/shared cache for multi-replica deployments

---

### EIP-3009 Gasless Payments
**Status:** ✅ Fully implemented and exposed via HTTP API.

**Implementation:**
- Contract has `settleWithAuthorization()` function
- HTTP API exposes `POST /settle/gasless` endpoint
- Requires EIP-3009 authorization signature from payer
- Service pays gas fees on behalf of payer

---

## Integration Limitations

### vendors/cloud Integration
**Status:** ✅ Fully integrated.

**Implementation:**
- Created `vendor/cloud/lib/services/facilitator.ts` - Facilitator service wrapper
- Created `vendor/cloud/lib/middleware/x402-handler.ts` - Payment handler utilities
- Created `vendor/cloud/lib/middleware/x402-route.ts` - Route helpers
- Updated `/api/v1/embeddings/route.ts` to support x402 payments
- Added integration tests in `vendor/cloud/tests/integration/x402.test.ts`
