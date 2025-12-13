import { RegisteredAgent, Block, Transaction, ComputeProvider, StorageProvider } from '../model';

export function mapAgentSummary(agent: RegisteredAgent) {
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
  };
}

export function mapAgentWithSkills(agent: RegisteredAgent) {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    a2aEndpoint: agent.a2aEndpoint,
    skills: agent.a2aSkills,
    stakeTier: agent.stakeTier,
  };
}

export function mapAgentWithTools(agent: RegisteredAgent) {
  return {
    agentId: agent.agentId.toString(),
    name: agent.name,
    mcpEndpoint: agent.mcpEndpoint,
    tools: agent.mcpTools,
    stakeTier: agent.stakeTier,
  };
}

export function mapBlockSummary(block: Block) {
  return {
    number: block.number,
    hash: block.hash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
  };
}

export function mapBlockDetail(block: Block) {
  return {
    number: block.number,
    hash: block.hash,
    parentHash: block.parentHash,
    timestamp: block.timestamp.toISOString(),
    transactionCount: block.transactionCount,
    gasUsed: block.gasUsed.toString(),
    gasLimit: block.gasLimit.toString(),
  };
}

export function mapTransactionSummary(tx: Transaction) {
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    from: tx.from?.address,
    to: tx.to?.address,
    value: tx.value.toString(),
    status: tx.status,
  };
}

export function mapTransactionDetail(tx: Transaction) {
  return {
    hash: tx.hash,
    blockNumber: tx.blockNumber,
    from: tx.from?.address,
    to: tx.to?.address,
    value: tx.value.toString(),
    gasPrice: tx.gasPrice?.toString(),
    gasUsed: tx.gasUsed?.toString(),
    status: tx.status,
  };
}

export function mapProviderSummary(p: ComputeProvider | StorageProvider, type: 'compute' | 'storage') {
  return {
    address: p.address,
    name: p.name,
    endpoint: p.endpoint,
    agentId: p.agentId,
    ...(type === 'storage' && 'providerType' in p ? { providerType: p.providerType } : {}),
  };
}
