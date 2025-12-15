/**
 * Moderation SDK for network Compute Marketplace
 *
 * Provides interfaces for:
 * - Staking as user/provider/guardian (ComputeStaking)
 * - Checking ban status (BanManager)
 *
 * NOTE: ReportingSystem and LabelManager contracts are planned but not yet deployed.
 * This SDK only includes functionality for contracts that actually exist.
 */

import {
  Contract,
  type ContractTransactionResponse,
  JsonRpcProvider,
  Wallet,
} from 'ethers';

// ============ Types ============

export enum StakeType {
  USER = 0,
  PROVIDER = 1,
  GUARDIAN = 2,
}

export interface Stake {
  amount: bigint;
  stakeType: StakeType;
  stakedAt: number;
  lockedUntil: number;
  slashed: boolean;
}

export interface BanRecord {
  isBanned: boolean;
  bannedAt: number;
  reason: string;
  proposalId: string;
}

export interface ModerationSDKConfig {
  rpcUrl: string;
  signer?: Wallet;
  contracts: {
    staking: string;
    banManager: string;
  };
}

// ============ ABIs ============

const STAKING_ABI = [
  'function stakeAsUser() payable',
  'function stakeAsProvider() payable',
  'function stakeAsGuardian() payable',
  'function addStake() payable',
  'function unstake(uint256 amount)',
  'function getStake(address account) view returns (tuple(uint256 amount, uint8 stakeType, uint256 stakedAt, uint256 lockedUntil, bool slashed))',
  'function getStakeAmount(address account) view returns (uint256)',
  'function isStaked(address account) view returns (bool)',
  'function isProvider(address account) view returns (bool)',
  'function isGuardian(address account) view returns (bool)',
  'function getGuardians() view returns (address[])',
  'function getGuardianCount() view returns (uint256)',
  'function MIN_USER_STAKE() view returns (uint256)',
  'function MIN_PROVIDER_STAKE() view returns (uint256)',
  'function MIN_GUARDIAN_STAKE() view returns (uint256)',
  'function version() view returns (string)',
];

const BAN_MANAGER_ABI = [
  'function isAccessAllowed(uint256 agentId, bytes32 appId) view returns (bool)',
  'function isNetworkBanned(uint256 agentId) view returns (bool)',
  'function isAppBanned(uint256 agentId, bytes32 appId) view returns (bool)',
  'function getNetworkBan(uint256 agentId) view returns (tuple(bool isBanned, uint256 bannedAt, string reason, bytes32 proposalId))',
  'function getAppBan(uint256 agentId, bytes32 appId) view returns (tuple(bool isBanned, uint256 bannedAt, string reason, bytes32 proposalId))',
  'function version() view returns (string)',
];

// ============ Helpers ============

async function callContract<T>(
  contract: Contract,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const fn = contract.getFunction(method);
  return fn(...args) as Promise<T>;
}

async function sendContract(
  contract: Contract,
  method: string,
  ...args: unknown[]
): Promise<ContractTransactionResponse> {
  const fn = contract.getFunction(method);
  return fn(...args) as Promise<ContractTransactionResponse>;
}

// ============ SDK ============

/**
 * Moderation SDK for network Compute Marketplace
 *
 * Only includes functionality for deployed contracts:
 * - ComputeStaking: User/Provider/Guardian staking
 * - BanManager: Network and app-level bans
 */
export class ModerationSDK {
  private rpcProvider: JsonRpcProvider;
  private signer: Wallet | null;
  private staking: Contract;
  private banManager: Contract;

  constructor(config: ModerationSDKConfig) {
    this.rpcProvider = new JsonRpcProvider(config.rpcUrl);
    this.signer = config.signer
      ? config.signer.connect(this.rpcProvider)
      : null;

    const signerOrProvider = this.signer || this.rpcProvider;

    this.staking = new Contract(
      config.contracts.staking,
      STAKING_ABI,
      signerOrProvider
    );
    this.banManager = new Contract(
      config.contracts.banManager,
      BAN_MANAGER_ABI,
      signerOrProvider
    );
  }

  // ============ Staking Functions ============

  async stakeAsUser(amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.staking, 'stakeAsUser', {
      value: amount,
    });
    await tx.wait();
  }

  async stakeAsProvider(amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.staking, 'stakeAsProvider', {
      value: amount,
    });
    await tx.wait();
  }

  async stakeAsGuardian(amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.staking, 'stakeAsGuardian', {
      value: amount,
    });
    await tx.wait();
  }

  async addStake(amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.staking, 'addStake', { value: amount });
    await tx.wait();
  }

  async unstake(amount: bigint): Promise<void> {
    this.requireSigner();
    const tx = await sendContract(this.staking, 'unstake', amount);
    await tx.wait();
  }

  async getStake(address: string): Promise<Stake> {
    const result = await callContract<{
      amount: bigint;
      stakeType: number;
      stakedAt: bigint;
      lockedUntil: bigint;
      slashed: boolean;
    }>(this.staking, 'getStake', address);

    return {
      amount: result.amount,
      stakeType: result.stakeType as StakeType,
      stakedAt: Number(result.stakedAt),
      lockedUntil: Number(result.lockedUntil),
      slashed: result.slashed,
    };
  }

  async isStaked(address: string): Promise<boolean> {
    return callContract<boolean>(this.staking, 'isStaked', address);
  }

  async isProvider(address: string): Promise<boolean> {
    return callContract<boolean>(this.staking, 'isProvider', address);
  }

  async isGuardian(address: string): Promise<boolean> {
    return callContract<boolean>(this.staking, 'isGuardian', address);
  }

  async getGuardians(): Promise<string[]> {
    return callContract<string[]>(this.staking, 'getGuardians');
  }

  async getMinStakes(): Promise<{
    user: bigint;
    provider: bigint;
    guardian: bigint;
  }> {
    const [user, provider, guardian] = await Promise.all([
      callContract<bigint>(this.staking, 'MIN_USER_STAKE'),
      callContract<bigint>(this.staking, 'MIN_PROVIDER_STAKE'),
      callContract<bigint>(this.staking, 'MIN_GUARDIAN_STAKE'),
    ]);
    return { user, provider, guardian };
  }

  // ============ Ban Functions ============

  async isNetworkBanned(agentId: bigint): Promise<boolean> {
    return callContract<boolean>(this.banManager, 'isNetworkBanned', agentId);
  }

  async isAppBanned(agentId: bigint, appId: string): Promise<boolean> {
    return callContract<boolean>(
      this.banManager,
      'isAppBanned',
      agentId,
      appId
    );
  }

  async isAccessAllowed(agentId: bigint, appId: string): Promise<boolean> {
    return callContract<boolean>(
      this.banManager,
      'isAccessAllowed',
      agentId,
      appId
    );
  }

  async getNetworkBan(agentId: bigint): Promise<BanRecord> {
    const result = await callContract<{
      isBanned: boolean;
      bannedAt: bigint;
      reason: string;
      proposalId: string;
    }>(this.banManager, 'getNetworkBan', agentId);

    return {
      isBanned: result.isBanned,
      bannedAt: Number(result.bannedAt),
      reason: result.reason,
      proposalId: result.proposalId,
    };
  }

  // ============ Utility Functions ============

  private requireSigner(): Wallet {
    if (!this.signer) {
      throw new Error('Signer required for this operation');
    }
    return this.signer;
  }

  getAddress(): string | null {
    return this.signer?.address || null;
  }
}

/**
 * Create ModerationSDK from config
 */
export function createModerationSDK(config: {
  rpcUrl: string;
  privateKey?: string;
  stakingAddress: string;
  banManagerAddress: string;
}): ModerationSDK {
  return new ModerationSDK({
    rpcUrl: config.rpcUrl,
    signer: config.privateKey ? new Wallet(config.privateKey) : undefined,
    contracts: {
      staking: config.stakingAddress,
      banManager: config.banManagerAddress,
    },
  });
}
