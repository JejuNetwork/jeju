/** ERC-8004 Agent Identity & Reputation */

import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';

const ZERO = '0x0000000000000000000000000000000000000000';
const ZERO32 = '0x' + '0'.repeat(64);

const IDENTITY_ABI = [
  'function register(string tokenURI) external returns (uint256)',
  'function setA2AEndpoint(uint256 agentId, string endpoint) external',
  'function getA2AEndpoint(uint256 agentId) external view returns (string)',
  'function setMCPEndpoint(uint256 agentId, string endpoint) external',
  'function getMCPEndpoint(uint256 agentId) external view returns (string)',
  'function setServiceType(uint256 agentId, string serviceType) external',
  'function updateTags(uint256 agentId, string[] tags) external',
  'function totalAgents() external view returns (uint256)',
  'function agentExists(uint256 agentId) external view returns (bool)',
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
] as const;

const REPUTATION_ABI = [
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash, bytes feedbackAuth) external',
  'function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)',
  'function readAllFeedback(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2, bool includeRevoked) external view returns (address[] clients, uint8[] scores, bytes32[] tag1s, bytes32[] tag2s, bool[] revokedStatuses)',
] as const;

const VALIDATION_ABI = [
  'function validationRequest(address validatorAddress, uint256 agentId, string requestUri, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag) external',
  'function getSummary(uint256 agentId, address[] validatorAddresses, bytes32 tag) external view returns (uint64 count, uint8 avgResponse)',
] as const;

export interface AgentIdentity { agentId: bigint; name: string; role: string; tokenURI: string; a2aEndpoint: string; mcpEndpoint: string; owner: string }
export interface AgentReputation { agentId: bigint; feedbackCount: number; averageScore: number; recentFeedback: Array<{ client: string; score: number; tag: string }> }
export interface ERC8004Config { rpcUrl: string; identityRegistry: string; reputationRegistry: string; validationRegistry: string; operatorKey?: string }

export class ERC8004Client {
  private readonly provider: JsonRpcProvider;
  private readonly identity: Contract;
  private readonly reputation: Contract;
  private readonly validation: Contract;
  private wallet: Wallet | null = null;

  readonly identityDeployed: boolean;
  readonly reputationDeployed: boolean;
  readonly validationDeployed: boolean;

  constructor(config: ERC8004Config) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.identityDeployed = config.identityRegistry !== ZERO;
    this.reputationDeployed = config.reputationRegistry !== ZERO;
    this.validationDeployed = config.validationRegistry !== ZERO;

    if (config.operatorKey) this.wallet = new Wallet(config.operatorKey, this.provider);

    const signer = this.wallet ?? this.provider;
    this.identity = new Contract(config.identityRegistry, IDENTITY_ABI, signer);
    this.reputation = new Contract(config.reputationRegistry, REPUTATION_ABI, signer);
    this.validation = new Contract(config.validationRegistry, VALIDATION_ABI, signer);
  }

  async registerAgent(name: string, role: string, a2aEndpoint: string, mcpEndpoint: string): Promise<bigint> {
    if (!this.identityDeployed) throw new Error('Identity registry not deployed');
    if (!this.wallet) throw new Error('Wallet required for registration');

    const tokenURI = `data:application/json,${encodeURIComponent(JSON.stringify({ name, role, description: `${role} agent` }))}`;
    const tx = await this.identity.register(tokenURI);
    const receipt = await tx.wait();
    
    const transferEventSig = keccak256(toUtf8Bytes('Transfer(address,address,uint256)'));
    const transferEvent = receipt.logs.find((log: { topics: string[] }) => log.topics[0] === transferEventSig);
    
    if (!transferEvent || !transferEvent.topics[3]) {
      throw new Error(`Agent registration failed: Transfer event not found in tx ${receipt.hash}`);
    }
    
    const agentId = BigInt(transferEvent.topics[3]);
    
    if (agentId === 0n) {
      throw new Error(`Agent registration failed: Invalid agent ID 0 in tx ${receipt.hash}`);
    }

    await Promise.all([
      this.identity.setA2AEndpoint(agentId, a2aEndpoint),
      this.identity.setMCPEndpoint(agentId, mcpEndpoint),
      this.identity.setServiceType(agentId, 'agent'),
      this.identity.updateTags(agentId, ['council', role.toLowerCase(), 'governance']),
    ]);
    
    return agentId;
  }

  async getAgentIdentity(agentId: bigint): Promise<AgentIdentity | null> {
    if (!this.identityDeployed) return null;
    if (!await this.identity.agentExists(agentId)) return null;

    const [tokenURI, a2aEndpoint, mcpEndpoint, owner] = await Promise.all([
      this.identity.tokenURI(agentId) as Promise<string>,
      this.identity.getA2AEndpoint(agentId) as Promise<string>,
      this.identity.getMCPEndpoint(agentId) as Promise<string>,
      this.identity.ownerOf(agentId) as Promise<string>,
    ]);

    let name = `Agent ${agentId}`, role = 'unknown';
    if (tokenURI.startsWith('data:application/json,')) {
      try { const j = JSON.parse(decodeURIComponent(tokenURI.slice(22))); name = j.name ?? name; role = j.role ?? role; } catch {}
    }
    return { agentId, name, role, tokenURI, a2aEndpoint, mcpEndpoint, owner };
  }

  async getAgentReputation(agentId: bigint): Promise<AgentReputation> {
    if (!this.reputationDeployed) return { agentId, feedbackCount: 0, averageScore: 0, recentFeedback: [] };

    const [count, averageScore] = await this.reputation.getSummary(agentId, [], ZERO32, ZERO32) as [bigint, number];
    const recentFeedback: AgentReputation['recentFeedback'] = [];

    if (count > 0n) {
      const [clients, scores, tag1s] = await this.reputation.readAllFeedback(agentId, [], ZERO32, ZERO32, false) as [string[], number[], string[]];
      for (let i = 0; i < Math.min(clients.length, 10); i++) {
        recentFeedback.push({ client: clients[i], score: scores[i], tag: tag1s[i] });
      }
    }
    return { agentId, feedbackCount: Number(count), averageScore, recentFeedback };
  }

  async submitFeedback(agentId: bigint, score: number, tag: string, details?: string): Promise<string> {
    if (!this.reputationDeployed) throw new Error('Reputation registry not deployed');
    if (!this.wallet) throw new Error('Wallet required for feedback');

    const tx = await this.reputation.giveFeedback(agentId, score, keccak256(toUtf8Bytes(tag)), ZERO32, details ?? '', details ? keccak256(toUtf8Bytes(details)) : ZERO32, '0x');
    return (await tx.wait()).hash;
  }

  async requestValidation(agentId: bigint, validator: string, requestUri: string): Promise<string> {
    if (!this.validationDeployed) throw new Error('Validation registry not deployed');
    if (!this.wallet) throw new Error('Wallet required');

    const requestHash = keccak256(toUtf8Bytes(`${agentId}-${validator}-${requestUri}-${Date.now()}`));
    const tx = await this.validation.validationRequest(validator, agentId, requestUri, requestHash);
    await tx.wait();
    return requestHash;
  }

  async getValidationSummary(agentId: bigint): Promise<{ count: number; avgScore: number }> {
    if (!this.validationDeployed) return { count: 0, avgScore: 0 };
    const [count, avg] = await this.validation.getSummary(agentId, [], ZERO32) as [bigint, number];
    return { count: Number(count), avgScore: avg };
  }

  async getTotalAgents(): Promise<number> {
    if (!this.identityDeployed) return 0;
    return Number(await this.identity.totalAgents());
  }
}

let instance: ERC8004Client | null = null;
export const getERC8004Client = (config: ERC8004Config) => instance ??= new ERC8004Client(config);
