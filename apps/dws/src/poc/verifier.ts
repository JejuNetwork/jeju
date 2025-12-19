/**
 * Proof-of-Cloud Verifier Service
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  type Chain,
  keccak256,
  toBytes,
  encodeAbiParameters,
  parseAbiParameters,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import {
  type TEEQuote,
  type TEEPlatform,
  type PoCVerificationRequest,
  type PoCVerificationResult,
  type PoCStatus,
  type PoCVerificationLevel,
  type AgentPoCStatus,
  type PoCVerificationEvent,
  type PoCEventListener,
  POC_TAGS,
  POC_SCORES,
  PoCError,
  PoCErrorCode,
} from './types';
import { parseQuote, verifyQuote, hashHardwareId } from './quote-parser';
import { PoCRegistryClient } from './registry-client';

const POC_VALIDATOR_ABI = [
  { name: 'requestVerification', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'agentId', type: 'uint256' }, { name: 'hardwareIdHash', type: 'bytes32' }, { name: 'requestUri', type: 'string' }],
    outputs: [{ name: 'requestHash', type: 'bytes32' }] },
  { name: 'submitVerification', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'requestHash', type: 'bytes32' }, { name: 'agentId', type: 'uint256' }, { name: 'hardwareIdHash', type: 'bytes32' },
             { name: 'level', type: 'uint8' }, { name: 'cloudProvider', type: 'string' }, { name: 'region', type: 'string' },
             { name: 'evidenceHash', type: 'bytes32' }, { name: 'signature', type: 'bytes' }],
    outputs: [] },
  { name: 'revokeHardware', type: 'function', stateMutability: 'nonpayable',
    inputs: [{ name: 'hardwareIdHash', type: 'bytes32' }, { name: 'reason', type: 'string' }],
    outputs: [] },
  { name: 'getAgentStatus', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'verified', type: 'bool' }, { name: 'level', type: 'uint8' },
              { name: 'hardwareIdHash', type: 'bytes32' }, { name: 'expiresAt', type: 'uint256' }] },
  { name: 'getNonce', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'signer', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'needsReverification', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'threshold', type: 'function', stateMutability: 'view',
    inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const;

const IDENTITY_REGISTRY_ABI = [
  { name: 'agentExists', type: 'function', stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }], outputs: [{ name: '', type: 'bool' }] },
] as const;

interface VerifierConfig {
  chain: Chain;
  rpcUrl: string;
  signerKey: Hex;
  validatorAddress: Address;
  identityRegistryAddress: Address;
  registryEndpoint?: string;
  hardwareIdSalt: Hex;
}

export class PoCVerifier {
  private readonly config: VerifierConfig;
  private readonly publicClient: PublicClient;
  private readonly walletClient: WalletClient;
  private readonly account: PrivateKeyAccount;
  private readonly registryClient: PoCRegistryClient | null;
  private readonly eventListeners = new Set<PoCEventListener>();

  constructor(config: VerifierConfig) {
    this.config = config;
    this.account = privateKeyToAccount(config.signerKey);
    const transport = http(config.rpcUrl);
    this.publicClient = createPublicClient({ chain: config.chain, transport });
    this.walletClient = createWalletClient({ chain: config.chain, transport, account: this.account });
    this.registryClient = config.registryEndpoint ? new PoCRegistryClient(config.registryEndpoint) : null;
  }

  async verifyAttestation(agentId: bigint, quoteHex: Hex, expectedMeasurement?: Hex): Promise<PoCVerificationResult> {
    const timestamp = Date.now();
    const nonce = keccak256(toBytes(`${agentId}:${timestamp}:${Math.random()}`));

    const request: PoCVerificationRequest = {
      agentId, quote: quoteHex, expectedMeasurement, nonce, timestamp, requester: this.account.address,
    };

    const requestHash = this.computeRequestHash(request);

    this.emitEvent({
      type: 'request', timestamp, agentId, requestHash, status: null, level: null, error: null,
      metadata: { expectedMeasurement },
    });

    const agentExists = await this.checkAgentExists(agentId);
    if (!agentExists) throw new PoCError(PoCErrorCode.AGENT_NOT_FOUND, `Agent ${agentId} not found`);

    const parseResult = parseQuote(quoteHex);
    if (!parseResult.success || !parseResult.quote) {
      throw new PoCError(PoCErrorCode.INVALID_QUOTE, parseResult.error ?? 'Failed to parse quote');
    }

    const quote = parseResult.quote;
    const verifyResult = await verifyQuote(quote, expectedMeasurement);
    if (!verifyResult.valid) {
      throw new PoCError(PoCErrorCode.SIGNATURE_INVALID, verifyResult.error ?? 'Quote verification failed', { quote, verifyResult });
    }

    const hardwareIdHash = hashHardwareId(quote.hardwareId, this.config.hardwareIdSalt);

    let pocStatus: PoCStatus = 'unknown';
    let pocLevel: PoCVerificationLevel | null = null;
    let cloudProvider: string | null = null;
    let region: string | null = null;

    if (this.registryClient) {
      const registryResult = await this.registryClient.checkHardware(hardwareIdHash);
      if (registryResult) {
        pocStatus = registryResult.active ? 'verified' : 'revoked';
        pocLevel = registryResult.level;
        cloudProvider = registryResult.cloudProvider;
        region = registryResult.region;
      }
    } else {
      pocStatus = 'pending';
      pocLevel = 1;
    }

    const evidenceHash = keccak256(toBytes(JSON.stringify({
      quote: quoteHex, measurement: quote.measurement, platform: quote.platform, hardwareIdHash, timestamp,
    })));

    const score = pocStatus === 'verified' ? POC_SCORES.VERIFIED :
                  pocStatus === 'pending' ? POC_SCORES.PENDING : POC_SCORES.REJECTED;

    const result: PoCVerificationResult = {
      requestHash, agentId, status: pocStatus, level: pocLevel, hardwareIdHash,
      cloudProvider, region, evidenceHash, timestamp, oracleSignature: '0x' as Hex, score,
    };

    if (pocStatus === 'verified' || pocStatus === 'pending') {
      await this.submitVerificationOnChain(result, quote);
    }

    this.emitEvent({
      type: 'result', timestamp: Date.now(), agentId, requestHash, status: pocStatus, level: pocLevel,
      error: null, metadata: { cloudProvider, region, score },
    });

    return result;
  }

  async getAgentStatus(agentId: bigint): Promise<AgentPoCStatus> {
    const result = await this.publicClient.readContract({
      address: this.config.validatorAddress, abi: POC_VALIDATOR_ABI,
      functionName: 'getAgentStatus', args: [agentId],
    });

    const [verified, level, hardwareIdHash, expiresAt] = result;

    return {
      agentId, verified,
      level: level > 0 ? (level as PoCVerificationLevel) : null,
      platform: null,
      hardwareIdHash: hardwareIdHash as Hex,
      lastVerifiedAt: verified ? Number(expiresAt) - 7 * 24 * 60 * 60 : null,
      score: verified ? POC_SCORES.VERIFIED : 0,
      requestHash: null,
    };
  }

  async needsReverification(agentId: bigint): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.config.validatorAddress, abi: POC_VALIDATOR_ABI,
      functionName: 'needsReverification', args: [agentId],
    });
  }

  async revokeHardware(hardwareIdHash: Hex, reason: string): Promise<Hex> {
    const { request } = await this.publicClient.simulateContract({
      address: this.config.validatorAddress, abi: POC_VALIDATOR_ABI,
      functionName: 'revokeHardware', args: [hardwareIdHash as `0x${string}`, reason],
      account: this.account,
    });

    const hash = await this.walletClient.writeContract(request);

    this.emitEvent({
      type: 'revocation', timestamp: Date.now(), agentId: null, requestHash: null,
      status: 'revoked', level: null, error: null, metadata: { hardwareIdHash, reason },
    });

    return hash;
  }

  async isAgentVerified(agentId: bigint): Promise<boolean> {
    const status = await this.getAgentStatus(agentId);
    return status.verified;
  }

  async getVerificationSummary(agentId: bigint): Promise<{ count: number; averageScore: number }> {
    const status = await this.getAgentStatus(agentId);
    return { count: status.verified ? 1 : 0, averageScore: status.score };
  }

  addEventListener(listener: PoCEventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  private emitEvent(event: PoCVerificationEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  private async checkAgentExists(agentId: bigint): Promise<boolean> {
    return this.publicClient.readContract({
      address: this.config.identityRegistryAddress, abi: IDENTITY_REGISTRY_ABI,
      functionName: 'agentExists', args: [agentId],
    });
  }

  private computeRequestHash(request: PoCVerificationRequest): Hex {
    return keccak256(toBytes(JSON.stringify({
      agentId: request.agentId.toString(), quote: request.quote,
      nonce: request.nonce, timestamp: request.timestamp, requester: request.requester,
    })));
  }

  private async submitVerificationOnChain(result: PoCVerificationResult, quote: TEEQuote): Promise<Hex> {
    const nonce = await this.publicClient.readContract({
      address: this.config.validatorAddress, abi: POC_VALIDATOR_ABI,
      functionName: 'getNonce', args: [this.account.address],
    });

    if (!result.cloudProvider || !result.region) {
      throw new PoCError(
        PoCErrorCode.HARDWARE_NOT_REGISTERED,
        'Cloud provider and region must come from PoC registry',
        { hardwareIdHash: result.hardwareIdHash },
      );
    }

    const chainId = await this.publicClient.getChainId();
    const messageData = encodeAbiParameters(
      parseAbiParameters('bytes32, uint256, bytes32, uint8, string, string, bytes32, uint256, address, uint256'),
      [
        result.requestHash as `0x${string}`, result.agentId, result.hardwareIdHash as `0x${string}`,
        result.level ?? 1, result.cloudProvider, result.region, result.evidenceHash as `0x${string}`,
        BigInt(chainId), this.config.validatorAddress, nonce,
      ],
    );

    const signature = await this.account.signMessage({ message: { raw: keccak256(messageData) } });
    result.oracleSignature = signature;

    const { request } = await this.publicClient.simulateContract({
      address: this.config.validatorAddress, abi: POC_VALIDATOR_ABI,
      functionName: 'submitVerification',
      args: [
        result.requestHash as `0x${string}`, result.agentId, result.hardwareIdHash as `0x${string}`,
        result.level ?? 1, result.cloudProvider, result.region, result.evidenceHash as `0x${string}`, signature,
      ],
      account: this.account,
    });

    return this.walletClient.writeContract(request);
  }

  static fromEnv(): PoCVerifier {
    const network = process.env.NETWORK ?? 'testnet';
    const chain = network === 'mainnet' ? base : baseSepolia;
    const rpcUrl = process.env.RPC_URL ?? (network === 'mainnet' ? 'https://mainnet.base.org' : 'https://sepolia.base.org');

    const signerKey = process.env.POC_SIGNER_KEY;
    if (!signerKey) throw new Error('POC_SIGNER_KEY required');

    const validatorAddress = process.env.POC_VALIDATOR_ADDRESS;
    if (!validatorAddress) throw new Error('POC_VALIDATOR_ADDRESS required');

    const identityRegistryAddress = process.env.IDENTITY_REGISTRY_ADDRESS;
    if (!identityRegistryAddress) throw new Error('IDENTITY_REGISTRY_ADDRESS required');

    const hardwareIdSalt = process.env.HARDWARE_ID_SALT ?? keccak256(toBytes('jeju-poc-salt'));

    return new PoCVerifier({
      chain, rpcUrl,
      signerKey: signerKey as Hex,
      validatorAddress: validatorAddress as Address,
      identityRegistryAddress: identityRegistryAddress as Address,
      registryEndpoint: process.env.POC_REGISTRY_ENDPOINT,
      hardwareIdSalt: hardwareIdSalt as Hex,
    });
  }
}

export function isQuoteFresh(quote: TEEQuote, maxAgeMs = 24 * 60 * 60 * 1000): boolean {
  if (!quote.timestamp) return true;
  return Date.now() - quote.timestamp < maxAgeMs;
}

export function getPlatformTag(platform: TEEPlatform): Hex {
  switch (platform) {
    case 'intel_tdx': return keccak256(toBytes(POC_TAGS.HARDWARE_INTEL_TDX));
    case 'intel_sgx': return keccak256(toBytes(POC_TAGS.HARDWARE_INTEL_SGX));
    case 'amd_sev': return keccak256(toBytes(POC_TAGS.HARDWARE_AMD_SEV));
  }
}

export function getLevelTag(level: PoCVerificationLevel): Hex {
  switch (level) {
    case 1: return keccak256(toBytes(POC_TAGS.LEVEL_1));
    case 2: return keccak256(toBytes(POC_TAGS.LEVEL_2));
    case 3: return keccak256(toBytes(POC_TAGS.LEVEL_3));
  }
}
