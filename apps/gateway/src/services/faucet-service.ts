import { createPublicClient, createWalletClient, http, type Address, parseEther, formatEther, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { IERC20_ABI } from '../lib/contracts.js';
import { CHAIN_INFO } from '../config/oif.js';
import { jejuTestnet, getRpcUrl } from '../lib/chains.js';

const JEJU_CHAIN_ID = 420690 as const;
const JEJU_RPC = getRpcUrl(JEJU_CHAIN_ID);

const FAUCET_CONFIG = {
  cooldownMs: 12 * 60 * 60 * 1000,
  amountPerClaim: parseEther('100'),
  jejuTokenAddress: (process.env.VITE_JEJU_TOKEN_ADDRESS || process.env.JEJU_TOKEN_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
  identityRegistryAddress: (process.env.VITE_IDENTITY_REGISTRY_ADDRESS || process.env.IDENTITY_REGISTRY_ADDRESS || '0x0000000000000000000000000000000000000000') as Address,
  faucetPrivateKey: process.env.FAUCET_PRIVATE_KEY,
};

const IDENTITY_REGISTRY_ABI = [
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'owner', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const;

const claimHistory = new Map<string, number>();

const publicClient = createPublicClient({ chain: jejuTestnet, transport: http(JEJU_RPC) });

function getWalletClient() {
  if (!FAUCET_CONFIG.faucetPrivateKey) throw new Error('FAUCET_PRIVATE_KEY not configured');
  const account = privateKeyToAccount(FAUCET_CONFIG.faucetPrivateKey as `0x${string}`);
  return createWalletClient({ account, chain: jejuTestnet, transport: http(JEJU_RPC) });
}

export interface FaucetStatus {
  eligible: boolean;
  isRegistered: boolean;
  cooldownRemaining: number;
  nextClaimAt: number | null;
  amountPerClaim: string;
  faucetBalance: string;
}

export interface FaucetClaimResult {
  success: boolean;
  txHash?: string;
  amount?: string;
  error?: string;
  cooldownRemaining?: number;
}

export interface FaucetInfo {
  name: string;
  description: string;
  tokenSymbol: string;
  amountPerClaim: string;
  cooldownHours: number;
  requirements: string[];
  chainId: number;
  chainName: string;
}

async function isRegisteredAgent(address: Address): Promise<boolean> {
  if (FAUCET_CONFIG.identityRegistryAddress === '0x0000000000000000000000000000000000000000') {
    return process.env.NODE_ENV === 'test' || process.env.FAUCET_SKIP_REGISTRY === 'true';
  }
  const balance = await publicClient.readContract({
    address: FAUCET_CONFIG.identityRegistryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'balanceOf',
    args: [address],
  });
  return balance > 0n;
}

function getCooldownRemaining(address: string): number {
  const lastClaim = claimHistory.get(address.toLowerCase());
  if (!lastClaim) return 0;
  return Math.max(0, FAUCET_CONFIG.cooldownMs - (Date.now() - lastClaim));
}

async function getFaucetBalance(): Promise<bigint> {
  if (FAUCET_CONFIG.jejuTokenAddress === '0x0000000000000000000000000000000000000000' || !FAUCET_CONFIG.faucetPrivateKey) {
    return 0n;
  }
  const account = privateKeyToAccount(FAUCET_CONFIG.faucetPrivateKey as `0x${string}`);
  return await publicClient.readContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: IERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
}

export async function getFaucetStatus(address: Address): Promise<FaucetStatus> {
  if (!isAddress(address)) {
    return { eligible: false, isRegistered: false, cooldownRemaining: 0, nextClaimAt: null, amountPerClaim: formatEther(FAUCET_CONFIG.amountPerClaim), faucetBalance: '0' };
  }

  const [isRegistered, cooldownRemaining, faucetBalance] = await Promise.all([
    isRegisteredAgent(address),
    getCooldownRemaining(address),
    getFaucetBalance(),
  ]);

  const lastClaim = claimHistory.get(address.toLowerCase());
  return {
    eligible: isRegistered && cooldownRemaining === 0 && faucetBalance >= FAUCET_CONFIG.amountPerClaim,
    isRegistered,
    cooldownRemaining,
    nextClaimAt: lastClaim ? lastClaim + FAUCET_CONFIG.cooldownMs : null,
    amountPerClaim: formatEther(FAUCET_CONFIG.amountPerClaim),
    faucetBalance: formatEther(faucetBalance),
  };
}

export async function claimFromFaucet(address: Address): Promise<FaucetClaimResult> {
  if (!isAddress(address)) return { success: false, error: 'Invalid wallet address format' };

  const isRegistered = await isRegisteredAgent(address);
  if (!isRegistered) return { success: false, error: 'Address must be registered in the ERC-8004 Identity Registry' };

  const cooldownRemaining = getCooldownRemaining(address);
  if (cooldownRemaining > 0) return { success: false, error: 'Faucet cooldown active', cooldownRemaining };

  const faucetBalance = await getFaucetBalance();
  if (faucetBalance < FAUCET_CONFIG.amountPerClaim) return { success: false, error: 'Faucet is empty, please try again later' };

  if (FAUCET_CONFIG.jejuTokenAddress === '0x0000000000000000000000000000000000000000') {
    return { success: false, error: 'JEJU token not configured' };
  }

  const walletClient = getWalletClient();
  const hash = await walletClient.writeContract({
    address: FAUCET_CONFIG.jejuTokenAddress,
    abi: IERC20_ABI,
    functionName: 'transfer',
    args: [address, FAUCET_CONFIG.amountPerClaim],
  });

  claimHistory.set(address.toLowerCase(), Date.now());
  return { success: true, txHash: hash, amount: formatEther(FAUCET_CONFIG.amountPerClaim) };
}

export function getFaucetInfo(): FaucetInfo {
  return {
    name: 'Jeju Testnet Faucet',
    description: 'Get JEJU tokens for testing. Requires ERC-8004 registry registration.',
    tokenSymbol: 'JEJU',
    amountPerClaim: formatEther(FAUCET_CONFIG.amountPerClaim),
    cooldownHours: FAUCET_CONFIG.cooldownMs / (60 * 60 * 1000),
    requirements: ['Wallet must be registered in ERC-8004 Identity Registry', '12 hour cooldown between claims'],
    chainId: JEJU_CHAIN_ID,
    chainName: CHAIN_INFO[JEJU_CHAIN_ID].name,
  };
}

export const faucetService = { getFaucetStatus, claimFromFaucet, getFaucetInfo };
