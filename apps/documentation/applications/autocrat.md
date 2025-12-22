# Autocrat

AI-powered DAO governance with council deliberation and automated proposal execution.

## Overview

Autocrat provides decentralized governance with AI assistance:

- **AI Council** - Multiple AI agents deliberate on proposals
- **CEO Agent** - TEE-backed decision making with hardware attestation
- **Proposal Quality Scoring** - AI-powered proposal assessment
- **Research Agents** - Deep analysis using compute marketplace
- **On-Chain Execution** - Automated timelock execution

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Council API (port 8010)                  │
├─────────────────┬─────────────────┬─────────────────────────┤
│ ProposalAssist  │  ResearchAgent  │     CouncilAgents       │
│ - Quality Score │  - Deep Analysis│     - Treasury          │
│ - Attestation   │  - Compute Mkt  │     - Code              │
│                 │  - Ollama       │     - Community         │
│                 │                 │     - Security          │
├─────────────────┴─────────────────┴─────────────────────────┤
│                    TEE Service (CEO Decisions)               │
│                - Hardware TEE (Phala Cloud)                  │
│                - Simulated TEE (local dev)                   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Smart Contracts                           │
│  Council.sol  │  CEOAgent.sol  │  QualityOracle.sol         │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
cd apps/autocrat
./scripts/start-council-dev.sh        # Anvil + Contracts + API
./scripts/start-council-dev.sh --ui   # With frontend
```

## Council Agents

| Agent | Role |
|-------|------|
| Treasury | Financial analysis, budget assessment |
| Code | Technical review, security analysis |
| Community | Social impact, stakeholder considerations |
| Security | Risk assessment, attack vector analysis |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health check |
| `/api/v1/proposals/assess` | POST | Assess proposal quality |
| `/api/v1/governance/stats` | GET | Get governance statistics |
| `/api/v1/ceo` | GET | Get CEO status |
| `/mcp/tools/list` | POST | List MCP tools |
| `/a2a` | POST | Agent-to-agent messaging |

## Proposal Flow

1. **Submit** - User submits proposal on-chain
2. **Assess** - Quality oracle scores the proposal
3. **Research** - Research agents perform deep analysis
4. **Deliberate** - Council agents discuss and vote
5. **Decide** - CEO agent makes final determination in TEE
6. **Execute** - Timelock executes approved actions

## SDK Integration

```typescript
import { createJejuClient } from '@jejunetwork/sdk';

const jeju = await createJejuClient({ network: 'mainnet', privateKey });

// Create proposal
const proposalId = await jeju.governance.createProposal({
  title: 'Increase staking rewards',
  description: 'Proposal to increase staking APY from 5% to 7%',
  actions: [{
    target: STAKING_CONTRACT,
    value: 0n,
    calldata: encodeFunctionData({
      abi: StakingAbi,
      functionName: 'setRewardRate',
      args: [700], // 7%
    }),
  }],
});

// Vote
await jeju.governance.vote({
  proposalId,
  support: true,
  reason: 'Increases validator incentives',
});

// Get proposal status
const proposal = await jeju.governance.getProposal(proposalId);
```

## TEE Configuration

For production with hardware attestation:

```bash
export TEE_API_KEY=your-phala-api-key
export TEE_CLOUD_URL=https://cloud.phala.network/api/v1
export REQUIRE_HARDWARE_TEE=true
```

Without TEE_API_KEY, uses simulated TEE with local encryption.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `RPC_URL` | Yes | Blockchain RPC endpoint |
| `COUNCIL_ADDRESS` | Yes | Deployed Council contract |
| `CEO_AGENT_ADDRESS` | Yes | Deployed CEOAgent contract |
| `OLLAMA_URL` | No | Ollama API endpoint |
| `TEE_API_KEY` | No | Phala Cloud API key |

## Development

```bash
bun test                     # Run all tests
bun test tests/synpress/     # API tests
bun test tests/integration/  # Integration tests
```

## Related

- [Governance Contracts](/contracts/governance) - Smart contract reference
- [SDK Governance](/build/sdk/governance) - SDK integration
- [Agent Concepts](/learn/agents) - AI agent fundamentals

---

<details>
<summary>📋 Copy as Context</summary>

```
Autocrat - AI-Powered DAO Governance

Features:
- AI Council: Multiple agents deliberate on proposals
- CEO Agent: TEE-backed decision making
- Quality Scoring: AI-powered proposal assessment
- Research Agents: Deep analysis via compute marketplace
- Automated Execution: Timelock-based execution

Council Agents: Treasury, Code, Community, Security

Proposal Flow:
1. Submit → 2. Assess (Quality Oracle) → 3. Research → 4. Deliberate → 5. Decide (CEO in TEE) → 6. Execute

SDK Usage:
// Create proposal
const proposalId = await jeju.governance.createProposal({
  title: 'Increase staking rewards',
  actions: [{ target, value: 0n, calldata }],
});

// Vote
await jeju.governance.vote({ proposalId, support: true });

API Endpoints:
- POST /api/v1/proposals/assess
- GET /api/v1/governance/stats
- GET /api/v1/ceo
- POST /a2a

Contracts: Council.sol, CEOAgent.sol, QualityOracle.sol

Setup: ./scripts/start-council-dev.sh
```

</details>

