/**
 * Payments Module - Paymasters, x402, credits
 */

import { z } from "zod";
import {
  type Address,
  type Hex,
  encodeFunctionData,
  formatEther,
  getContract,
  erc20Abi,
} from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import { requireContract, getServicesConfig } from "../config";

/**
 * Service type schema for credit system
 */
export const ServiceTypeSchema = z.enum(["compute", "storage", "inference"]);
export type ServiceType = z.infer<typeof ServiceTypeSchema>;

export interface PaymasterInfo {
  address: Address;
  token: Address;
  tokenSymbol: string;
  active: boolean;
  entryPointBalance: bigint;
  vaultLiquidity: bigint;
  exchangeRate: bigint;
}

export interface X402PaymentParams {
  resource: string;
  maxAmount: bigint;
  asset: Address;
}

export interface X402Receipt {
  paymentId: string;
  amount: bigint;
  timestamp: number;
  signature: Hex;
}

export interface CreditBalance {
  service: ServiceType;
  balance: bigint;
  balanceFormatted: string;
}

export interface PaymentsModule {
  // Native balance
  getBalance(): Promise<bigint>;

  // Token balances
  getTokenBalance(token: Address): Promise<bigint>;
  getTokenBalances(tokens: Address[]): Promise<Map<Address, bigint>>;

  // Paymasters
  listPaymasters(): Promise<PaymasterInfo[]>;
  getPaymaster(token: Address): Promise<PaymasterInfo | null>;
  deployPaymaster(token: Address, initialDeposit: bigint): Promise<Hex>;

  // LP (Provide liquidity for paymasters)
  provideLiquidity(paymaster: Address, ethAmount: bigint): Promise<Hex>;
  withdrawLiquidity(paymaster: Address, shares: bigint): Promise<Hex>;
  getLPPosition(
    paymaster: Address,
  ): Promise<{ ethShares: bigint; tokenShares: bigint }>;

  // x402 micropayments
  createX402Payment(params: X402PaymentParams): Promise<X402Receipt>;
  verifyX402Receipt(receipt: X402Receipt): Promise<boolean>;

  // Prepaid credits
  getCredits(service: ServiceType): Promise<CreditBalance>;
  depositCredits(service: ServiceType, amount: bigint): Promise<Hex>;
  withdrawCredits(service: ServiceType, amount: bigint): Promise<Hex>;
}

const PAYMASTER_FACTORY_ABI = [
  {
    name: "getPaymaster",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "token", type: "address" }],
    outputs: [{ type: "address" }],
  },
  {
    name: "createPaymasterWithVault",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "token", type: "address" }],
    outputs: [
      { name: "paymaster", type: "address" },
      { name: "vault", type: "address" },
    ],
  },
  {
    name: "getAllPaymasters",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address[]" }, { type: "address[]" }],
  },
] as const;

const LIQUIDITY_VAULT_ABI = [
  {
    name: "depositETH",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "withdrawETH",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "shares", type: "uint256" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "getPosition",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "ethShares", type: "uint256" },
      { name: "tokenShares", type: "uint256" },
    ],
  },
  {
    name: "totalLiquidity",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
] as const;

const CREDIT_MANAGER_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "account", type: "address" },
      { name: "serviceId", type: "uint8" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "deposit",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "serviceId", type: "uint8" }],
    outputs: [],
  },
  {
    name: "withdraw",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "serviceId", type: "uint8" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;

const SERVICE_IDS = {
  compute: 0,
  storage: 1,
  inference: 2,
} as const;

export function createPaymentsModule(
  wallet: JejuWallet,
  network: NetworkType,
): PaymentsModule {
  const paymasterFactoryAddress = requireContract("payments", "paymasterFactory", network);
  const creditManagerAddress = requireContract("payments", "creditManager", network);
  const services = getServicesConfig(network);

  async function getBalance(): Promise<bigint> {
    return wallet.getBalance();
  }

  async function getTokenBalance(token: Address): Promise<bigint> {
    if (token === "0x0000000000000000000000000000000000000000") {
      return wallet.getBalance();
    }

    const tokenContract = getContract({
      address: token,
      abi: erc20Abi,
      client: wallet.publicClient,
    });

    return (await tokenContract.read.balanceOf([wallet.address])) as bigint;
  }

  async function getTokenBalances(
    tokens: Address[],
  ): Promise<Map<Address, bigint>> {
    const balances = new Map<Address, bigint>();

    await Promise.all(
      tokens.map(async (token) => {
        const balance = await getTokenBalance(token);
        balances.set(token, balance);
      }),
    );

    return balances;
  }

  async function listPaymasters(): Promise<PaymasterInfo[]> {
    const response = await fetch(`${services.gateway.api}/paymasters`);
    if (!response.ok) {
      throw new Error(`Failed to list paymasters: ${response.statusText}`);
    }

    const data = (await response.json()) as {
      paymasters: Array<{
        address: Address;
        token: Address;
        tokenSymbol: string;
        active: boolean;
        entryPointBalance: string;
        vaultLiquidity: string;
        exchangeRate: string;
      }>;
    };

    return data.paymasters.map((p) => ({
      ...p,
      entryPointBalance: BigInt(p.entryPointBalance),
      vaultLiquidity: BigInt(p.vaultLiquidity),
      exchangeRate: BigInt(p.exchangeRate),
    }));
  }

  async function getPaymaster(token: Address): Promise<PaymasterInfo | null> {
    const paymasters = await listPaymasters();
    return (
      paymasters.find((p) => p.token.toLowerCase() === token.toLowerCase()) ??
      null
    );
  }

  async function deployPaymaster(
    token: Address,
    initialDeposit: bigint,
  ): Promise<Hex> {
    const data = encodeFunctionData({
      abi: PAYMASTER_FACTORY_ABI,
      functionName: "createPaymasterWithVault",
      args: [token],
    });

    return wallet.sendTransaction({
      to: paymasterFactoryAddress,
      data,
      value: initialDeposit,
    });
  }

  async function provideLiquidity(
    paymaster: Address,
    ethAmount: bigint,
  ): Promise<Hex> {
    const pm = await getPaymaster(paymaster);
    if (!pm) throw new Error("Paymaster not found");

    // Get vault address from API
    const response = await fetch(
      `${services.gateway.api}/paymasters/${paymaster}`,
    );
    if (!response.ok) throw new Error("Failed to get paymaster info");

    const data = (await response.json()) as { vault: Address };

    const txData = encodeFunctionData({
      abi: LIQUIDITY_VAULT_ABI,
      functionName: "depositETH",
      args: [],
    });

    return wallet.sendTransaction({
      to: data.vault,
      data: txData,
      value: ethAmount,
    });
  }

  async function withdrawLiquidity(
    paymaster: Address,
    shares: bigint,
  ): Promise<Hex> {
    const response = await fetch(
      `${services.gateway.api}/paymasters/${paymaster}`,
    );
    if (!response.ok) throw new Error("Failed to get paymaster info");

    const data = (await response.json()) as { vault: Address };

    const txData = encodeFunctionData({
      abi: LIQUIDITY_VAULT_ABI,
      functionName: "withdrawETH",
      args: [shares],
    });

    return wallet.sendTransaction({ to: data.vault, data: txData });
  }

  async function getLPPosition(
    paymaster: Address,
  ): Promise<{ ethShares: bigint; tokenShares: bigint }> {
    const response = await fetch(
      `${services.gateway.api}/paymasters/${paymaster}/position/${wallet.address}`,
    );
    if (!response.ok) return { ethShares: 0n, tokenShares: 0n };

    const data = (await response.json()) as {
      ethShares: string;
      tokenShares: string;
    };
    return {
      ethShares: BigInt(data.ethShares),
      tokenShares: BigInt(data.tokenShares),
    };
  }

  async function createX402Payment(
    params: X402PaymentParams,
  ): Promise<X402Receipt> {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = `x402:${params.resource}:${params.maxAmount.toString()}:${timestamp}`;
    const signature = await wallet.signMessage(message);

    return {
      paymentId: `${wallet.address}-${timestamp}`,
      amount: params.maxAmount,
      timestamp,
      signature,
    };
  }

  async function verifyX402Receipt(receipt: X402Receipt): Promise<boolean> {
    const response = await fetch(`${services.gateway.api}/x402/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(receipt),
    });

    if (!response.ok) return false;

    const data = (await response.json()) as { valid: boolean };
    return data.valid;
  }

  async function getCredits(service: ServiceType): Promise<CreditBalance> {
    if (!creditManagerAddress) {
      throw new Error("Credit manager not configured for this network");
    }

    const creditManager = getContract({
      address: creditManagerAddress,
      abi: CREDIT_MANAGER_ABI,
      client: wallet.publicClient,
    });

    const balance = (await creditManager.read.balanceOf([
      wallet.address,
      SERVICE_IDS[service],
    ])) as bigint;

    return {
      service,
      balance,
      balanceFormatted: formatEther(balance),
    };
  }

  async function depositCredits(
    service: ServiceType,
    amount: bigint,
  ): Promise<Hex> {
    if (!creditManagerAddress) {
      throw new Error("Credit manager not configured for this network");
    }

    const data = encodeFunctionData({
      abi: CREDIT_MANAGER_ABI,
      functionName: "deposit",
      args: [SERVICE_IDS[service]],
    });

    return wallet.sendTransaction({
      to: creditManagerAddress,
      data,
      value: amount,
    });
  }

  async function withdrawCredits(
    service: ServiceType,
    amount: bigint,
  ): Promise<Hex> {
    if (!creditManagerAddress) {
      throw new Error("Credit manager not configured for this network");
    }

    const data = encodeFunctionData({
      abi: CREDIT_MANAGER_ABI,
      functionName: "withdraw",
      args: [SERVICE_IDS[service], amount],
    });

    return wallet.sendTransaction({ to: creditManagerAddress, data });
  }

  return {
    getBalance,
    getTokenBalance,
    getTokenBalances,
    listPaymasters,
    getPaymaster,
    deployPaymaster,
    provideLiquidity,
    withdrawLiquidity,
    getLPPosition,
    createX402Payment,
    verifyX402Receipt,
    getCredits,
    depositCredits,
    withdrawCredits,
  };
}
