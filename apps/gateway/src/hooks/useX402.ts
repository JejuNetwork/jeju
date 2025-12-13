import { useState, useCallback, useEffect } from 'react';
import { useAccount, useWalletClient, usePublicClient, useChainId } from 'wagmi';
import { Address, Hex } from 'viem';
import { CONTRACTS } from '../config';
import { ZERO_ADDRESS } from '../lib/contracts';

interface PaymentState {
  status: 'idle' | 'signing' | 'approving' | 'settling' | 'success' | 'error';
  error: string | null;
  txHash: Hex | null;
  paymentId: Hex | null;
}

interface FacilitatorInfo {
  address: Address;
  protocolFeeBps: number;
  totalSettlements: bigint;
  isAvailable: boolean;
}

interface UseX402Return {
  facilitator: FacilitatorInfo | null;
  paymentState: PaymentState;
  usdcBalance: bigint;
  usdcSymbol: string;
  pay: (recipient: Address, amount: bigint, resource: string) => Promise<Hex | null>;
  reset: () => void;
  isReady: boolean;
}

const X402_FACILITATOR_ABI = [
  {
    type: 'function',
    name: 'settle',
    inputs: [
      { name: 'payer', type: 'address' },
      { name: 'recipient', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'resource', type: 'string' },
      { name: 'nonce', type: 'string' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: 'paymentId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getStats',
    inputs: [],
    outputs: [
      { name: 'settlements', type: 'uint256' },
      { name: 'volumeUSD', type: 'uint256' },
      { name: 'feeBps', type: 'uint256' },
      { name: 'feeAddr', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'supportedTokens',
    inputs: [{ name: 'token', type: 'address' }],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
] as const;

const ERC20_ABI = [
  {
    type: 'function',
    name: 'approve',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'allowance',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'symbol',
    inputs: [],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const;

const CHAIN_CONFIG: Record<number, { facilitator: Address; usdc: Address }> = {
  420691: {
    facilitator: CONTRACTS.x402Facilitator,
    usdc: CONTRACTS.usdc || '0x0165878A594ca255338adfa4d48449f69242Eb8F' as Address,
  },
  420690: {
    facilitator: ZERO_ADDRESS as Address,
    usdc: ZERO_ADDRESS as Address,
  },
  84532: {
    facilitator: ZERO_ADDRESS as Address,
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as Address,
  },
};

const PAYMENT_TYPES = {
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
} as const;

export function useX402(): UseX402Return {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  const [facilitator, setFacilitator] = useState<FacilitatorInfo | null>(null);
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n);
  const [usdcSymbol, setUsdcSymbol] = useState<string>('USDC');
  const [paymentState, setPaymentState] = useState<PaymentState>({
    status: 'idle',
    error: null,
    txHash: null,
    paymentId: null,
  });

  const config = CHAIN_CONFIG[chainId] || CHAIN_CONFIG[420691];

  // Load facilitator info
  useEffect(() => {
    if (!publicClient || config.facilitator === ZERO_ADDRESS) {
      setFacilitator(null);
      return;
    }

    const loadFacilitator = async () => {
      const stats = await publicClient.readContract({
        address: config.facilitator,
        abi: X402_FACILITATOR_ABI,
        functionName: 'getStats',
      });

      const [settlements, , feeBps] = stats as [bigint, bigint, bigint, Address];

      setFacilitator({
        address: config.facilitator,
        protocolFeeBps: Number(feeBps),
        totalSettlements: settlements,
        isAvailable: true,
      });
    };

    loadFacilitator().catch(() => setFacilitator(null));
  }, [publicClient, config.facilitator, chainId]);

  // Load USDC balance
  useEffect(() => {
    if (!publicClient || !address || config.usdc === ZERO_ADDRESS) {
      setUsdcBalance(0n);
      return;
    }

    const loadBalance = async () => {
      const [balance, symbol] = await Promise.all([
        publicClient.readContract({
          address: config.usdc,
          abi: ERC20_ABI,
          functionName: 'balanceOf',
          args: [address],
        }) as Promise<bigint>,
        publicClient.readContract({
          address: config.usdc,
          abi: ERC20_ABI,
          functionName: 'symbol',
        }) as Promise<string>,
      ]);

      setUsdcBalance(balance);
      setUsdcSymbol(symbol);
    };

    loadBalance().catch(() => setUsdcBalance(0n));
  }, [publicClient, address, config.usdc, chainId]);

  // Generate nonce
  const generateNonce = useCallback((): string => {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
  }, []);

  // Make payment
  const pay = useCallback(async (
    recipient: Address,
    amount: bigint,
    resource: string
  ): Promise<Hex | null> => {
    if (!walletClient || !publicClient || !address || !facilitator) {
      setPaymentState({
        status: 'error',
        error: 'Wallet not connected or facilitator not available',
        txHash: null,
        paymentId: null,
      });
      return null;
    }

    setPaymentState({ status: 'signing', error: null, txHash: null, paymentId: null });

    const nonce = generateNonce();
    const timestamp = Math.floor(Date.now() / 1000);

    // Sign payment
    const domain = {
      name: 'x402 Payment Protocol',
      version: '1',
      chainId,
      verifyingContract: ZERO_ADDRESS as Address,
    };

    const message = {
      scheme: 'exact',
      network: 'jeju',
      asset: config.usdc,
      payTo: recipient,
      amount,
      resource,
      nonce,
      timestamp: BigInt(timestamp),
    };

    let signature: Hex;
    try {
      signature = await walletClient.signTypedData({
        domain,
        types: PAYMENT_TYPES,
        primaryType: 'Payment',
        message,
      });
    } catch {
      setPaymentState({
        status: 'error',
        error: 'User rejected signature',
        txHash: null,
        paymentId: null,
      });
      return null;
    }

    // Check and set approval
    setPaymentState({ status: 'approving', error: null, txHash: null, paymentId: null });

    const allowance = await publicClient.readContract({
      address: config.usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [address, facilitator.address],
    }) as bigint;

    if (allowance < amount) {
      try {
        const approveHash = await walletClient.writeContract({
          address: config.usdc,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [facilitator.address, amount],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveHash });
      } catch {
        setPaymentState({
          status: 'error',
          error: 'Approval failed',
          txHash: null,
          paymentId: null,
        });
        return null;
      }
    }

    // Submit settlement
    setPaymentState({ status: 'settling', error: null, txHash: null, paymentId: null });

    try {
      const settleHash = await walletClient.writeContract({
        address: facilitator.address,
        abi: X402_FACILITATOR_ABI,
        functionName: 'settle',
        args: [
          address,
          recipient,
          config.usdc,
          amount,
          resource,
          nonce,
          BigInt(timestamp),
          signature,
        ],
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: settleHash });

      setPaymentState({
        status: 'success',
        error: null,
        txHash: settleHash,
        paymentId: (receipt.logs[0]?.topics[1] || '0x') as Hex,
      });

      return settleHash;
    } catch (e) {
      setPaymentState({
        status: 'error',
        error: e instanceof Error ? e.message : 'Settlement failed',
        txHash: null,
        paymentId: null,
      });
      return null;
    }
  }, [walletClient, publicClient, address, facilitator, chainId, config.usdc, generateNonce]);

  const reset = useCallback(() => {
    setPaymentState({
      status: 'idle',
      error: null,
      txHash: null,
      paymentId: null,
    });
  }, []);

  return {
    facilitator,
    paymentState,
    usdcBalance,
    usdcSymbol,
    pay,
    reset,
    isReady: isConnected && !!facilitator?.isAvailable,
  };
}

export default useX402;


