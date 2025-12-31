# Jeju Network Decentralization Plan

## Current State Analysis

### What We Have Built

The architecture is **fundamentally sound** - the design supports full decentralization. However, current deployment is heavily centralized on AWS Kubernetes.

```
DESIGNED FOR:                    CURRENTLY DEPLOYED AS:
─────────────────────────────    ─────────────────────────────
DWS Provider Network             AWS EKS + ALB
IPFS Cluster                     S3 + CloudFront
SQLit (decentralized DB)         PostgreSQL on RDS
JNS (naming service)             Route53 DNS
Threshold Cryptography           AWS KMS
P2P Node Discovery               Kubernetes Service Discovery
```

---

## Decentralization Matrix

### ✅ MUST Remain Centralized (Control Plane)

These components require physical infrastructure and cannot be fully decentralized:

| Component | Why Centralized | Decentralization Path |
|-----------|----------------|----------------------|
| **L1 Bridge Contracts** | Ethereum/Base mainnet | N/A - lives on L1 |
| **L2 Sequencer (bootstrap)** | Single sequencer at launch | Decentralize via sequencer rotation (3-6 months) |
| **Initial RPC Nodes** | Need reliable bootstrapping | Community can run additional nodes |
| **Block Producer (initial)** | Chain security at launch | Multi-sequencer + based rollup |
| **AWS Control Plane** | Terraform for K8s | K8s control plane only, NOT app execution |

### ✅ CAN Be Decentralized (Data Plane)

Everything else should run on the DWS provider network:

| Component | Current | Target | Status |
|-----------|---------|--------|--------|
| **App Frontends** | S3 + CloudFront | IPFS + Arweave | 🟡 Partial (oauth3 routing works) |
| **App Backends** | EKS Pods | DWS Workers (V8/Bun) | 🔴 Not deployed |
| **Database** | RDS PostgreSQL | SQLit (decentralized) | 🔴 Not deployed |
| **Storage** | S3 | IPFS + Arweave + Filecoin | 🟡 IPFS upload works |
| **CDN** | CloudFront | DWS Edge Nodes | 🔴 Not deployed |
| **DNS** | Route53 | JNS Gateway | 🟡 Contracts exist |
| **KMS** | AWS KMS | MPC/Threshold | 🔴 Not deployed |
| **Secrets** | AWS Secrets Manager | Sealed Secrets + MPC | 🔴 Not deployed |
| **Monitoring** | CloudWatch | Self-hosted Prometheus | 🟡 Partial |
| **CI/CD** | GitHub Actions | DWS CI Workers | 🔴 Not deployed |

### 🔴 LARP / Gaps Identified

Things that claim to be decentralized but aren't:

1. **DWS on AWS K8s** - DWS is deployed to AWS EKS, defeating the purpose
2. **Apps on K8s directly** - OAuth3, Autocrat have standalone K8s deployments
3. **SQLit not running** - Falls back to in-memory, no persistence
4. **IPFS pinning disabled** - Using S3 backend instead of actual IPFS
5. **JNS not resolving** - DNS still Route53, JNS only for on-chain lookups
6. **No TEE attestation** - `teeRequired: true` but no actual TEE verification
7. **P2P disabled in prod** - `DWS_P2P_ENABLED=false` in testnet values
8. **Provider registry empty** - No nodes registered on-chain

---

## Action Plan

### Phase 1: Foundation (Week 1-2)

#### 1.1 Deploy SQLit Block Producer
```bash
# Deploy SQLit as a true decentralized database
bun run scripts/deploy/deploy-sqlit.ts --network testnet

# Components:
# - Block producer node (consensus)
# - Miner nodes (storage/compute)
# - Client library integration
```

**Files to update:**
- `packages/deployment/kubernetes/helm/sqlit/values-testnet.yaml` - Enable deployment
- `apps/dws/api/database/sqlit-service.ts` - Fix connection to deployed SQLit

#### 1.2 Enable P2P Node Discovery
```bash
# Update DWS deployment to enable P2P
kubectl patch deployment dws -n dws --patch '{"spec":{"template":{"spec":{"containers":[{"name":"dws","env":[{"name":"DWS_P2P_ENABLED","value":"true"}]}]}}}}'
```

**Files to update:**
- `packages/deployment/kubernetes/helm/dws/values-testnet.yaml`:
  ```yaml
  env:
    - name: DWS_P2P_ENABLED
      value: "true"
    - name: DWS_PROVIDER_ENABLED
      value: "true"
  ```

#### 1.3 Register DWS as On-Chain Provider
```typescript
// Register the testnet DWS node as a provider
await dwsProviderRegistry.registerProvider({
  endpoint: 'https://dws.testnet.jejunetwork.org',
  capabilities: ['compute', 'storage', 'cdn'],
  stake: parseEther('100'), // Testnet stake
  specs: {
    cpuCores: 4,
    memoryMb: 8192,
    storageMb: 500000,
    bandwidthMbps: 1000
  }
})
```

**New script needed:**
- `packages/deployment/scripts/deploy/register-dws-provider.ts`

### Phase 2: App Migration (Week 2-3)

#### 2.1 Deploy OAuth3 Frontend to IPFS
```bash
# Build and upload to IPFS
cd apps/oauth3
bun run build
bun run scripts/deploy/deploy-frontend.ts --app oauth3 --network testnet
```

#### 2.2 Deploy OAuth3 Backend as DWS Worker
```bash
# Deploy backend as workerd isolate
bun run scripts/deploy/deploy-app-to-dws-full.ts oauth3 testnet
```

#### 2.3 Migrate All Apps

Deploy each app through DWS:

| App | Frontend | Backend | Priority |
|-----|----------|---------|----------|
| oauth3 | IPFS | DWS Worker | P0 |
| autocrat | IPFS | DWS Worker | P1 |
| bazaar | IPFS | DWS Worker | P1 |
| crucible | IPFS | DWS Worker | P1 |
| factory | IPFS | DWS Worker | P2 |
| gateway | IPFS | DWS Worker | P2 |
| monitoring | IPFS | DWS Worker | P2 |
| documentation | IPFS | Static | P3 |

### Phase 3: JNS Integration (Week 3-4)

#### 3.1 Deploy JNS Gateway
```bash
# Deploy JNS DNS resolver that bridges .jeju to traditional DNS
bun run packages/deployment/scripts/deploy/deploy-jns-gateway.ts testnet
```

#### 3.2 Update DNS to Forward .jeju Queries
Configure Route53 to forward `*.jeju` queries to JNS gateway:
```
*.jeju.testnet.jejunetwork.org → JNS Gateway → On-chain resolution
```

#### 3.3 Register All Apps with JNS
```typescript
// Register each app's JNS name
for (const app of ['oauth3', 'autocrat', 'bazaar', 'crucible']) {
  await jnsRegistry.register(
    `${app}.jeju`,
    await getIPFSCid(app),
    { ttl: 300 }
  )
}
```

### Phase 4: Provider Network (Week 4-6)

#### 4.1 Enable Community Providers
```bash
# Create provider onboarding documentation and tooling
bun run scripts/deploy/create-provider-package.ts
```

Output: `jeju-provider-node` package that anyone can run:
```bash
# Anyone can become a provider
npx jeju-provider-node --stake 1000 --services compute,storage,cdn
```

#### 4.2 Implement Provider Selection
Update DWS to select providers from on-chain registry:
```typescript
// apps/dws/api/infrastructure/provider-selection.ts
async function selectProviders(requirements: Requirements): Promise<Provider[]> {
  const registry = getDWSProviderRegistry()
  const providers = await registry.getActiveProviders()
  
  return providers
    .filter(p => meetsRequirements(p, requirements))
    .sort(byReputationAndPrice)
    .slice(0, requirements.redundancy || 3)
}
```

#### 4.3 Implement Failover
```typescript
// Automatic failover between providers
async function executeWithFailover(request: Request, providers: Provider[]): Promise<Response> {
  for (const provider of providers) {
    try {
      return await provider.execute(request)
    } catch (error) {
      await reportProviderFailure(provider, error)
    }
  }
  throw new Error('All providers failed')
}
```

### Phase 5: TEE Integration (Week 6-8)

#### 5.1 Deploy Phala/dstack TEE Workers
```bash
# Deploy TEE-enabled workers for sensitive operations
bun run scripts/deploy/deploy-tee-workers.ts --platform dstack
```

#### 5.2 Enable TEE Attestation
```typescript
// Verify TEE attestation for sensitive workloads
async function verifyTEEAttestation(workerId: string): Promise<boolean> {
  const attestation = await getTEEAttestation(workerId)
  return await verifyAttestation(attestation, {
    expectedMeasurement: EXPECTED_CODE_HASH,
    minSecurityLevel: 'hardware'
  })
}
```

#### 5.3 Mark Sensitive Apps as TEE-Required
Apps handling secrets (OAuth3, KMS operations) must run in TEE:
```json
{
  "decentralization": {
    "worker": {
      "teeRequired": true,
      "teeAttestation": "required"
    }
  }
}
```

### Phase 6: Full Decentralization (Week 8-12)

#### 6.1 Deprecate AWS K8s Apps
```bash
# Scale down all standalone K8s app deployments
for app in oauth3 autocrat bazaar crucible factory; do
  kubectl scale deployment $app -n $app --replicas=0
done
```

#### 6.2 Update ALB Rules to Route Through DWS
All traffic routes through DWS provider network:
```
appname.testnet.jejunetwork.org → ALB → DWS → Provider Network → Response
```

#### 6.3 Enable Multi-Region Providers
Ensure at least 3 geographic regions have providers:
- North America
- Europe  
- Asia Pacific

---

## Immediate Actions (This Week)

### 1. Fix SQLit Integration
```bash
# File: apps/dws/api/database/sqlit-service.ts
# Issue: Trying to provision SQLit via Docker, which doesn't work in K8s
# Fix: Connect to deployed SQLit service or use ConfigMap persistence
```

### 2. Enable P2P in Testnet
```yaml
# File: packages/deployment/kubernetes/helm/dws/values-testnet.yaml
env:
  - name: DWS_P2P_ENABLED
    value: "true"  # Currently "false"
```

### 3. Register Provider On-Chain
```bash
# New script: packages/deployment/scripts/deploy/register-dws-provider.ts
bun run packages/deployment/scripts/deploy/register-dws-provider.ts --network testnet
```

### 4. Deploy All App Frontends to IPFS
```bash
for app in oauth3 autocrat bazaar crucible factory; do
  bun run packages/deployment/scripts/deploy/deploy-frontend.ts --app $app --network testnet
done
```

### 5. Update App Router with IPFS CIDs
```bash
# After frontend deploys, register with DWS app router
bun run packages/deployment/scripts/deploy/register-apps-with-dws.ts --network testnet
```

---

## Architecture After Full Decentralization

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           CONTROL PLANE (AWS)                                │
│                     (Minimal - Only Chain Infrastructure)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐       │
│  │ op-geth     │  │ op-node     │  │ op-batcher  │  │ op-proposer │       │
│  │ (L2 Exec)   │  │ (L2 Cons)   │  │ (Batching)  │  │ (Proposing) │       │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘       │
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐                                          │
│  │ Indexer     │  │ Bridge      │  ← These can also move to DWS            │
│  │ (Events)    │  │ (L1↔L2)     │    once provider network is robust       │
│  └─────────────┘  └─────────────┘                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ RPC
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DATA PLANE (DWS Provider Network)                     │
│                    (Decentralized - Anyone Can Participate)                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PROVIDERS (Run by Community + Jeju)                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  Provider A          Provider B          Provider C          ...      │ │
│  │  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐              │ │
│  │  │ DWS Node    │    │ DWS Node    │    │ DWS Node    │              │ │
│  │  │ - Compute   │    │ - Compute   │    │ - Compute   │              │ │
│  │  │ - Storage   │    │ - Storage   │    │ - Storage   │              │ │
│  │  │ - CDN       │    │ - CDN       │    │ - CDN       │              │ │
│  │  │ - SQLit     │    │ - SQLit     │    │ - SQLit     │              │ │
│  │  │ - IPFS      │    │ - IPFS      │    │ - IPFS      │              │ │
│  │  └─────────────┘    └─────────────┘    └─────────────┘              │ │
│  │        │                  │                  │                       │ │
│  │        └──────────────────┴──────────────────┘                       │ │
│  │                           │                                          │ │
│  │                     P2P Coordination                                 │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│  APPS (Deployed to Provider Network)                                        │
│  ┌───────────────────────────────────────────────────────────────────────┐ │
│  │                                                                       │ │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐              │ │
│  │  │ oauth3   │  │ autocrat │  │ bazaar   │  │ crucible │  ...        │ │
│  │  │          │  │          │  │          │  │          │              │ │
│  │  │ Frontend:│  │ Frontend:│  │ Frontend:│  │ Frontend:│              │ │
│  │  │  IPFS    │  │  IPFS    │  │  IPFS    │  │  IPFS    │              │ │
│  │  │          │  │          │  │          │  │          │              │ │
│  │  │ Backend: │  │ Backend: │  │ Backend: │  │ Backend: │              │ │
│  │  │  Worker  │  │  Worker  │  │  Worker  │  │  Worker  │              │ │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘              │ │
│  │                                                                       │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Apps on K8s directly | 10+ | 0 |
| Apps on DWS | 1 (partial) | All |
| Active Providers | 1 (Jeju) | 10+ |
| Geographic Regions | 1 | 3+ |
| IPFS-hosted Frontends | 0 | All |
| SQLit Persistence | ❌ | ✅ |
| P2P Discovery | ❌ | ✅ |
| JNS Resolution | ❌ | ✅ |
| TEE Attestation | ❌ | ✅ (for sensitive) |

---

## Files to Create/Modify

### New Scripts
- `packages/deployment/scripts/deploy/register-dws-provider.ts`
- `packages/deployment/scripts/deploy/deploy-all-apps-to-dws.ts`
- `packages/deployment/scripts/deploy/deploy-sqlit.ts`
- `packages/deployment/scripts/deploy/migrate-app-from-k8s.ts`

### Modified Files
- `packages/deployment/kubernetes/helm/dws/values-testnet.yaml` - Enable P2P, provider mode
- `apps/dws/api/database/sqlit-service.ts` - Fix SQLit connection
- `apps/dws/api/server/routes/app-router.ts` - Add IPFS CID support from ConfigMap
- All app `jeju-manifest.json` files - Ensure decentralization config is complete

---

## Timeline

| Week | Milestone |
|------|-----------|
| 1 | SQLit deployed, P2P enabled, provider registered |
| 2 | OAuth3 fully migrated to DWS |
| 3 | All P0/P1 apps migrated |
| 4 | JNS Gateway live |
| 6 | Community providers onboarded |
| 8 | TEE attestation for sensitive apps |
| 12 | Full decentralization (K8s apps deprecated) |
