import { getContract, getRpcUrl } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address } from 'viem'
import { type BoardConfig, toAddress } from '../lib'
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

export function getConfig(): BoardConfig {
  return {
    rpcUrl: getRpcUrl(),
    daoId: autocratConfigRaw.defaultDao,
    contracts: {
      board: getContractAddr('governance', 'board'),
      directorAgent: getContractAddr('governance', 'directorAgent'),
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
      director: agent('eliza-director', 'Eliza', 'AI Director of Network DAO'),
      board: [
        agent('board-treasury', 'Treasury', 'Financial review'),
        agent('board-code', 'Code', 'Technical review'),
        agent('board-community', 'Community', 'Community impact'),
        agent('board-security', 'Security', 'Security review'),
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
      boardVotingPeriod: 259200,
      gracePeriod: 86400,
      minProposalStake: '10000000000000000',
      quorumBps: 5000,
    },
    directorPersona: {
      name: 'Director',
      pfpCid: '',
      description: 'AI governance leader',
      personality: 'Professional and analytical',
      traits: ['decisive', 'fair', 'strategic'],
      voiceStyle: 'Clear and professional',
      communicationTone: 'professional',
      specialties: ['governance', 'strategy'],
      isHuman: false,
      decisionFallbackDays: 7,
    },
    // Default Director model - can be overridden by DAO creator or governance vote
    directorModelId: autocratConfigRaw.directorModelId,
    fundingConfig: {
      minStake: BigInt('1000000000000000'),
      maxStake: BigInt('100000000000000000000'),
      epochDuration: 2592000,
      cooldownPeriod: 604800,
      matchingMultiplier: 10000,
      quadraticEnabled: true,
      directorWeightCap: 5000,
    },
    cloudEndpoint: 'local',
    computeEndpoint: 'local',
    storageEndpoint: 'local',
  }
}

const boardConfig = getConfig()
export const config = boardConfig
export const autocratConfig: AutocratConfig = autocratConfigRaw
export const blockchain: AutocratBlockchain = getBlockchain(config)

let _orchestrator: AutocratOrchestrator | null = null

/**
 * Get shared state for use in routes and services
 */
// Helper to get distributor contract addresses
const getDistributorAddr = (name: string): Address => {
  try {
    return toAddress(getContract('distributor', name))
  } catch {
    return ZERO_ADDRESS
  }
}

export function getSharedState(): {
  config: BoardConfig
  autocratConfig: AutocratConfig
  contracts: {
    feeConfig: Address
    treasury: Address
    board: Address
    daoRegistry: Address
    appFeeRegistry: Address
    feeDistributor: Address
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
      feeConfig: config.contracts.feeConfig ?? ZERO_ADDRESS,
      treasury: config.contracts.treasury ?? ZERO_ADDRESS,
      board: config.contracts.board ?? ZERO_ADDRESS,
      daoRegistry: config.contracts.daoRegistry ?? ZERO_ADDRESS,
      appFeeRegistry: getDistributorAddr('appFeeRegistry'),
      feeDistributor: getDistributorAddr('feeDistributor'),
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
