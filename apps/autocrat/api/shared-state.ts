/**
 * Shared State Module
 * Avoids circular imports between server.ts and routes
 */

import { getContract, getRpcUrl } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'
import { type CouncilConfig, toAddress } from '../lib'
import { type AutocratBlockchain, getBlockchain } from './blockchain'
import { type AutocratConfig, config as autocratConfigRaw } from './config'
import { type AutocratOrchestrator, createOrchestrator } from './orchestrator'

// Helper to safely get contract addresses - uses config with env override
const getContractAddr = (category: string, name: string): Address => {
  try {
    return toAddress(
      getContract(
        category as
          | 'governance'
          | 'registry'
          | 'tokens'
          | 'moderation'
          | 'defi'
          | 'oif'
          | 'eil'
          | 'payments'
          | 'nodeStaking'
          | 'jns'
          | 'security',
        name,
      ),
    )
  } catch {
    return ZERO_ADDRESS
  }
}

const agent = (id: string, name: string, prompt: string) => ({
  id,
  name,
  model: 'local',
  endpoint: 'local',
  systemPrompt: prompt,
})

export function getConfig(): CouncilConfig {
  return {
    rpcUrl: getRpcUrl(),
    daoId: autocratConfigRaw.defaultDao,
    contracts: {
      council: getContractAddr('governance', 'council'),
      ceoAgent: getContractAddr('governance', 'ceoAgent'),
      treasury: getContractAddr('governance', 'treasury'),
      feeConfig: getContractAddr('payments', 'feeConfig'),
      daoRegistry: getContractAddr('governance', 'daoRegistry'),
      daoFunding: getContractAddr('governance', 'daoFunding'),
      identityRegistry: getContractAddr('registry', 'identity'),
      reputationRegistry: getContractAddr('registry', 'reputation'),
      packageRegistry: getContractAddr('registry', 'package'),
      repoRegistry: getContractAddr('registry', 'repo'),
      modelRegistry: getContractAddr('registry', 'model'),
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
    // Default CEO model - can be overridden by DAO creator or governance vote
    ceoModelId: autocratConfigRaw.ceoModelId,
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

const councilConfig = getConfig()
export const config = councilConfig
export const autocratConfig: AutocratConfig = autocratConfigRaw
export const blockchain: AutocratBlockchain = getBlockchain(config)

let _orchestrator: AutocratOrchestrator | null = null

/**
 * Get shared state for use in routes and services
 */
export function getSharedState(): {
  config: CouncilConfig
  autocratConfig: AutocratConfig
  contracts: {
    feeConfig: Address
    treasury: Address
    council: Address
    daoRegistry: Address
  }
  clients: {
    publicClient: AutocratBlockchain['client'] | null
    walletClient: null // Wallet client requires a private key, set up in services that need it
  }
} {
  return {
    config,
    autocratConfig,
    contracts: {
      feeConfig: config.contracts.feeConfig,
      treasury: config.contracts.treasury,
      council: config.contracts.council,
      daoRegistry: config.contracts.daoRegistry,
    },
    clients: {
      publicClient: blockchain.client,
      walletClient: null,
    },
  }
}

export function setOrchestrator(o: AutocratOrchestrator | null): void {
  _orchestrator = o
}

export function getOrchestrator(): AutocratOrchestrator | null {
  return _orchestrator
}

// Metrics for Prometheus
export const metricsData = { requests: 0, errors: 0, startTime: Date.now() }

export async function runOrchestratorCycle() {
  const start = Date.now()
  if (!_orchestrator) {
    const orchestratorConfig = {
      rpcUrl: config.rpcUrl,
      daoRegistry: config.contracts.daoRegistry,
      daoFunding: config.contracts.daoFunding,
      contracts: {
        daoRegistry: config.contracts.daoRegistry,
        daoFunding: config.contracts.daoFunding,
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
