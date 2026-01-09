# Storage Bug Investigation

**Date:** 2026-01-07
**Branch:** fix/onboarding-issues

## Summary

The crucible storage SDK is using incorrect endpoint paths. The storage service at `http://127.0.0.1:4030` requires the `/storage` prefix for upload operations, but the SDK in `apps/crucible/api/sdk/storage.ts` is calling endpoints without this prefix.

## Test Results

### Test 1: Direct upload to /upload (without /storage prefix)

**Command:**
```bash
curl -s -X POST "http://127.0.0.1:4030/upload" \
  -F "file=@-;filename=test.json" \
  -F "tier=popular" <<< '{"test": true}'
```

**Response:**
```json
{"error":"NOT_FOUND"}
```

**Result:** FAILED - Endpoint does not exist at this path.

---

### Test 2: Upload to /storage/upload (with prefix)

**Command:**
```bash
curl -s -X POST "http://127.0.0.1:4030/storage/upload" \
  -F "file=@-;filename=test.json" \
  -F "tier=popular" <<< '{"test": true}'
```

**Response:**
```json
{
  "cid": "QmYKYGfHZJfwrbuyd6V9ULaFS8vjvGYeAvjVa81phNmJ1U",
  "size": 15,
  "addresses": {
    "cid": "QmYKYGfHZJfwrbuyd6V9ULaFS8vjvGYeAvjVa81phNmJ1U",
    "backends": ["ipfs", "local"]
  },
  "tier": "popular",
  "backends": ["ipfs", "local"],
  "encrypted": false
}
```

**Result:** SUCCESS - Upload works correctly with `/storage` prefix.

---

### Test 3: Pin endpoint at /api/v1/pin (without /storage prefix)

**Command:**
```bash
curl -s -X POST "http://127.0.0.1:4030/api/v1/pin" \
  -H "Content-Type: application/json" \
  -d '{"cid": "QmTest"}'
```

**Response:**
```json
{"error":"NOT_FOUND"}
```

**Result:** FAILED - Endpoint does not exist at this path.

---

### Test 4: Pin endpoint at /storage/api/v1/pin

**Command:**
```bash
curl -s -X POST "http://127.0.0.1:4030/storage/api/v1/pin" \
  -H "Content-Type: application/json" \
  -d '{"cid": "QmTest"}'
```

**Response:**
```json
{"error":"NOT_FOUND"}
```

**Result:** FAILED - This path also doesn't exist. The pin endpoint may not be implemented or uses a different path.

---

### Test 5: Deploy agent via crucible API (triggers storeCharacter)

**Command:**
```bash
curl -s -X POST "http://127.0.0.1:4021/api/v1/agents" \
  -H "Content-Type: application/json" \
  -d '{"name": "StorageTest", "bio": "Testing storage bug", "systemPrompt": "You are a test agent"}'
```

**Response:**
```json
{
  "error": "Internal server error",
  "message": "Failed to upload to IPFS: {\"error\":\"NOT_FOUND\"}"
}
```

**Result:** FAILED - Agent deployment fails because the storage SDK calls `/upload` which returns NOT_FOUND.

---

## Root Cause Analysis

The bug is in `apps/crucible/api/sdk/storage.ts`:

### Line 279 - Upload endpoint (BUG):
```typescript
const r = await fetch(`${this.config.apiUrl}/upload`, {
```

Should be:
```typescript
const r = await fetch(`${this.config.apiUrl}/storage/upload`, {
```

### Line 259 - Pin endpoint (BUG):
```typescript
const r = await fetch(`${this.config.apiUrl}/api/v1/pin`, {
```

The correct path for pin is unclear - `/storage/api/v1/pin` also returns NOT_FOUND. This endpoint may need further investigation or may not be implemented in the storage service.

## Configuration Reference

From `packages/config/services.json` (localnet):
```json
"storage": {
  "api": "http://127.0.0.1:4030",
  "ipfsGateway": "http://127.0.0.1:4030/cdn"
}
```

The `apiUrl` is set to `http://127.0.0.1:4030`, but the storage service routes are prefixed with `/storage/`.

## Conclusion

**Bug Confirmed:** The storage SDK uses incorrect endpoint paths.

| Endpoint | Current Path (Broken) | Correct Path |
|----------|----------------------|--------------|
| Upload | `/upload` | `/storage/upload` |
| Pin | `/api/v1/pin` | Unknown (needs investigation) |

## Recommended Fix

Option 1: Update the SDK to use `/storage` prefix:
```typescript
// In storage.ts upload()
const r = await fetch(`${this.config.apiUrl}/storage/upload`, {...})
```

Option 2: Update the config to include the path prefix:
```json
"storage": {
  "api": "http://127.0.0.1:4030/storage",
  "ipfsGateway": "http://127.0.0.1:4030/cdn"
}
```

Option 1 is preferred as it makes the code explicit about the storage service path structure.
