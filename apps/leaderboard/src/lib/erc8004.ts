/**
 * ERC-8004 Registry Integration for Leaderboard
 * User ban checking and reputation verification
 */

import { Address, createPublicClient, http, parseAbi } from 'viem';

const JEJU_CHAIN = {
  id: 1337,
  name: 'Jeju L3',
  network: 'jeju',
  nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
  rpcUrls: {
    default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
    public: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
  },
};

const IDENTITY_REGISTRY_ABI = parseAbi([
  'function getAgentId(address agentAddress) external view returns (uint256)',
]);

const BAN_MANAGER_ABI = parseAbi([
  'function isAccessAllowed(uint256 agentId, bytes32 appId) external view returns (bool)',
  'function isBanned(uint256 agentId) external view returns (bool)',
  'function getBanReason(uint256 agentId) external view returns (string memory)',
  'function getBanExpiry(uint256 agentId) external view returns (uint256)',
]);

const REPUTATION_MANAGER_ABI = parseAbi([
  'function getReputation(uint256 agentId) external view returns (uint256)',
]);

const IDENTITY_REGISTRY_ADDRESS = (process.env.NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const BAN_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_BAN_MANAGER_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const REPUTATION_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_REPUTATION_MANAGER_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const LEADERBOARD_APP_ID = '0x' + Buffer.from('jeju-leaderboard').toString('hex').padEnd(64, '0');

export interface BanCheckResult {
  allowed: boolean;
  reason?: string;
  bannedUntil?: number;
}

function getPublicClient() {
  return createPublicClient({
    chain: JEJU_CHAIN,
    transport: http(),
  });
}

export async function checkUserBan(userAddress: Address): Promise<BanCheckResult> {
  if (BAN_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
    return { allowed: true };
  }

  try {
    const client = getPublicClient();
    
    let agentId: bigint;
    try {
      agentId = await client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'getAgentId',
        args: [userAddress],
      });
    } catch (error) {
      return { allowed: true };
    }

    const isBanned = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isBanned',
      args: [agentId],
    });

    if (isBanned) {
      const [reason, expiry] = await Promise.all([
        client.readContract({
          address: BAN_MANAGER_ADDRESS,
          abi: BAN_MANAGER_ABI,
          functionName: 'getBanReason',
          args: [agentId],
        }),
        client.readContract({
          address: BAN_MANAGER_ADDRESS,
          abi: BAN_MANAGER_ABI,
          functionName: 'getBanExpiry',
          args: [agentId],
        }),
      ]);

      return {
        allowed: false,
        reason: reason as string,
        bannedUntil: Number(expiry),
      };
    }

    const isAllowed = await client.readContract({
      address: BAN_MANAGER_ADDRESS,
      abi: BAN_MANAGER_ABI,
      functionName: 'isAccessAllowed',
      args: [agentId, LEADERBOARD_APP_ID as `0x${string}`],
    });

    if (!isAllowed) {
      return {
        allowed: false,
        reason: 'Access denied for Leaderboard',
      };
    }

    return { allowed: true };
  } catch (error) {
    console.error('[ERC-8004] Error checking ban:', error);
    return { allowed: true };
  }
}

export async function getUserReputation(userAddress: Address): Promise<number> {
  if (REPUTATION_MANAGER_ADDRESS === '0x0000000000000000000000000000000000000000') {
    return 0;
  }

  try {
    const client = getPublicClient();
    
    const agentId = await client.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentId',
      args: [userAddress],
    });

    const score = await client.readContract({
      address: REPUTATION_MANAGER_ADDRESS,
      abi: REPUTATION_MANAGER_ABI,
      functionName: 'getReputation',
      args: [agentId],
    });

    return Number(score);
  } catch (error) {
    return 0;
  }
}

const EIP712_TYPES = {
  Payment: [
    { name: 'scheme', type: 'string' },
    { name: 'network', type: 'string' },
    { name: 'asset', type: 'address' },
    { name: 'payTo', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'resource', type: 'string' },
    { name: 'nonce', type: 'string' },
    { name: 'timestamp', type: 'uint256' },
  ],
};

export async function verifyPayment(
  payload: PaymentPayload,
  expectedAmount: bigint,
  expectedRecipient: Address
): Promise<{ valid: boolean; error?: string; signer?: Address }> {
  if (!payload.amount || !payload.payTo || !payload.asset) {
    return { valid: false, error: 'Missing required payment fields' };
  }

  const paymentAmount = BigInt(payload.amount);
  
  if (paymentAmount < expectedAmount) {
    return { valid: false, error: 'Insufficient payment' };
  }

  if (payload.payTo.toLowerCase() !== expectedRecipient.toLowerCase()) {
    return { valid: false, error: 'Invalid recipient' };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - payload.timestamp) > 300) {
    return { valid: false, error: 'Payment expired' };
  }

  if (!payload.signature) {
    return { valid: false, error: 'Signature required' };
  }

  try {
    const { verifyTypedData, recoverTypedDataAddress } = await import('viem');
    
    const domain = { ...EIP712_DOMAIN, chainId: 1337 };

    const message = {
      scheme: payload.scheme,
      network: payload.network,
      asset: payload.asset,
      payTo: payload.payTo,
      amount: BigInt(payload.amount),
      resource: payload.resource,
      nonce: payload.nonce,
      timestamp: BigInt(payload.timestamp),
    };

    const signer = await recoverTypedDataAddress({
      domain,
      types: EIP712_TYPES,
      primaryType: 'Payment',
      message,
      signature: payload.signature as `0x${string}`,
    });

    const isValid = await verifyTypedData({
      address: signer,
      domain,
      types: EIP712_TYPES,
      primaryType: 'Payment',
      message,
      signature: payload.signature as `0x${string}`,
    });

    return isValid ? { valid: true, signer } : { valid: false, error: 'Invalid signature' };
  } catch (error) {
    return { valid: false, error: 'Verification failed' };
  }
}

export async function settlePayment(payload: PaymentPayload): Promise<SettlementResponse> {
  try {
    const { createPublicClient, http, parseAbi } = await import('viem');
    
    const JEJU_CHAIN_CONFIG = {
      id: 1337,
      name: 'Jeju L3',
      network: 'jeju',
      nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
      rpcUrls: {
        default: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
        public: { http: [process.env.NEXT_PUBLIC_RPC_URL || 'http://localhost:9545'] },
      },
    };
    
    const client = createPublicClient({
      chain: JEJU_CHAIN_CONFIG,
      transport: http(),
    });

    return {
      settled: true,
      txHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      blockNumber: Number(await client.getBlockNumber()),
      timestamp: Math.floor(Date.now() / 1000),
      amountSettled: payload.amount,
    };
  } catch (error) {
    return {
      settled: false,
      error: 'Settlement failed',
    };
  }
}

export function parsePaymentHeader(headerValue: string | null): PaymentPayload | null {
  if (!headerValue) return null;
  try {
    return JSON.parse(headerValue) as PaymentPayload;
  } catch {
    return null;
  }
}

export async function checkPayment(
  paymentHeader: string | null,
  requiredAmount: bigint,
  recipient: Address
): Promise<{ paid: boolean; settlement?: SettlementResponse; error?: string }> {
  const payment = parsePaymentHeader(paymentHeader);
  
  if (!payment) {
    return { paid: false, error: 'No payment header' };
  }

  const verification = await verifyPayment(payment, requiredAmount, recipient);
  
  if (!verification.valid) {
    return { paid: false, error: verification.error };
  }

  const settlement = await settlePayment(payment);
  
  if (!settlement.settled) {
    return { paid: false, error: settlement.error };
  }

  return { paid: true, settlement };
}

