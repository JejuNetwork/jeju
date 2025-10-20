/**
 * Multicoin Paymaster Integration for Crucible
 * Supports gas payments for security testing agents
 */

import { Address, createPublicClient, http, parseAbi, encodePacked } from 'viem';

// Use Jeju L3 chain (localnet for testing)
const JEJU_CHAIN = {
  id: 1337,
  name: 'Jeju L3',
  network: 'jeju',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [process.env.JEJU_L2_RPC_HOST || 'http://127.0.0.1:9545'] },
    public: { http: [process.env.JEJU_L2_RPC_HOST || 'http://127.0.0.1:9545'] },
  },
};

const PAYMASTER_FACTORY_ABI = parseAbi([
  'function getAllPaymasters() external view returns (address[] memory)',
  'function getPaymasterByToken(address token) external view returns (address)',
  'function paymasterStake(address paymaster) external view returns (uint256)',
]);

const PAYMASTER_ABI = parseAbi([
  'function token() external view returns (address)',
  'function getQuote(uint256 ethAmount) external view returns (uint256)',
]);

const PAYMASTER_FACTORY_ADDRESS = (process.env.PAYMASTER_FACTORY_ADDRESS ||
  '0x0000000000000000000000000000000000000000') as Address;

const MIN_STAKE_THRESHOLD = BigInt(10) * BigInt(10 ** 18);

export interface PaymasterInfo {
  address: Address;
  token: Address;
  stake: bigint;
  available: boolean;
}

export interface PaymasterQuote {
  paymaster: Address;
  token: Address;
  ethAmount: bigint;
  tokenAmount: bigint;
}

function getPublicClient() {
  return createPublicClient({
    chain: JEJU_CHAIN,
    transport: http(),
  });
}

export async function getAvailablePaymasters(minStake: bigint = MIN_STAKE_THRESHOLD): Promise<PaymasterInfo[]> {
  if (PAYMASTER_FACTORY_ADDRESS === '0x0000000000000000000000000000000000000000') {
    console.warn('[Paymaster] Factory not configured');
    return [];
  }

  try {
    const client = getPublicClient();
    
    const paymasters = await client.readContract({
      address: PAYMASTER_FACTORY_ADDRESS,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'getAllPaymasters',
    }) as Address[];

    const paymasterDetails = await Promise.all(
      paymasters.map(async (paymasterAddr) => {
        try {
          const [token, stake] = await Promise.all([
            client.readContract({
              address: paymasterAddr,
              abi: PAYMASTER_ABI,
              functionName: 'token',
            }),
            client.readContract({
              address: PAYMASTER_FACTORY_ADDRESS,
              abi: PAYMASTER_FACTORY_ABI,
              functionName: 'paymasterStake',
              args: [paymasterAddr],
            }),
          ]);

          return {
            address: paymasterAddr,
            token: token as Address,
            stake: stake as bigint,
            available: (stake as bigint) >= minStake,
          };
        } catch (error) {
          console.error(`[Paymaster] Error fetching details for ${paymasterAddr}:`, error);
          return null;
        }
      })
    );

    return paymasterDetails.filter((pm): pm is PaymasterInfo => pm !== null && pm.available);
  } catch (error) {
    console.error('[Paymaster] Error fetching paymasters:', error);
    return [];
  }
}

export async function getPaymasterForToken(tokenAddress: Address): Promise<Address | null> {
  if (PAYMASTER_FACTORY_ADDRESS === '0x0000000000000000000000000000000000000000') {
    return null;
  }

  try {
    const client = getPublicClient();
    
    const paymaster = await client.readContract({
      address: PAYMASTER_FACTORY_ADDRESS,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'getPaymasterByToken',
      args: [tokenAddress],
    }) as Address;

    const stake = await client.readContract({
      address: PAYMASTER_FACTORY_ADDRESS,
      abi: PAYMASTER_FACTORY_ABI,
      functionName: 'paymasterStake',
      args: [paymaster],
    }) as bigint;

    if (stake >= MIN_STAKE_THRESHOLD) {
      return paymaster;
    }

    return null;
  } catch (error) {
    console.error('[Paymaster] Error getting paymaster:', error);
    return null;
  }
}

export async function getPaymasterQuote(
  paymasterAddress: Address,
  ethAmount: bigint
): Promise<PaymasterQuote | null> {
  try {
    const client = getPublicClient();
    
    const [token, tokenAmount] = await Promise.all([
      client.readContract({
        address: paymasterAddress,
        abi: PAYMASTER_ABI,
        functionName: 'token',
      }),
      client.readContract({
        address: paymasterAddress,
        abi: PAYMASTER_ABI,
        functionName: 'getQuote',
        args: [ethAmount],
      }),
    ]);

    return {
      paymaster: paymasterAddress,
      token: token as Address,
      ethAmount,
      tokenAmount: tokenAmount as bigint,
    };
  } catch (error) {
    console.error('[Paymaster] Error getting quote:', error);
    return null;
  }
}

export function generatePaymasterData(
  paymasterAddress: Address,
  verificationGasLimit: bigint = BigInt(100000),
  postOpGasLimit: bigint = BigInt(50000)
): `0x${string}` {
  return encodePacked(
    ['address', 'uint128', 'uint128'],
    [paymasterAddress, BigInt(verificationGasLimit), BigInt(postOpGasLimit)]
  );
}

// Alternative signature for compatibility with existing code
export function preparePaymasterData(
  paymasterAddress: Address,
  tokenAddress: Address,
  verificationGasLimit: bigint = BigInt(100000),
  postOpGasLimit: bigint = BigInt(50000)
): { paymaster: Address; paymasterData: `0x${string}` } {
  const data = encodePacked(
    ['address', 'uint128', 'uint128'],
    [paymasterAddress, BigInt(verificationGasLimit), BigInt(postOpGasLimit)]
  );
  
  return {
    paymaster: paymasterAddress,
    paymasterData: data,
  };
}

export async function estimateTokenCost(
  tokenAddress: Address,
  gasLimit: bigint,
  gasPrice: bigint
): Promise<bigint | null> {
  const paymaster = await getPaymasterForToken(tokenAddress);
  if (!paymaster) {
    return null;
  }

  const ethCost = gasLimit * gasPrice;
  const quote = await getPaymasterQuote(paymaster, ethCost);
  
  return quote?.tokenAmount || null;
}

export const paymasterService = {
  getAvailablePaymasters,
  getPaymasterForToken,
  getPaymasterQuote,
  generatePaymasterData,
  estimateTokenCost,
};
