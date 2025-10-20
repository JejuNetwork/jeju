# 🔥 Jeju Crucible

**Multi-agent security testing platform where Jeju's resilience is forged through adversarial simulation.**

## ⚠️ WARNING

This platform runs **REAL ATTACKS** on the Jeju Network:
- Executes reentrancy exploits on smart contracts
- Attempts social engineering scams on users
- Tests governance and moderation systems
- Probes for vulnerabilities across all infrastructure

**All stolen funds are automatically recovered to guardian addresses.**

## 🎯 What It Does

Crucible deploys autonomous AI agents that simulate the full spectrum of network participants:

### 🏴‍☠️ Adversaries (4 agents)
- **2 Hackers**: Find smart contract vulnerabilities through automated exploits
- **2 Scammers**: Test social engineering defenses and scam detection

### 🛡️ Defenders (3 agents)
- **3 Citizens**: Monitor network, detect bad actors, submit reports with evidence

### ⚖️ Governors (3 agents)
- **3 Guardians**: Vote on appeals, approve bans, participate in futarchy governance

**Total**: 10 autonomous agents testing security from every angle

---

## 🏗️ Architecture

```
┌────────────────────────────────────────────────┐
│  Docker/Podman Container (jeju/crucible)       │
│                                                │
│  ┌──────────────────────────────────────────┐ │
│  │  ElizaOS Server (Port 7777)              │ │
│  │                                          │ │
│  │  • Multi-agent management                │ │
│  │  • Messaging infrastructure              │ │
│  │  • Shared Postgres database              │ │
│  │  • REST API + WebSocket                  │ │
│  └──────────────────────────────────────────┘ │
│         │                                     │
│         ├──────┬─────────┬──────────┬────────┤
│         ▼      ▼         ▼          ▼        ▼
│    [Hacker][Scammer][Citizen][Guardian][Player]
│                                                │
└────────────────────────────────────────────────┘
         │ Network access via host.docker.internal
         ↓
┌────────────────────────────────────────────────┐
│  Jeju Localnet (Host Machine)                 │
│  • L2 RPC: http://127.0.0.1:9545               │
│  • Smart Contracts, Games, Services           │
│  • ERC-8004 Registry, Reputation, Governance  │
└────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

### Prerequisites

- **Jeju Localnet**: Must be running (`bun run dev` from repo root)
- **Container Runtime** (optional): Docker/Podman for containerized deployment
- **API Key**: OpenAI or Anthropic API key for agent intelligence

### One-Command Setup

```bash
# From jeju repo root, start localnet
bun run dev

# In another terminal:
cd apps/crucible
bun run deploy
```

This automatically:
- ✅ Verifies localnet is running
- ✅ Loads contract addresses  
- ✅ Creates .env file
- ✅ Funds all 10 agent wallets
- ✅ Sets up data directories

### Then add your API key

Edit `.env`:
```bash
OPENAI_API_KEY=sk-...
```

### Start Crucible

**Local Development** (recommended):
```bash
bun run dev
```

**Docker** (for containerized deployment):
```bash
docker-compose -f docker/docker-compose.yml up -d
```

### Verify Running

```bash
# Check health
curl http://localhost:7777/api/health

# List agents
curl http://localhost:7777/api/agents

# Open dashboard
open http://localhost:7777/dashboard
```

See [SETUP.md](SETUP.md) for detailed setup instructions and troubleshooting.

---

## 🎭 Agent Types

### 1. Infrastructure Hackers 🏴‍☠️

**Purpose**: Find smart contract vulnerabilities

**Capabilities**:
- Reentrancy attacks (RegistryGovernance, CreditPurchaseContract)
- Front-running & MEV (Predimarket)
- Integer overflow (LMSR math)
- Flash loan exploits (LiquidityVault)
- Access control bypasses
- DOS attacks

**Stake**: SMALL (0.001 ETH)  
**Funding**: 2 ETH gas + 200 elizaOS  
**Success Metric**: # vulnerabilities found

### 2. Social Scammers 🎭

**Purpose**: Test scam detection systems

**Capabilities**:
- Fake service registration (ERC-8004)
- Phishing messages
- Fake NFT listings (Bazaar)
- Pump-and-dump schemes
- Impersonation attacks

**Stake**: NONE (scammers avoid stakes)  
**Funding**: 1 ETH gas + 100 elizaOS  
**Success Metric**: Detection time (target < 5 min)

### 3. Good Citizens 🛡️

**Purpose**: Protect network by monitoring and reporting

**Capabilities**:
- Monitor contracts for exploits
- Patrol marketplace for scams
- Collect evidence (tx hashes, screenshots)
- Submit reports to UnifiedReportingSystem
- Upload evidence to IPFS
- Vote in futarchy markets

**Stake**: MEDIUM (0.01 ETH)  
**Funding**: 1 ETH gas + 200 elizaOS  
**Success Metric**: Report accuracy > 90%

### 4. Security Guardians ⚖️

**Purpose**: Govern network and review appeals

**Capabilities**:
- Vote on appeals (2/3 threshold)
- Approve proposals (multi-sig)
- Trade in markets with 3x weight
- Investigate security incidents
- Earn 20% of slashed stakes

**Stake**: HIGH (0.1 ETH) - REQUIRED  
**Funding**: 3 ETH gas + 500 elizaOS  
**Success Metric**: Accuracy > 90%

---

## 🔄 Full Security Testing Flow

### Example: Hacker → Citizen → Guardian

```
TIME 0:00 - ATTACK
  Hacker "ShadowProbe":
    ├─ Deploys MaliciousProposer contract
    ├─ Creates governance proposal (0.01 ETH bond)
    ├─ Triggers finalizeProposal()
    ├─ Reentrancy attack drains 2.5 ETH
    └─ [Guardian Recovery: 2.5 ETH → Guardian address]

TIME 0:02 - DETECTION
  Citizen "Vigilant":
    ├─ Detects unusual transactions
    ├─ Analyzes attack pattern
    ├─ Collects evidence (tx hashes, contract address)
    ├─ Uploads to IPFS: QmX7b9...
    └─ Submits report:
        └─ Type: LABEL_HACKER
        └─ Severity: CRITICAL
        └─ Bond: 0.1 ETH

TIME 0:03 - MARKET CREATION
  UnifiedReportingSystem:
    ├─ Creates futarchy market
    └─ Question: "Should agent #X be labeled HACKER?"

TIME 0:03-24:00 - VOTING
  Citizens + Guardians:
    ├─ Review evidence
    ├─ Trade YES shares (support ban)
    └─ Guardians trade with 3x weight

TIME 24:00 - RESOLUTION
  Market resolves YES (overwhelming consensus)
    ↓
  RegistryGovernance executes:
    ├─ HACKER label applied
    ├─ Network ban triggered
    ├─ Hacker's stake slashed
    └─ Citizen rewarded (0.11 ETH)

TIME 24:01 - DOCUMENTATION
  Database logs:
    └─ Vulnerability: RegistryGovernance line 380
    └─ Type: Reentrancy
    └─ Severity: CRITICAL
    └─ Fix: Apply CEI pattern
    └─ Proof: TX 0xabc...
```

---

## 🔌 Deep Integration

### ERC-8004 Identity Registry

All agents register with appropriate stake tiers:
```typescript
- Hackers: SMALL (0.001 ETH)
- Scammers: NONE (avoid stakes)
- Citizens: MEDIUM (0.01 ETH)
- Guardians: HIGH (0.1 ETH) - REQUIRED
```

Metadata includes:
- Agent type (hacker/scammer/citizen/guardian)
- Capabilities list
- Category tags
- Discovery info

### Reputation Registry

Citizens give feedback via `ReputationRegistry.giveFeedback()`:
- Positive scores (80-100) for trusted agents
- Negative scores (0-20) for suspicious agents
- Tags for categorization
- Builds reputation over time

### UnifiedReportingSystem

Citizens submit reports with:
- Report type (NETWORK_BAN, APP_BAN, LABEL_HACKER, LABEL_SCAMMER)
- Severity (LOW/MEDIUM/HIGH/CRITICAL)
- Evidence IPFS hash
- Required bond (0.001 - 0.1 ETH)

Creates futarchy market for community voting.

### Futarchy Governance

All agents vote by trading in Predimarket:
- Regular agents: 1x weight
- Guardians: 3x weight
- Market prices reflect consensus
- Execute if YES > NO + threshold

### Appeals Process

Banned agents can appeal:
- Submit via `RegistryGovernance.submitAppeal()`
- Requires 0.05 ETH bond
- Guardians review evidence
- 2/3 guardian vote needed to approve
- If approved: Ban removed, bond refunded

---

## 🔧 Configuration

### Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Network (NEVER use mainnet)
NETWORK=localnet

# Guardian Recovery
GUARDIAN_ADDRESS_LOCALNET=0x71562b71999873DB5b286dF957af199Ec94617F7

# AI Provider
OPENAI_API_KEY=sk-...

# Contract Addresses (auto-loaded from deployment)
IDENTITY_REGISTRY=0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0
REPUTATION_REGISTRY=0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9
# ... etc
```

---

## 🐳 Container Commands

### Docker

```bash
# Build
docker-compose -f docker/docker-compose.yml build

# Start
docker-compose -f docker/docker-compose.yml up -d

# Logs
docker-compose -f docker/docker-compose.yml logs -f crucible

# Stop
docker-compose -f docker/docker-compose.yml down
```

### Podman

```bash
# Same commands work with podman-compose
podman-compose -f docker/docker-compose.yml up -d
podman-compose -f docker/docker-compose.yml logs -f crucible
podman-compose -f docker/docker-compose.yml down
```

---

## 📊 Monitoring

### Built-in ElizaOS API

```bash
# List all agents
curl http://localhost:7777/api/agents

# Get agent details
curl http://localhost:7777/api/agents/{agentId}

# Server health
curl http://localhost:7777/api/server/health

# Server status
curl http://localhost:7777/api/server/status
```

### Crucible-Specific Endpoints

```bash
# Vulnerabilities found
curl http://localhost:7777/api/crucible/vulnerabilities

# Statistics
curl http://localhost:7777/api/crucible/stats

# Dashboard (if enabled)
open http://localhost:5010/dashboard
```

---

## 🛡️ Safety Mechanisms

### 1. Network Restriction

Hardcoded checks prevent mainnet deployment:
```typescript
if (process.env.NETWORK === 'mainnet') {
  throw new Error('Crucible cannot run on mainnet');
}
```

### 2. Guardian Recovery

All agents have automatic fund recovery:
- Monitors wallet every 10 seconds
- Auto-transfers if balance > 0.1 ETH
- Keeps 0.01 ETH for gas
- Logs all movements

### 3. Comprehensive Logging

All actions logged to:
- Console output
- Postgres database
- ElizaOS memory system

### 4. Resource Limits

Docker compose includes:
- CPU limits (4 cores max)
- Memory limits (8GB max)
- Restart policies

---

## 📈 Success Metrics

### By Week 6

**Vulnerabilities**:
- Find 4+ known critical bugs ✅
- Discover 10+ unknown bugs
- Test all 11 main contracts
- Document with proof-of-concept

**Moderation**:
- Scammers detected < 5 minutes
- Citizens submit 50+ reports
- Report accuracy > 90%
- Guardians vote on 20+ appeals

**Recovery**:
- 100% fund recovery rate
- All movements logged
- No funds lost

---

## 🔧 Development

### Local Development (without Docker)

```bash
# Install dependencies
bun install

# Start Postgres separately
docker run -d --name crucible-db \
  -e POSTGRES_DB=crucible \
  -e POSTGRES_USER=crucible \
  -e POSTGRES_PASSWORD=crucible_pass \
  -p 5432:5432 \
  postgres:15-alpine

# Run locally
bun run dev
```

### Building Plugin Package

```bash
cd packages/plugin-crucible
bun install
bun run build
```

### Testing

```bash
# Run test scenarios
bun test

# Specific scenario
bun test tests/scenarios/full-ecosystem.test.ts
```

---

## 📚 Documentation

- **[FINAL_ARCHITECTURE.md](FINAL_ARCHITECTURE.md)** - Technical architecture details
- **[MULTI_AGENT_ARCHITECTURE.md](MULTI_AGENT_ARCHITECTURE.md)** - Agent interaction patterns
- **[EXECUTIVE_SUMMARY.md](EXECUTIVE_SUMMARY.md)** - Research findings and decisions
- **[PROJECT_NAMES_ANALYSIS.md](PROJECT_NAMES_ANALYSIS.md)** - Why "Crucible"?

---

## 🤝 Contributing

### Adding New Attack Patterns

```typescript
// packages/plugin-crucible/src/adversary/my-attack.ts
export const myAttackAction: Action = {
  name: 'MY_ATTACK',
  description: 'Your attack description',
  validate: async (runtime) => {
    return runtime.getSetting('AGENT_TYPE') === 'hacker';
  },
  handler: async (runtime, message) => {
    // Attack logic
    return {success: true, severity: 'CRITICAL'};
  }
};
```

Then add to `packages/plugin-crucible/src/index.ts`.

### Adding New Agent Types

1. Create character JSON in `characters/`
2. Add wallet environment variable
3. Update `src/index.ts` seed function
4. Create type-specific plugins if needed

---

## 🎓 Learn More

### Jeju Network
- [Contracts](../documentation/contracts.md)
- [ERC-8004 Registry](../documentation/registry.md)
- [Moderation System](../../docs/MODERATION_USER_GUIDE.md)

### Security
- [Known Vulnerabilities](../../URGENT_SECURITY_FIXES.md)
- [Critical Bug Audit](../../CRITICAL_BUG_AUDIT.md)

### ElizaOS
- [ElizaOS Documentation](https://elizaos.how)
- [Multi-Agent Guide](.cursor/rules/elizaos/)

---

## 📄 License

MIT - See [LICENSE](../../LICENSE)

---

## 🎯 Project Goals

**Before Mainnet**:
- ✅ Find all critical vulnerabilities
- ✅ Test moderation system end-to-end
- ✅ Validate governance mechanisms
- ✅ Confirm 100% fund recovery
- ✅ Document all findings

**Result**: A battle-tested, hardened network ready for real users.

---

**Built with ElizaOS** - Autonomous agent framework  
**For Jeju Network** - Where security is forged 🔥
