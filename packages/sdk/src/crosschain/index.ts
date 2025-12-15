/**
 * Cross-chain Module - EIL + OIF
 */

import { type Address, type Hex, encodeFunctionData } from "viem";
import type { NetworkType } from "@jejunetwork/types";
import type { JejuWallet } from "../wallet";
import {
  getContract as getContractAddress,
  getServicesConfig,
} from "../config";

export type SupportedChain =
  | "jeju"
  | "base"
  | "optimism"
  | "arbitrum"
  | "ethereum";

export interface CrossChainQuote {
  quoteId: string;
  sourceChain: SupportedChain;
  destinationChain: SupportedChain;
  sourceToken: Address;
  destinationToken: Address;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  feePercent: number;
  estimatedTimeSeconds: number;
  route: "eil" | "oif";
  solver?: Address;
  xlp?: Address;
  validUntil: number;
}

export interface TransferParams {
  from: SupportedChain;
  to: SupportedChain;
  token: Address;
  amount: bigint;
  recipient?: Address;
  preferredRoute?: "eil" | "oif";
}

export interface IntentParams {
  sourceChain: SupportedChain;
  destinationChain: SupportedChain;
  inputs: Array<{ token: Address; amount: bigint }>;
  outputs: Array<{ token: Address; amount: bigint; recipient: Address }>;
  deadline?: number;
}

export interface IntentStatus {
  intentId: Hex;
  status: "open" | "pending" | "filled" | "expired" | "cancelled" | "failed";
  solver?: Address;
  fillTxHash?: Hex;
  createdAt: number;
  filledAt?: number;
}

export interface XLPInfo {
  address: Address;
  stakedAmount: bigint;
  liquidity: Record<SupportedChain, bigint>;
  reputation: number;
  successRate: number;
  avgResponseMs: number;
}

export interface SolverInfo {
  address: Address;
  name: string;
  supportedChains: SupportedChain[];
  reputation: number;
  successRate: number;
  totalFills: number;
  avgFillTimeMs: number;
}

export interface CrossChainModule {
  // Quotes
  getQuote(params: TransferParams): Promise<CrossChainQuote>;
  getQuotes(params: TransferParams): Promise<CrossChainQuote[]>;

  // EIL (XLP-based)
  transferViaEIL(quote: CrossChainQuote): Promise<Hex>;
  listXLPs(): Promise<XLPInfo[]>;
  becomeXLP(stakeAmount: bigint): Promise<Hex>;
  provideXLPLiquidity(chain: SupportedChain, amount: bigint): Promise<Hex>;

  // OIF (Intent-based)
  createIntent(params: IntentParams): Promise<Hex>;
  getIntentStatus(intentId: Hex): Promise<IntentStatus>;
  listMyIntents(): Promise<IntentStatus[]>;
  cancelIntent(intentId: Hex): Promise<Hex>;
  listSolvers(): Promise<SolverInfo[]>;

  // Unified transfer
  transfer(quote: CrossChainQuote): Promise<Hex>;

  // Info
  getSupportedChains(): SupportedChain[];
  getChainId(chain: SupportedChain): number;
}

const _INPUT_SETTLER_ABI = [
  {
    name: "open",
    type: "function",
    stateMutability: "payable",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "originSettler", type: "address" },
          { name: "user", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "originChainId", type: "uint64" },
          { name: "openDeadline", type: "uint32" },
          { name: "fillDeadline", type: "uint32" },
          { name: "orderDataType", type: "bytes32" },
          { name: "orderData", type: "bytes" },
        ],
      },
      { name: "signature", type: "bytes" },
      { name: "originFillerData", type: "bytes" },
    ],
    outputs: [],
  },
  {
    name: "resolve",
    type: "function",
    stateMutability: "view",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "originSettler", type: "address" },
          { name: "user", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "originChainId", type: "uint64" },
          { name: "openDeadline", type: "uint32" },
          { name: "fillDeadline", type: "uint32" },
          { name: "orderDataType", type: "bytes32" },
          { name: "orderData", type: "bytes" },
        ],
      },
      { name: "originFillerData", type: "bytes" },
    ],
    outputs: [
      {
        name: "resolved",
        type: "tuple",
        components: [
          { name: "user", type: "address" },
          { name: "originChainId", type: "uint64" },
          { name: "openDeadline", type: "uint32" },
          { name: "fillDeadline", type: "uint32" },
          { name: "orderId", type: "bytes32" },
          {
            name: "maxSpent",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "recipient", type: "address" },
              { name: "chainId", type: "uint64" },
            ],
          },
          {
            name: "minReceived",
            type: "tuple[]",
            components: [
              { name: "token", type: "address" },
              { name: "amount", type: "uint256" },
              { name: "recipient", type: "address" },
              { name: "chainId", type: "uint64" },
            ],
          },
          {
            name: "fillInstructions",
            type: "tuple[]",
            components: [
              { name: "destinationChainId", type: "uint64" },
              { name: "destinationSettler", type: "address" },
              { name: "originData", type: "bytes" },
            ],
          },
        ],
      },
    ],
  },
] as const;

const XLP_STAKE_MANAGER_ABI = [
  {
    name: "stake",
    type: "function",
    stateMutability: "payable",
    inputs: [],
    outputs: [],
  },
  {
    name: "depositLiquidity",
    type: "function",
    stateMutability: "payable",
    inputs: [{ name: "chainId", type: "uint256" }],
    outputs: [],
  },
  {
    name: "getXLP",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "xlp", type: "address" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "stakedAmount", type: "uint256" },
          { name: "stakedAt", type: "uint256" },
          { name: "status", type: "uint8" },
        ],
      },
    ],
  },
] as const;

const CHAIN_IDS: Record<SupportedChain, number> = {
  jeju: 420690,
  base: 8453,
  optimism: 10,
  arbitrum: 42161,
  ethereum: 1,
};

export function createCrossChainModule(
  wallet: JejuWallet,
  network: NetworkType,
): CrossChainModule {
  const xlpStakeManagerAddress = getContractAddress(
    "eil",
    "l1StakeManager",
    network,
  ) as Address;
  const services = getServicesConfig(network);

  async function getQuote(params: TransferParams): Promise<CrossChainQuote> {
    const quotes = await getQuotes(params);
    if (quotes.length === 0) throw new Error("No quotes available");
    return quotes[0];
  }

  async function getQuotes(params: TransferParams): Promise<CrossChainQuote[]> {
    const response = await fetch(`${services.oif.aggregator}/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceChain: params.from,
        destinationChain: params.to,
        token: params.token,
        amount: params.amount.toString(),
        recipient: params.recipient ?? wallet.address,
        preferredRoute: params.preferredRoute,
      }),
    });

    if (!response.ok)
      throw new Error(`Failed to get quotes: ${response.statusText}`);

    const data = (await response.json()) as {
      quotes: Array<{
        quoteId: string;
        sourceChain: SupportedChain;
        destinationChain: SupportedChain;
        sourceToken: Address;
        destinationToken: Address;
        amountIn: string;
        amountOut: string;
        fee: string;
        feePercent: number;
        estimatedTimeSeconds: number;
        route: "eil" | "oif";
        solver?: Address;
        xlp?: Address;
        validUntil: number;
      }>;
    };

    return data.quotes.map((q) => ({
      ...q,
      amountIn: BigInt(q.amountIn),
      amountOut: BigInt(q.amountOut),
      fee: BigInt(q.fee),
    }));
  }

  async function transferViaEIL(quote: CrossChainQuote): Promise<Hex> {
    if (quote.route !== "eil") throw new Error("Quote is not for EIL route");

    // Create voucher request via API
    const response = await fetch(`${services.oif.aggregator}/eil/voucher`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jeju-address": wallet.address,
      },
      body: JSON.stringify({
        quoteId: quote.quoteId,
      }),
    });

    if (!response.ok)
      throw new Error(
        `Failed to create voucher request: ${response.statusText}`,
      );

    const data = (await response.json()) as {
      txData: Hex;
      to: Address;
      value: string;
    };

    return wallet.sendTransaction({
      to: data.to,
      data: data.txData,
      value: BigInt(data.value),
    });
  }

  async function createIntent(params: IntentParams): Promise<Hex> {
    const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 3600;
    const nonce = BigInt(Date.now());

    // Build intent via API
    const response = await fetch(`${services.oif.aggregator}/intents`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-jeju-address": wallet.address,
      },
      body: JSON.stringify({
        sourceChain: params.sourceChain,
        destinationChain: params.destinationChain,
        inputs: params.inputs.map((i) => ({
          token: i.token,
          amount: i.amount.toString(),
        })),
        outputs: params.outputs.map((o) => ({
          token: o.token,
          amount: o.amount.toString(),
          recipient: o.recipient,
        })),
        deadline,
        nonce: nonce.toString(),
      }),
    });

    if (!response.ok)
      throw new Error(`Failed to create intent: ${response.statusText}`);

    const data = (await response.json()) as {
      txData: Hex;
      to: Address;
      value: string;
    };

    return wallet.sendTransaction({
      to: data.to,
      data: data.txData,
      value: BigInt(data.value),
    });
  }

  async function getIntentStatus(intentId: Hex): Promise<IntentStatus> {
    const response = await fetch(
      `${services.oif.aggregator}/intents/${intentId}`,
    );
    if (!response.ok) throw new Error("Failed to get intent status");
    return (await response.json()) as IntentStatus;
  }

  async function listMyIntents(): Promise<IntentStatus[]> {
    const response = await fetch(
      `${services.oif.aggregator}/intents?user=${wallet.address}`,
    );
    if (!response.ok) return [];

    const data = (await response.json()) as { intents: IntentStatus[] };
    return data.intents;
  }

  async function cancelIntent(intentId: Hex): Promise<Hex> {
    const response = await fetch(
      `${services.oif.aggregator}/intents/${intentId}/cancel`,
      {
        method: "POST",
        headers: { "x-jeju-address": wallet.address },
      },
    );

    if (!response.ok) throw new Error("Failed to cancel intent");

    const data = (await response.json()) as { txData: Hex; to: Address };
    return wallet.sendTransaction({ to: data.to, data: data.txData });
  }

  async function listXLPs(): Promise<XLPInfo[]> {
    const response = await fetch(`${services.oif.aggregator}/eil/xlps`);
    if (!response.ok) return [];

    const data = (await response.json()) as { xlps: XLPInfo[] };
    return data.xlps;
  }

  async function becomeXLP(stakeAmount: bigint): Promise<Hex> {
    const data = encodeFunctionData({
      abi: XLP_STAKE_MANAGER_ABI,
      functionName: "stake",
      args: [],
    });

    return wallet.sendTransaction({
      to: xlpStakeManagerAddress,
      data,
      value: stakeAmount,
    });
  }

  async function provideXLPLiquidity(
    chain: SupportedChain,
    amount: bigint,
  ): Promise<Hex> {
    const chainId = CHAIN_IDS[chain];

    const data = encodeFunctionData({
      abi: XLP_STAKE_MANAGER_ABI,
      functionName: "depositLiquidity",
      args: [BigInt(chainId)],
    });

    return wallet.sendTransaction({
      to: xlpStakeManagerAddress,
      data,
      value: amount,
    });
  }

  async function listSolvers(): Promise<SolverInfo[]> {
    const response = await fetch(`${services.oif.aggregator}/solvers`);
    if (!response.ok) return [];

    const data = (await response.json()) as { solvers: SolverInfo[] };
    return data.solvers;
  }

  async function transfer(quote: CrossChainQuote): Promise<Hex> {
    if (quote.route === "eil") {
      return transferViaEIL(quote);
    }

    // OIF route
    return createIntent({
      sourceChain: quote.sourceChain,
      destinationChain: quote.destinationChain,
      inputs: [{ token: quote.sourceToken, amount: quote.amountIn }],
      outputs: [
        {
          token: quote.destinationToken,
          amount: quote.amountOut,
          recipient: wallet.address,
        },
      ],
    });
  }

  function getSupportedChains(): SupportedChain[] {
    return Object.keys(CHAIN_IDS) as SupportedChain[];
  }

  function getChainId(chain: SupportedChain): number {
    return CHAIN_IDS[chain];
  }

  return {
    getQuote,
    getQuotes,
    transferViaEIL,
    listXLPs,
    becomeXLP,
    provideXLPLiquidity,
    createIntent,
    getIntentStatus,
    listMyIntents,
    cancelIntent,
    listSolvers,
    transfer,
    getSupportedChains,
    getChainId,
  };
}
