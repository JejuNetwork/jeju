/**
 * Shared State Module
 * Avoids circular imports between server.ts and routes
 */

import { getL1RpcUrl } from '@jejunetwork/config'
import type { Address } from 'viem'
import { type AutocratBlockchain, getBlockchain } from './blockchain'
import { type AutocratOrchestrator, createOrchestrator } from './orchestrator'
import type { CouncilConfig } from './types'

// ============ Configuration ============

const ZERO_ADDR = '0x0000000000000000000000000000000000000000' as `0x${string}`

const addr = (key: string) => (process.env[key] ?? ZERO_ADDR) as `0x${string}`
const agent = (id: string, name: string, prompt: string) => ({
  id,
  name,
  model: 'local',
  endpoint: 'local',
  systemPrompt: prompt,
})

export function getConfig(): CouncilConfig {
  return {
    rpcUrl: process.env.RPC_URL ?? process.env.JEJU_RPC_URL ?? getL1RpcUrl(),
    daoId: process.env.DEFAULT_DAO ?? 'jeju',
    contracts: {
      council: addr('COUNCIL_ADDRESS'),
      ceoAgent: addr('CEO_AGENT_ADDRESS'),
      treasury: addr('TREASURY_ADDRESS'),
      feeConfig: addr('FEE_CONFIG_ADDRESS'),
      daoRegistry: addr('DAO_REGISTRY_ADDRESS'),
      daoFunding: addr('DAO_FUNDING_ADDRESS'),
      identityRegistry: addr('IDENTITY_REGISTRY_ADDRESS'),
      reputationRegistry: addr('REPUTATION_REGISTRY_ADDRESS'),
      packageRegistry: addr('PACKAGE_REGISTRY_ADDRESS'),
      repoRegistry: addr('REPO_REGISTRY_ADDRESS'),
      modelRegistry: addr('MODEL_REGISTRY_ADDRESS'),
    },
    agents: {
      ceo: agent('eliza-ceo', 'Eliza', 'AI CEO of Network DAO'),
      council: [
        agent('council-treasury', 'Treasury', 'Financial review'),
        agent('council-code', 'Code', 'Technical review'),
        agent('council-community', 'Community', 'Community impact'),
        agent('council-security', 'Security', 'Security review'),
      ],
      proposalAgent: agent(
        'proposal-agent',
        'Proposal Assistant',
        'Help craft proposals',
      ),
      researchAgent: agent('research-agent', 'Researcher', 'Deep research'),
      fundingAgent: agent(
        'funding-agent',
        'Funding Oracle',
        'Deep funding analysis',
      ),
    },
    parameters: {
      minQualityScore: 70,
      councilVotingPeriod: 259200,
      gracePeriod: 86400,
      minProposalStake: BigInt('10000000000000000'),
      quorumBps: 5000,
    },
    ceoPersona: {
      name: 'CEO',
      pfpCid: '',
      description: 'AI governance leader',
      personality: 'Professional and analytical',
      traits: ['decisive', 'fair', 'strategic'],
      voiceStyle: 'Clear and professional',
      communicationTone: 'professional',
      specialties: ['governance', 'strategy'],
    },
    fundingConfig: {
      minStake: BigInt('1000000000000000'),
      maxStake: BigInt('100000000000000000000'),
      epochDuration: 2592000,
      cooldownPeriod: 604800,
      matchingMultiplier: 10000,
      quadraticEnabled: true,
      ceoWeightCap: 5000,
    },
    cloudEndpoint: 'local',
    computeEndpoint: 'local',
    storageEndpoint: 'local',
  }
}

// ============ Shared State ============

export const config = getConfig()
export const blockchain: AutocratBlockchain = getBlockchain(config)

let _orchestrator: AutocratOrchestrator | null = null

export function setOrchestrator(o: AutocratOrchestrator | null): void {
  _orchestrator = o
}

export function getOrchestrator(): AutocratOrchestrator | null {
  return _orchestrator
}

// Metrics for Prometheus
export const metricsData = { requests: 0, errors: 0, startTime: Date.now() }

// ============ Orchestrator Cycle ============

export async function runOrchestratorCycle() {
  const start = Date.now()
  if (!_orchestrator) {
    const orchestratorConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry as Address,
      daoFunding: config.contracts.daoFunding as Address,
      contracts: {
        daoRegistry: config.contracts.daoRegistry as Address,
        daoFunding: config.contracts.daoFunding as Address,
      },
    }
    _orchestrator = createOrchestrator(orchestratorConfig, blockchain)
    await _orchestrator.start()
  }
  const status = _orchestrator.getStatus()
  return {
    cycleCount: status.cycleCount,
    processedProposals: status.totalProcessed,
    duration: Date.now() - start,
  }
}
