/**
 * Agent SDK - Manages agent lifecycle: creation, state, execution, and funding.
 */

import { type Address, type PublicClient, type WalletClient, parseEther, parseAbi, isAddress } from 'viem';
import type {
  AgentDefinition,
  AgentCharacter,
  AgentState,
  CrucibleConfig,
  AgentSearchFilter,
  SearchResult,
  MemoryEntry,
} from '../types';
import { CrucibleStorage } from './storage';
import { CrucibleCompute } from './compute';
import { createLogger, type Logger } from './logger';
import { expect, AgentCharacterSchema, AgentSearchResponseSchema } from '../schemas';

// ABI matching actual IdentityRegistry.sol contract
const IDENTITY_REGISTRY_ABI = parseAbi([
  'function register(string tokenURI_) external returns (uint256 agentId)',
  'function getAgent(uint256 agentId) external view returns ((uint256 agentId, address owner, uint8 tier, address stakedToken, uint256 stakedAmount, uint256 registeredAt, uint256 lastActivityAt, bool isBanned, bool isSlashed))',
  'function setAgentUri(uint256 agentId, string newTokenURI) external',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 agentId) external view returns (address)',
  'function tokenURI(uint256 agentId) external view returns (string)',
  'event Registered(uint256 indexed agentId, address indexed owner, uint8 tier, uint256 stakedAmount, string tokenURI)',
]);

const AGENT_VAULT_ABI = parseAbi([
  'function createVault(uint256 agentId) external payable returns (address vault)',
  'function getVault(uint256 agentId) external view returns (address)',
  'function deposit(uint256 agentId) external payable',
  'function withdraw(uint256 agentId, uint256 amount) external',
  'function getBalance(uint256 agentId) external view returns (uint256)',
  'function setSpendLimit(uint256 agentId, uint256 limit) external',
  'function approveSpender(uint256 agentId, address spender) external',
  'function spend(uint256 agentId, address recipient, uint256 amount, string reason) external',
  'event VaultCreated(uint256 indexed agentId, address vault)',
  'event Deposit(uint256 indexed agentId, address from, uint256 amount)',
  'event Spent(uint256 indexed agentId, address recipient, uint256 amount, string reason)',
]);

export interface AgentSDKConfig {
  crucibleConfig: CrucibleConfig;
  storage: CrucibleStorage;
  compute: CrucibleCompute;
  publicClient: PublicClient;
  walletClient?: WalletClient;
  logger?: Logger;
}

export class AgentSDK {
  private config: CrucibleConfig;
  private storage: CrucibleStorage;
  private compute: CrucibleCompute;
  private publicClient: PublicClient;
  private walletClient?: WalletClient;
  private log: Logger;

  constructor(sdkConfig: AgentSDKConfig) {
    this.config = sdkConfig.crucibleConfig;
    this.storage = sdkConfig.storage;
    this.compute = sdkConfig.compute;
    this.publicClient = sdkConfig.publicClient;
    this.walletClient = sdkConfig.walletClient;
    this.log = sdkConfig.logger ?? createLogger('AgentSDK');
  }

  async registerAgent(
    character: AgentCharacter,
    options?: { initialFunding?: bigint; botType?: 'ai_agent' | 'trading_bot' | 'org_tool' }
  ): Promise<{ agentId: bigint; vaultAddress: Address; characterCid: string; stateCid: string }> {
    if (!this.walletClient) throw new Error('Wallet client required for registration');

    this.log.info('Registering agent', { name: character.name, id: character.id });

    const characterCid = await this.storage.storeCharacter(character);
    const initialState = this.storage.createInitialState(character.id);
    const stateCid = await this.storage.storeAgentState(initialState);
    const tokenUri = `ipfs://${characterCid}#state=${stateCid}`;

    this.log.debug('Stored character and state', { characterCid, stateCid });

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'register',
      args: [tokenUri],
      account: expect(this.walletClient.account, 'Wallet client account is required'),
    });

    const txHash = await this.walletClient.writeContract(request);
    this.log.debug('Registration tx submitted', { txHash });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: txHash });
    const agentId = receipt.logs[0]?.topics[1] ? BigInt(receipt.logs[0].topics[1]) : 0n;

    this.log.info('Agent registered', { agentId: agentId.toString(), txHash });

    const vaultAddress = await this.createVault(agentId, options?.initialFunding);

    return { agentId, vaultAddress, characterCid, stateCid };
  }

  async createVault(agentId: bigint, initialFunding?: bigint): Promise<Address> {
    expect(this.walletClient, 'Wallet client required');
    expect(agentId > 0n, 'Agent ID must be greater than 0');

    const funding = initialFunding ?? parseEther('0.01');
    expect(funding >= 0n, 'Funding must be non-negative');
    this.log.info('Creating vault', { agentId: agentId.toString(), funding: funding.toString() });

    const wallet = expect(this.walletClient, 'Wallet client is required');
    const account = expect(wallet.account, 'Wallet client account is required');
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'createVault',
      args: [agentId],
      value: funding,
      account,
    });

    const txHash = await wallet.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    const vaultAddress = await this.publicClient.readContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'getVault',
      args: [agentId],
    }) as Address;

    this.log.info('Vault created', { agentId: agentId.toString(), vaultAddress });
    return vaultAddress;
  }

  async getAgent(agentId: bigint): Promise<AgentDefinition | null> {
    this.log.debug('Getting agent', { agentId: agentId.toString() });

    const exists = await this.publicClient.readContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'agentExists',
      args: [agentId],
    }) as boolean;

    if (!exists) {
      this.log.debug('Agent not found', { agentId: agentId.toString() });
      return null;
    }

    // Get AgentRegistration struct from contract
    const registration = await this.publicClient.readContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [agentId],
    }) as {
      agentId: bigint;
      owner: Address;
      tier: number;
      stakedToken: Address;
      stakedAmount: bigint;
      registeredAt: bigint;
      lastActivityAt: bigint;
      isBanned: boolean;
      isSlashed: boolean;
    };

    // Get tokenURI for character/state CIDs
    const tokenUri = await this.publicClient.readContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'tokenURI',
      args: [agentId],
    }) as string;

    const { characterCid, stateCid } = this.parseTokenUri(tokenUri);

    // Get vault address
    const vaultAddress = await this.publicClient.readContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'getVault',
      args: [agentId],
    }) as Address;

    // Get name from character (stored in IPFS)
    let name = `Agent ${agentId}`;
    if (characterCid) {
      const character = await this.storage.loadCharacter(characterCid);
      name = character.name;
    }

    // Infer botType from character or default to ai_agent
    let botType: 'ai_agent' | 'trading_bot' | 'org_tool' = 'ai_agent';
    if (characterCid) {
      const character = await this.storage.loadCharacter(characterCid);
      if (character.topics?.includes('trading') || character.topics?.includes('arbitrage') || character.topics?.includes('mev')) {
        botType = 'trading_bot';
      } else if (character.topics?.includes('org') || character.topics?.includes('todo') || character.topics?.includes('team')) {
        botType = 'org_tool';
      }
    }

    return {
      agentId,
      owner: registration.owner,
      name,
      botType,
      characterCid,
      stateCid,
      vaultAddress,
      active: !registration.isBanned,
      registeredAt: Number(registration.registeredAt) * 1000,
      lastExecutedAt: Number(registration.lastActivityAt) * 1000,
      executionCount: 0,
    };
  }

  async loadCharacter(agentId: bigint): Promise<AgentCharacter> {
    expect(agentId > 0n, 'Agent ID must be greater than 0');
    const agent = await this.getAgent(agentId);
    const validAgent = expect(agent, `Agent not found: ${agentId}`);
    const characterCid = expect(validAgent.characterCid, `Agent ${agentId} has no character CID`);
    return this.storage.loadCharacter(characterCid);
  }

  async loadState(agentId: bigint): Promise<AgentState> {
    expect(agentId > 0n, 'Agent ID must be greater than 0');
    const agent = await this.getAgent(agentId);
    const validAgent = expect(agent, `Agent not found: ${agentId}`);
    return this.storage.loadAgentState(validAgent.stateCid);
  }

  async updateState(agentId: bigint, updates: Partial<AgentState>): Promise<{ state: AgentState; cid: string }> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.info('Updating agent state', { agentId: agentId.toString() });

    const currentState = await this.loadState(agentId);
    const { state, cid } = await this.storage.updateAgentState(currentState, updates);

    const agent = await this.getAgent(agentId);
    if (!agent) throw new Error(`Agent not found: ${agentId}`);

    const newTokenUri = `ipfs://${agent.characterCid}#state=${cid}`;

    const wallet = expect(this.walletClient, 'Wallet client is required');
    const account = expect(wallet.account, 'Wallet client account is required');
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.identityRegistry,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setAgentUri',
      args: [agentId, newTokenUri],
      account,
    });

    await this.walletClient.writeContract(request);
    this.log.info('State updated', { agentId: agentId.toString(), newStateCid: cid });

    return { state, cid };
  }

  async addMemory(
    agentId: bigint,
    content: string,
    options?: { importance?: number; roomId?: string; userId?: string }
  ): Promise<MemoryEntry> {
    expect(agentId > 0n, 'Agent ID must be greater than 0');
    expect(content, 'Memory content is required');
    expect(content.length > 0, 'Memory content cannot be empty');
    if (options?.importance !== undefined) {
      expect(options.importance >= 0 && options.importance <= 1, 'Importance must be between 0 and 1');
    }

    const state = await this.loadState(agentId);
    const embedding = await this.compute.generateEmbedding(content);

    const memory: MemoryEntry = {
      id: crypto.randomUUID(),
      content,
      embedding,
      importance: options?.importance ?? 0.5,
      createdAt: Date.now(),
      roomId: options?.roomId,
      userId: options?.userId,
    };

    await this.updateState(agentId, { memories: [...state.memories, memory] });
    this.log.debug('Memory added', { agentId: agentId.toString(), memoryId: memory.id });

    return memory;
  }

  async getVaultBalance(agentId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'getBalance',
      args: [agentId],
    }) as Promise<bigint>;
  }

  async fundVault(agentId: bigint, amount: bigint): Promise<string> {
    if (!this.walletClient) throw new Error('Wallet client required');

    this.log.info('Funding vault', { agentId: agentId.toString(), amount: amount.toString() });

    const wallet = expect(this.walletClient, 'Wallet client is required');
    const account = expect(wallet.account, 'Wallet client account is required');
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'deposit',
      args: [agentId],
      value: amount,
      account,
    });

    const txHash = await this.walletClient.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    this.log.info('Vault funded', { agentId: agentId.toString(), txHash });
    return txHash;
  }

  async withdrawFromVault(agentId: bigint, amount: bigint): Promise<string> {
    expect(this.walletClient, 'Wallet client required');
    expect(agentId > 0n, 'Agent ID must be greater than 0');
    expect(amount > 0n, 'Amount must be greater than 0');

    this.log.info('Withdrawing from vault', { agentId: agentId.toString(), amount: amount.toString() });

    const wallet = expect(this.walletClient, 'Wallet client is required');
    const account = expect(wallet.account, 'Wallet client account is required');
    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'withdraw',
      args: [agentId, amount],
      account,
    });

    const txHash = await wallet.writeContract(request);
    await this.publicClient.waitForTransactionReceipt({ hash: txHash });

    this.log.info('Withdrawal complete', { agentId: agentId.toString(), txHash });
    return txHash;
  }

  async setSpendLimit(agentId: bigint, limit: bigint): Promise<void> {
    if (!this.walletClient) throw new Error('Wallet client required');

    const { request } = await this.publicClient.simulateContract({
      address: this.config.contracts.agentVault,
      abi: AGENT_VAULT_ABI,
      functionName: 'setSpendLimit',
      args: [agentId, limit],
      account: expect(this.walletClient.account, 'Wallet client account is required'),
    });

    await this.walletClient.writeContract(request);
    this.log.info('Spend limit set', { agentId: agentId.toString(), limit: limit.toString() });
  }

  async searchAgents(filter: AgentSearchFilter): Promise<SearchResult<AgentDefinition>> {
    expect(filter, 'Search filter is required');
    if (filter.limit !== undefined) {
      expect(filter.limit > 0 && filter.limit <= 100, 'Limit must be between 1 and 100');
    }
    if (filter.owner !== undefined) {
      expect(isAddress(filter.owner), 'Owner must be a valid address');
    }
    this.log.debug('Searching agents', { filter });

    const query = `
      query SearchAgents($filter: AgentFilter!) {
        agents(filter: $filter) {
          items { agentId owner name characterCid stateCid vaultAddress active registeredAt lastExecutedAt executionCount }
          total hasMore
        }
      }
    `;

    const response = await fetch(this.config.services.indexerGraphql, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { filter } }),
    });

    expect(response.ok, `Search failed: ${response.statusText}`);

    const rawResult = await response.json();
    const parsed = AgentSearchResponseSchema.parse(rawResult);
    this.log.debug('Search complete', { total: parsed.data.agents.total });

    return parsed.data.agents as SearchResult<AgentDefinition>;
  }

  private parseTokenUri(uri: string): { characterCid: string; stateCid: string } {
    expect(uri, 'Token URI is required');
    expect(uri.length > 0, 'Token URI cannot be empty');
    const [base, fragment] = uri.split('#');
    expect(base, 'Token URI must contain base part');
    expect(fragment, 'Token URI must contain fragment part');
    const characterCid = base.replace('ipfs://', '');
    const stateCid = fragment.replace('state=', '');
    expect(characterCid.length > 0, 'Character CID cannot be empty');
    expect(stateCid.length > 0, 'State CID cannot be empty');
    return { characterCid, stateCid };
  }
}

export function createAgentSDK(config: AgentSDKConfig): AgentSDK {
  return new AgentSDK(config);
}