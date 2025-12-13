# Multi-Replica Deployment Guide

## Current Status

**⚠️ Single-Replica Only**

The facilitator currently uses an **in-memory nonce cache** that does not work across multiple replicas. This means:

- ✅ **Safe for single-replica deployments**
- ⚠️ **NOT safe for multi-replica deployments** - Could allow duplicate verifications

## The Problem

When multiple replicas are running:
1. Replica A verifies a payment with nonce `123` → marks it as used in local cache
2. Replica B verifies the same payment with nonce `123` → doesn't see it in its local cache
3. Both replicas return `isValid: true` → **Duplicate verification allowed**

The on-chain contract prevents duplicate settlements, but verification happens **before** settlement, so duplicate verifications can occur.

## Current Mitigation

- ✅ On-chain nonce check is always performed during settlement
- ✅ On-chain contract is authoritative - duplicate settlements will fail
- ⚠️ But duplicate verifications can still occur in multi-replica setups

## Solution: Shared Nonce Cache

To support multi-replica deployments, implement a shared nonce cache:

### Option 1: Redis (Recommended)

```typescript
// src/services/nonce-manager-redis.ts
import { Redis } from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export async function isNonceUsedShared(payer: Address, nonce: string): Promise<boolean> {
  const key = `nonce:${payer}:${nonce}`;
  const exists = await redis.exists(key);
  if (exists) return true;
  
  // Check on-chain
  const usedOnChain = await isNonceUsedOnChain(publicClient, payer, nonce);
  if (usedOnChain) {
    await redis.setex(key, 3600, '1'); // Cache for 1 hour
    return true;
  }
  
  // Mark as pending
  await redis.setex(key, 300, 'pending'); // 5 min TTL
  return false;
}
```

### Option 2: Database

Use PostgreSQL/MySQL with a `used_nonces` table:

```sql
CREATE TABLE used_nonces (
  payer_address VARCHAR(42) NOT NULL,
  nonce VARCHAR(64) NOT NULL,
  used_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (payer_address, nonce)
);
```

### Option 3: Distributed Lock

Use Redis/Database with distributed locks to prevent race conditions:

```typescript
async function checkAndMarkNonce(payer: Address, nonce: string): Promise<boolean> {
  const lock = await acquireLock(`nonce:${payer}:${nonce}`, 5000);
  try {
    // Check local, shared, and on-chain
    // Mark as used atomically
  } finally {
    await releaseLock(lock);
  }
}
```

## Implementation Steps

1. **Add Redis dependency** (if using Option 1)
   ```bash
   bun add ioredis
   bun add -d @types/ioredis
   ```

2. **Create shared nonce manager**
   - New file: `src/services/nonce-manager-shared.ts`
   - Implement Redis/database backend
   - Add configuration for Redis URL

3. **Update nonce-manager.ts**
   - Add feature flag: `USE_SHARED_NONCE_CACHE`
   - Use shared cache if enabled, fallback to local cache

4. **Update configuration**
   ```typescript
   // src/config/index.ts
   redisUrl: process.env.REDIS_URL || null,
   useSharedNonceCache: process.env.USE_SHARED_NONCE_CACHE === 'true',
   ```

5. **Add tests**
   - Test concurrent nonce checks across multiple instances
   - Test Redis connection failures
   - Test fallback to on-chain check

6. **Update deployment**
   - Add Redis to Helm chart
   - Update environment variables
   - Document Redis requirements

## Migration Path

1. **Phase 1:** Deploy with single replica (current state)
2. **Phase 2:** Implement shared cache, test with 2 replicas
3. **Phase 3:** Scale to multiple replicas with shared cache

## Monitoring

When using shared cache, monitor:
- Redis connection health
- Cache hit/miss rates
- Nonce check latency
- On-chain fallback frequency

## Current Recommendation

**For production:** Use single replica until shared cache is implemented.

**For development:** Current implementation is fine for testing.
