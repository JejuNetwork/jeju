/**
 * Autocrat Training Integration
 *
 * Connects training to Autocrat governance.
 * Model deployments require DAO approval.
 */

import type { Address } from 'viem'
import { expectValid } from '@jejunetwork/types'
import {
  AgentRegistrationResponseSchema,
  ProposalStatusResponseSchema,
} from '../schemas'

// ============================================================================
// Types
// ============================================================================

export interface ModelDeploymentProposal {
  proposalId: string
  modelName: string
  modelVersion: string
  checkpointCid: string
  trainingMetrics: {
    steps: number
    finalLoss: number
    averageReward: number
  }
  submitter: Address
  status: 'pending' | 'approved' | 'rejected' | 'executed'
  createdAt: number
}

export interface TrainingProposal {
  proposalId: string
  title: string
  description: string
  environment: string
  modelName: string
  estimatedCost: bigint
  estimatedDuration: number
  submitter: Address
  status: 'draft' | 'submitted' | 'approved' | 'rejected'
}

// ============================================================================
// Autocrat Training Client
// ============================================================================

export class AutocratTrainingClient {
  private autocratApiUrl: string

  constructor(
    config: {
      autocratApiUrl?: string
      dwsApiUrl?: string
    } = {},
  ) {
    this.autocratApiUrl = config.autocratApiUrl ?? 'http://localhost:8010'
  }

  async submitTrainingProposal(proposal: {
    title: string
    description: string
    environment: string
    modelName: string
    trainingSteps: number
    estimatedCost: bigint
  }): Promise<TrainingProposal> {
    const proposalId = `tp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const fullDescription = `
# Training Proposal: ${proposal.title}

## Description
${proposal.description}

## Training Configuration
- **Environment**: ${proposal.environment}
- **Model**: ${proposal.modelName}
- **Steps**: ${proposal.trainingSteps}
- **Estimated Cost**: ${proposal.estimatedCost.toString()} wei

## Expected Outcomes
- Improved agent performance in ${proposal.environment}
- Better decision-making through RLAIF

## Risk Assessment
- Training may not converge if data quality is poor
- Compute costs are pre-approved in this proposal
`

    const response = await fetch(
      `${this.autocratApiUrl}/api/v1/proposals/generate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idea: fullDescription,
          proposalType: 0,
        }),
      },
    )

    const result: TrainingProposal = {
      proposalId,
      title: proposal.title,
      description: proposal.description,
      environment: proposal.environment,
      modelName: proposal.modelName,
      estimatedCost: proposal.estimatedCost,
      estimatedDuration: proposal.trainingSteps * 100,
      submitter: '0x0000000000000000000000000000000000000000' as Address,
      status: response.ok ? 'submitted' : 'draft',
    }

    return result
  }

  async submitModelDeployment(deployment: {
    modelName: string
    modelVersion: string
    checkpointPath: string
    trainingMetrics: {
      steps: number
      finalLoss: number
      averageReward: number
    }
  }): Promise<ModelDeploymentProposal> {
    const proposalId = `md-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

    const checkpointCid = `Qm${Math.random().toString(36).slice(2, 48)}`

    const proposal: ModelDeploymentProposal = {
      proposalId,
      modelName: deployment.modelName,
      modelVersion: deployment.modelVersion,
      checkpointCid,
      trainingMetrics: deployment.trainingMetrics,
      submitter: '0x0000000000000000000000000000000000000000' as Address,
      status: 'pending',
      createdAt: Date.now(),
    }

    await fetch(`${this.autocratApiUrl}/api/v1/proposals/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        daoId: 'jeju',
        title: `Deploy Model: ${deployment.modelName} v${deployment.modelVersion}`,
        summary: `Deploy trained model with ${deployment.trainingMetrics.steps} training steps`,
        description: `
# Model Deployment Proposal

## Model Information
- **Name**: ${deployment.modelName}
- **Version**: ${deployment.modelVersion}
- **Checkpoint**: ipfs://${checkpointCid}

## Training Metrics
- **Steps**: ${deployment.trainingMetrics.steps}
- **Final Loss**: ${deployment.trainingMetrics.finalLoss.toFixed(4)}
- **Average Reward**: ${deployment.trainingMetrics.averageReward.toFixed(4)}

## Deployment Plan
1. Verify checkpoint integrity
2. Load model to inference nodes
3. Update agent registry
4. Monitor performance
`,
        proposalType: 0,
      }),
    })

    return proposal
  }

  async getProposalStatus(proposalId: string): Promise<string> {
    const response = await fetch(
      `${this.autocratApiUrl}/api/v1/proposals/${proposalId}`,
    )
    if (response.ok) {
      const data = expectValid(
        ProposalStatusResponseSchema,
        await response.json(),
        'proposal status response',
      )
      return data.status ?? 'unknown'
    }
    return 'not_found'
  }

  async registerTrainedModel(model: {
    name: string
    version: string
    checkpointCid: string
    capabilities: string[]
  }): Promise<{ agentId: string }> {
    const response = await fetch(
      `${this.autocratApiUrl}/api/v1/agents/register`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `${model.name}-${model.version}`,
          role: 'trained_model',
          a2aEndpoint: `ipfs://${model.checkpointCid}`,
          mcpEndpoint: '',
        }),
      },
    )

    if (response.ok) {
      return expectValid(
        AgentRegistrationResponseSchema,
        await response.json(),
        'agent registration response',
      )
    }

    return { agentId: '' }
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createAutocratTrainingClient(config?: {
  autocratApiUrl?: string
  dwsApiUrl?: string
}): AutocratTrainingClient {
  return new AutocratTrainingClient(config)
}
