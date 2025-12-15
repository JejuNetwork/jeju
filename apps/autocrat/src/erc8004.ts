/** ERC-8004 Agent Identity & Reputation */

import { createPublicClient, createWalletClient, http, keccak256, toUtf8Bytes, zeroAddress, zeroHash, type Address, type Chain, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { readContract, waitForTransactionReceipt } from 'viem/actions';
import { parseAbi } from 'viem';
import { inferChainFromRpcUrl } from '../../../scripts/shared/chain-utils';

const ZERO = zeroAddress;
const ZERO32 = zeroHash;

const IDENTITY_ABI = parseAbi([
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
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
]);

const REPUTATION_ABI = parseAbi([
  'function giveFeedback(uint256 agentId, uint8 score, bytes32 tag1, bytes32 tag2, string fileuri, bytes32 filehash, bytes feedbackAuth) external',
  'function getSummary(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2) external view returns (uint64 count, uint8 averageScore)',
  'function readAllFeedback(uint256 agentId, address[] clientAddresses, bytes32 tag1, bytes32 tag2, bool includeRevoked) external view returns (address[] clients, uint8[] scores, bytes32[] tag1s, bytes32[] tag2s, bool[] revokedStatuses)',
]);

const VALIDATION_ABI = parseAbi([
  'function validationRequest(address validatorAddress, uint256 agentId, string requestUri, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseUri, bytes32 responseHash, bytes32 tag) external',
  'function getSummary(uint256 agentId, address[] validatorAddresses, bytes32 tag) external view returns (uint64 count, uint8 avgResponse)',
]);

export interface AgentIdentity { agentId: bigint; name: string; role: string; tokenURI: string; a2aEndpoint: string; mcpEndpoint: string; owner: string }
export interface AgentReputation { agentId: bigint; feedbackCount: number; averageScore: number; recentFeedback: Array<{ client: string; score: number; tag: string }> }
export interface ERC8004Config { rpcUrl: string; identityRegistry: string; reputationRegistry: string; validationRegistry: string; operatorKey?: string }

export class ERC8004Client {
  private readonly client: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount | null;
  private readonly identityAddress: Address;
  private readonly reputationAddress: Address;
  private readonly validationAddress: Address;

  readonly identityDeployed: boolean;
  readonly reputationDeployed: boolean;
  readonly validationDeployed: boolean;

  constructor(config: ERC8004Config) {
    const chain = inferChainFromRpcUrl(config.rpcUrl);
    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });
    
    this.identityAddress = config.identityRegistry as Address;
    this.reputationAddress = config.reputationRegistry as Address;
    this.validationAddress = config.validationRegistry as Address;
    
    this.identityDeployed = config.identityRegistry !== ZERO;
    this.reputationDeployed = config.reputationRegistry !== ZERO;
    this.validationDeployed = config.validationRegistry !== ZERO;

    if (config.operatorKey) {
      this.account = privateKeyToAccount(config.operatorKey as `0x${string}`);
      this.walletClient = createWalletClient({
        account: this.account,
        chain,
        transport: http(config.rpcUrl),
      });
    } else {
      this.account = null;
      this.walletClient = createWalletClient({
        chain,
        transport: http(config.rpcUrl),
      });
    }
  }

  async registerAgent(name: string, role: string, a2aEndpoint: string, mcpEndpoint: string): Promise<bigint> {
    if (!this.identityDeployed) throw new Error('Identity registry not deployed');
    if (!this.account) throw new Error('Wallet required for registration');
    if (!name || name.trim().length === 0) throw new Error('Agent name is required');
    if (!role || role.trim().length === 0) throw new Error('Agent role is required');
    if (!a2aEndpoint || !a2aEndpoint.trim()) throw new Error('A2A endpoint is required');
    if (!mcpEndpoint || !mcpEndpoint.trim()) throw new Error('MCP endpoint is required');

    const tokenURI = `data:application/json,${encodeURIComponent(JSON.stringify({ name, role, description: `${role} agent` }))}`;
    const hash = await this.walletClient.writeContract({
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'register',
      args: [tokenURI],
      account: this.account,
    });
    const receipt = await waitForTransactionReceipt(this.client, { hash });
    
    const transferEventSig = keccak256(toUtf8Bytes('Transfer(address,address,uint256)'));
    const transferEvent = receipt.logs.find((log) => log.topics[0] === transferEventSig);
    
    if (!transferEvent || !transferEvent.topics[3]) {
      throw new Error(`Agent registration failed: Transfer event not found in tx ${hash}`);
    }
    
    const agentId = BigInt(transferEvent.topics[3]);
    
    if (agentId === 0n) {
      throw new Error(`Agent registration failed: Invalid agent ID 0 in tx ${hash}`);
    }

    const [hash1, hash2, hash3, hash4] = await Promise.all([
      this.walletClient.writeContract({
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'setA2AEndpoint',
        args: [agentId, a2aEndpoint],
        account: this.account,
      }),
      this.walletClient.writeContract({
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'setMCPEndpoint',
        args: [agentId, mcpEndpoint],
        account: this.account,
      }),
      this.walletClient.writeContract({
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'setServiceType',
        args: [agentId, 'agent'],
        account: this.account,
      }),
      this.walletClient.writeContract({
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'updateTags',
        args: [agentId, ['council', role.toLowerCase(), 'governance']],
        account: this.account,
      }),
    ]);
    
    await Promise.all([
      waitForTransactionReceipt(this.client, { hash: hash1 }),
      waitForTransactionReceipt(this.client, { hash: hash2 }),
      waitForTransactionReceipt(this.client, { hash: hash3 }),
      waitForTransactionReceipt(this.client, { hash: hash4 }),
    ]);
    
    return agentId;
  }

  async getAgentIdentity(agentId: bigint): Promise<AgentIdentity | null> {
    if (!this.identityDeployed) return null;
    const exists = await readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'agentExists',
      args: [agentId],
    });
    if (!exists) return null;

    const [tokenURI, a2aEndpoint, mcpEndpoint, owner] = await Promise.all([
      readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'tokenURI',
        args: [agentId],
      }),
      readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getA2AEndpoint',
        args: [agentId],
      }),
      readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'getMCPEndpoint',
        args: [agentId],
      }),
      readContract(this.client, {
        address: this.identityAddress,
        abi: IDENTITY_ABI,
        functionName: 'ownerOf',
        args: [agentId],
      }),
    ]);

    let name = `Agent ${agentId}`, role = 'unknown';
    if (tokenURI.startsWith('data:application/json,')) {
      const j = JSON.parse(decodeURIComponent(tokenURI.slice(22)));
      name = j.name ?? name;
      role = j.role ?? role;
    }
    return { agentId, name, role, tokenURI, a2aEndpoint, mcpEndpoint, owner };
  }

  async getAgentReputation(agentId: bigint): Promise<AgentReputation> {
    if (!this.reputationDeployed) return { agentId, feedbackCount: 0, averageScore: 0, recentFeedback: [] };

    const [count, averageScore] = await readContract(this.client, {
      address: this.reputationAddress,
      abi: REPUTATION_ABI,
      functionName: 'getSummary',
      args: [agentId, [], ZERO32, ZERO32],
    }) as [bigint, number];
    const recentFeedback: AgentReputation['recentFeedback'] = [];

    if (count > 0n) {
      const [clients, scores, tag1s] = await readContract(this.client, {
        address: this.reputationAddress,
        abi: REPUTATION_ABI,
        functionName: 'readAllFeedback',
        args: [agentId, [], ZERO32, ZERO32, false],
      }) as [Address[], number[], `0x${string}`[]];
      for (let i = 0; i < Math.min(clients.length, 10); i++) {
        recentFeedback.push({ client: clients[i], score: scores[i], tag: tag1s[i] });
      }
    }
    return { agentId, feedbackCount: Number(count), averageScore, recentFeedback };
  }

  async submitFeedback(agentId: bigint, score: number, tag: string, details?: string): Promise<`0x${string}`> {
    if (!this.reputationDeployed) throw new Error('Reputation registry not deployed');
    if (!this.account) throw new Error('Wallet required for feedback');
    if (agentId === 0n) throw new Error('Invalid agent ID');
    if (score < 0 || score > 100) throw new Error('Score must be between 0 and 100');
    if (!tag || tag.trim().length === 0) throw new Error('Tag is required');

    const hash = await this.walletClient.writeContract({
      address: this.reputationAddress,
      abi: REPUTATION_ABI,
      functionName: 'giveFeedback',
      args: [
        agentId,
        score,
        keccak256(toUtf8Bytes(tag)),
        ZERO32,
        details ?? '',
        details ? keccak256(toUtf8Bytes(details)) : ZERO32,
        '0x' as `0x${string}`,
      ],
      account: this.account,
    });
    await waitForTransactionReceipt(this.client, { hash });
    return hash;
  }

  async requestValidation(agentId: bigint, validator: Address, requestUri: string): Promise<`0x${string}`> {
    if (!this.validationDeployed) throw new Error('Validation registry not deployed');
    if (!this.account) throw new Error('Wallet required');
    if (agentId === 0n) throw new Error('Invalid agent ID');
    if (validator === zeroAddress) throw new Error('Invalid validator address');
    if (!requestUri || requestUri.trim().length === 0) throw new Error('Request URI is required');

    const requestHash = keccak256(toUtf8Bytes(`${agentId}-${validator}-${requestUri}-${Date.now()}`));
    const hash = await this.walletClient.writeContract({
      address: this.validationAddress,
      abi: VALIDATION_ABI,
      functionName: 'validationRequest',
      args: [validator, agentId, requestUri, requestHash],
      account: this.account,
    });
    await waitForTransactionReceipt(this.client, { hash });
    return requestHash;
  }

  async getValidationSummary(agentId: bigint): Promise<{ count: number; avgScore: number }> {
    if (!this.validationDeployed) return { count: 0, avgScore: 0 };
    const [count, avg] = await readContract(this.client, {
      address: this.validationAddress,
      abi: VALIDATION_ABI,
      functionName: 'getSummary',
      args: [agentId, [], ZERO32],
    }) as [bigint, number];
    return { count: Number(count), avgScore: avg };
  }

  async getTotalAgents(): Promise<number> {
    if (!this.identityDeployed) return 0;
    return Number(await readContract(this.client, {
      address: this.identityAddress,
      abi: IDENTITY_ABI,
      functionName: 'totalAgents',
    }) as bigint);
  }
}
