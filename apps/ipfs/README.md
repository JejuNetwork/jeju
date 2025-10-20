# Jeju IPFS Storage Service

**Purpose**: Decentralized file storage with built-in IPFS nodes, x402 micropayments, and A2A integration

**Status**: ✅ Production-ready - Complete implementation replacing external services (Pinata, Infura)

**Quick Links:**
- [Quick Start Guide](./QUICKSTART.md) - 5-minute setup
- [Integration Guide](./INTEGRATION.md) - Ecosystem integration
- [Architecture](./ARCHITECTURE.md) - System design
- [Status Report](./STATUS.md) - Current implementation status

---

## 🎯 Architecture

```
┌─────────────────────────────────────────────────┐
│          Jeju IPFS Storage Service              │
│  "We ARE the Pinata, not using Pinata"         │
└─────────────────────────────────────────────────┘
           │
     ┌─────┼─────────────┐
     │     │             │
┌────▼─────▼────┐  ┌────▼──────────┐
│ Kubo IPFS Node │  │ x402 Gateway  │
│ (Local)        │  │ (Micropayments)│
└────┬───────────┘  └────┬──────────┘
     │                   │
┌────▼───────────────────▼──────────┐
│  Pinning Service API               │
│  (IPFS Standard)                   │
└────┬───────────────────────────────┘
     │
┌────▼───────────────────────────────┐
│  FileStorageManager.sol            │
│  (On-Chain Tracking + Payments)    │
└────────────────────────────────────┘
```

---

## 🏗️ Components

### 1. Kubo IPFS Node
- Local IPFS daemon
- Content-addressable storage
- DHT participation
- Gateway for HTTP access

### 2. Pinning Service API
- Standard IPFS Pinning Service spec
- Compatible with ipfs-http-client
- No Pinata dependency
- Our own pinning logic

### 3. x402 Payment Gateway
- Coinbase x402 protocol
- USDC payments on Base
- Per-GB pricing
- Automatic payment verification

### 4. ERC-4337 Paymasters
- Multi-token support
- Gas sponsorship
- Token-specific budgets
- Fallback to USDC

### 5. A2A Agent Integration
- Registered in ERC-8004 registry
- Agents can discover service
- Task-based file storage
- Artifact CID returns

---

## 📦 Installation & Setup

### 1. Install Kubo IPFS

```bash
# macOS (arm64)
curl -O https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_darwin-amd64.tar.gz
tar -xvzf kubo_v0.24.0_darwin-amd64.tar.gz
cd kubo
sudo bash install.sh

# Initialize IPFS (first time only)
ipfs init

# Copy Jeju config
cp apps/ipfs/node/ipfs-config.json ~/.ipfs/config

# Start daemon
ipfs daemon
```

### 2. Install Dependencies

```bash
cd apps/ipfs/pinning-api
bun install
```

### 3. Start Pinning API

```bash
# From apps/ipfs/
bun run dev

# Or from repo root (if integrated into main dev script)
bun run dev
```

---

## 🚀 Components

Located in `apps/ipfs/`:
- `node/` - Kubo IPFS daemon configuration
- `pinning-api/` - Hono-based API server with IPFS Pinning Service spec, x402 payments, and A2A agent
- `contracts/` - FileStorageManager.sol for on-chain tracking
- Frontend: Integrated into Gateway Portal (`apps/gateway/src/app/storage/page.tsx`)

---

## 💰 Pricing Model

**Storage**: $0.10 per GB per month  
**Retrieval**: Free (public gateway)  
**Private retrieval**: $0.0001 per request (x402)

**Payment Options**:
- USDC (Base)
- elizaOS token
- Any token with configured paymaster
- ETH (fallback)

---

## 🔗 Integration

Moderation system and all Jeju apps use local IPFS:

```typescript
// OLD: External Pinata
const hash = await uploadToPinata(file);

// NEW: Local IPFS
const hash = await uploadToJejuIPFS(file);
// Uses our own nodes, our own pinning, our own payment
```

**Status**: Complete replacement of external dependencies

**Quick Start:** See [QUICKSTART.md](./QUICKSTART.md) for 5-minute setup guide

---

## 🔌 Endpoints

### IPFS Pinning API (Standard Spec)
- `POST /pins` - Pin a CID
- `GET /pins` - List pins (with filters)
- `GET /pins/{id}` - Get pin status
- `DELETE /pins/{id}` - Unpin CID

### File Operations
- `POST /upload` - Upload file with x402 payment
- `GET /ipfs/{cid}` - Retrieve file

### A2A Agent
- `GET /.well-known/agent-card.json` - Service discovery
- `POST /a2a` - JSON-RPC agent communication

### Health & Stats
- `GET /health` - Service health and IPFS connectivity

**Port Allocation (Jeju 4xxx Range):**
```
3100  - IPFS Pinning API (HTTP) + A2A agent
4100  - Kubo IPFS Node API
8080  - Kubo IPFS Gateway (public access)
4101  - Kubo IPFS Swarm (P2P networking)
```

---

## 🤖 A2A Agent Integration

IPFS Storage is discoverable by AI agents via the A2A protocol:

```typescript
// Agent discovers service
const agentCard = await fetch('http://localhost:3100/.well-known/agent-card.json');

// Agent calculates storage cost
const response = await fetch('http://localhost:3100/a2a', {
  method: 'POST',
  body: JSON.stringify({
    jsonrpc: '2.0',
    method: 'message/send',
    params: {
      message: {
        messageId: 'cost-001',
        parts: [
          { kind: 'data', data: { skillId: 'calculate-cost', sizeBytes: 1048576, durationMonths: 3 } }
        ]
      }
    },
    id: 1
  })
});
```

**Available Skills:**
- `upload-file` - Upload and pin files
- `pin-existing-cid` - Pin existing IPFS content
- `retrieve-file` - Fetch files by CID
- `list-pins` - Query pinned files
- `calculate-cost` - Estimate storage costs
- `get-storage-stats` - Network statistics

---

## 🌐 Frontend Integration

File upload and management UI is integrated into the Gateway Portal at `/storage`:

```
http://localhost:4001/storage
```

Features:
- Drag & drop file upload
- Storage duration selection (1, 6, 12 months)
- Cost calculator
- My files list with renewal
- Multi-token payment (USDC, elizaOS, ETH)

---

## 🔒 Smart Contract Integration

`FileStorageManager.sol` provides on-chain tracking:

```solidity
// Pin file with payment
function pinFile(
    bytes32 cid,
    uint256 sizeBytes,
    uint256 durationMonths,
    address paymentToken
) external payable;

// Renew file pinning
function renewFile(bytes32 cid, uint256 additionalMonths, address paymentToken) external payable;

// Unpin file (owner only)
function unpinFile(bytes32 cid) external;
```

---

