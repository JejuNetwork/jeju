import type {
  Block,
  ComputeProvider,
  RegisteredAgent,
  StorageProvider,
  Transaction,
} from '../model'

export function mapAgentSummary(agent: RegisteredAgent) {
  if (!agent) {
    throw new Error('Agent is required')
  }
  if (agent.agentId === undefined || agent.agentId === null) {
    throw new Error('Agent agentId is required')
  }
  if (!agent.registeredAt) {
    throw new Error('Agent registeredAt is required')
  }

  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    description: agent.description,
    tags: agent.tags,
    stakeTier: agent.stakeTier,
    stakeAmount: agent.stakeAmount.toString(),
    active: agent.active,
    isBanned: agent.isBanned,
    a2aEndpoint: agent.a2aEndpoint,
    mcpEndpoint: agent.mcpEndpoint,
    registeredAt: agent.registeredAt.toISOString(),
  }
}

export function mapAgentWithSkills(agent: RegisteredAgent) {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    a2aEndpoint: agent.a2aEndpoint,
    skills: agent.a2aSkills,
    stakeTier: agent.stakeTier,
  }
}

export function mapAgentWithTools(agent: RegisteredAgent) {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    mcpEndpoint: agent.mcpEndpoint,
    tools: agent.mcpTools,
    stakeTier: agent.stakeTier,
  }
}

export function mapBlockSummary(block: Block) {
  if (!block) {
    throw new Error('Block is required')
  }
  if (typeof block.number !== 'number' || block.number < 0) {
    throw new Error(`Invalid block number: ${block.number}`)
  }
  if (!block.hash || typeof block.hash !== 'string') {
    throw new Error(`Invalid block hash: ${block.hash}`)
  }
  if (!block.timestamp) {
    throw new Error('Block timestamp is required')
  }

  return {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
  }
}

export function mapBlockDetail(block: Block) {
  if (!block) {
    throw new Error('Block is required')
  }
  if (typeof block.number !== 'number' || block.number < 0) {
    throw new Error(`Invalid block number: ${block.number}`)
  }
  if (!block.hash || typeof block.hash !== 'string') {
    throw new Error(`Invalid block hash: ${block.hash}`)
  }
  if (!block.timestamp) {
    throw new Error('Block timestamp is required')
  }

  return {
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
    gasLimit: block.gasLimit.toString(),
  }
}

export function mapTransactionSummary(tx: Transaction) {
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    from: tx.from.address,
    to: tx.to?.address,
    value: tx.value.toString(),
    status: tx.status,
  }
}

export function mapTransactionDetail(tx: Transaction) {
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    from: tx.from.address,
    to: tx.to?.address,
    value: tx.value.toString(),
    gasPrice: tx.gasPrice?.toString(),
    gasUsed: tx.gasUsed?.toString(),
    status: tx.status,
  }
}

export function mapProviderSummary(
  p: ComputeProvider | StorageProvider,
  type: 'compute' | 'storage',
) {
  if (!p) {
    throw new Error('Provider is required')
  }
  if (type !== 'compute' && type !== 'storage') {
    throw new Error(
      `Invalid provider type: ${type}. Must be 'compute' or 'storage'`,
    )
  }
  if (!p.address || typeof p.address !== 'string') {
    throw new Error(`Invalid provider address: ${p.address}`)
  }

  return {
    address: p.address,
    name: p.name,
    endpoint: p.endpoint,
    agentId: p.agentId,
    ...(type === 'storage' && 'providerType' in p
      ? { providerType: p.providerType }
      : {}),
  }
}
