/**
 * NFT Cross-chain Module - EIL + OIF + Hyperlane for NFTs
 */

import type { NetworkType } from "@jejunetwork/types";
import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  keccak256,
  parseAbiParameters,
  toHex,
} from "viem";
import { getServicesConfig } from "../config";
import type { SupportedChain } from "../crosschain";
import {
  NFTApprovalResponseSchema,
  NFTBridgeQuotesResponseSchema,
  NFTInfoResponseSchema,
  NFTNonceResponseSchema,
  NFTTransferStatusSchema,
  NFTTransfersListSchema,
  ProvenanceResponseSchema,
  WrappedNFTInfoResponseSchema,
} from "../shared/schemas";
import type { JejuWallet } from "../wallet";

// ============ Types ============

export type NFTAssetType = "ERC721" | "ERC1155";

export interface NFTInfo {
  assetType: NFTAssetType;
  collection: Address;
  tokenId: bigint;
  amount: bigint; // Always 1 for ERC721
  tokenURI: string;
  owner: Address;
  royaltyReceiver?: Address;
  royaltyBps?: number;
}

export interface ProvenanceEntry {
  chainId: number;
  blockNumber: bigint;
  timestamp: bigint;
  from: Address;
  to: Address;
  txHash: Hex;
}

export interface WrappedNFTInfo {
  isWrapped: boolean;
  homeChainId: number;
  originalCollection: Address;
  originalTokenId: bigint;
  wrappedAt: bigint;
  provenance: ProvenanceEntry[];
}

export interface NFTBridgeQuote {
  quoteId: string;
  sourceChain: SupportedChain;
  destinationChain: SupportedChain;
  collection: Address;
  tokenId: bigint;
  amount: bigint;
  gasFee: bigint;
  xlpFee?: bigint;
  estimatedTimeSeconds: number;
  route: "hyperlane" | "eil" | "oif";
  xlp?: Address;
  solver?: Address;
  validUntil: number;
}

export interface BridgeNFTParams {
  collection: Address;
  tokenId: bigint;
  amount?: bigint; // For ERC1155
  from: SupportedChain;
  to: SupportedChain;
  recipient?: Address;
  preferredRoute?: "hyperlane" | "eil" | "oif";
}

export interface NFTVoucherRequestParams {
  collection: Address;
  tokenId: bigint;
  amount?: bigint;
  destinationChain: SupportedChain;
  recipient?: Address;
  minFee: bigint;
  maxFee: bigint;
  feeIncrement: bigint;
}

export interface NFTIntentParams {
  collection: Address;
  tokenId: bigint;
  amount?: bigint;
  destinationChain: SupportedChain;
  recipient?: Address;
  deadline?: number;
}

export interface NFTTransferStatus {
  id: Hex;
  status: "pending" | "bridging" | "delivered" | "failed" | "refunded";
  route: "hyperlane" | "eil" | "oif";
  sourceChain: SupportedChain;
  destinationChain: SupportedChain;
  collection: Address;
  tokenId: bigint;
  sourceTxHash?: Hex;
  destinationTxHash?: Hex;
  createdAt: number;
  completedAt?: number;
}

export interface NFTModule {
  // Info
  getNFTInfo(collection: Address, tokenId: bigint): Promise<NFTInfo>;
  getProvenance(
    collection: Address,
    tokenId: bigint,
  ): Promise<ProvenanceEntry[]>;
  getWrappedInfo(
    collection: Address,
    tokenId: bigint,
  ): Promise<WrappedNFTInfo | null>;

  // Quotes
  getBridgeQuote(params: BridgeNFTParams): Promise<NFTBridgeQuote>;
  getBridgeQuotes(params: BridgeNFTParams): Promise<NFTBridgeQuote[]>;

  // Hyperlane (canonical bridge)
  bridgeViaHyperlane(quote: NFTBridgeQuote): Promise<Hex>;

  // EIL (XLP fast path)
  createVoucherRequest(params: NFTVoucherRequestParams): Promise<Hex>;
  getVoucherRequestStatus(requestId: Hex): Promise<NFTTransferStatus>;
  refundVoucherRequest(requestId: Hex): Promise<Hex>;

  // OIF (intent-based)
  createNFTIntent(params: NFTIntentParams): Promise<Hex>;
  getNFTIntentStatus(intentId: Hex): Promise<NFTTransferStatus>;
  cancelNFTIntent(intentId: Hex): Promise<Hex>;

  // Unified
  bridgeNFT(quote: NFTBridgeQuote): Promise<Hex>;

  // Approvals
  approveForBridge(
    collection: Address,
    operator: Address,
    tokenId?: bigint,
  ): Promise<Hex>;
  isApprovedForBridge(
    collection: Address,
    operator: Address,
    tokenId?: bigint,
  ): Promise<boolean>;

  // My NFTs
  listMyBridgedNFTs(): Promise<NFTTransferStatus[]>;
  listPendingTransfers(): Promise<NFTTransferStatus[]>;
}

const CROSS_CHAIN_NFT_ABI = [
  {
    name: "bridgeNFT",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "destinationDomain", type: "uint32" },
      { name: "recipient", type: "bytes32" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "messageId", type: "bytes32" }],
  },
  {
    name: "quoteBridge",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "destinationDomain", type: "uint32" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    name: "getProvenance",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "entries",
        type: "tuple[]",
        components: [
          { name: "chainId", type: "uint256" },
          { name: "blockNumber", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "from", type: "address" },
          { name: "to", type: "address" },
        ],
      },
    ],
  },
] as const;

const NFT_PAYMASTER_ABI = [
  {
    name: "createNFTVoucherRequest",
    type: "function",
    stateMutability: "payable",
    inputs: [
      { name: "assetType", type: "uint8" },
      { name: "collection", type: "address" },
      { name: "tokenId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "destinationChainId", type: "uint256" },
      { name: "recipient", type: "address" },
      { name: "minFee", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "feeIncrement", type: "uint256" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    name: "refundRequest",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getCurrentFee",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [{ name: "fee", type: "uint256" }],
  },
  {
    name: "getRequest",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "requestId", type: "bytes32" }],
    outputs: [
      {
        name: "request",
        type: "tuple",
        components: [
          { name: "requester", type: "address" },
          { name: "assetType", type: "uint8" },
          { name: "collection", type: "address" },
          { name: "tokenId", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "destinationChainId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "minFee", type: "uint256" },
          { name: "maxFee", type: "uint256" },
          { name: "feeIncrement", type: "uint256" },
          { name: "startBlock", type: "uint256" },
          { name: "claimed", type: "bool" },
          { name: "refunded", type: "bool" },
        ],
      },
    ],
  },
] as const;

const NFT_INPUT_SETTLER_ABI = [
  {
    name: "open",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      {
        name: "order",
        type: "tuple",
        components: [
          { name: "originSettler", type: "address" },
          { name: "user", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "originChainId", type: "uint256" },
          { name: "openDeadline", type: "uint32" },
          { name: "fillDeadline", type: "uint32" },
          { name: "orderDataType", type: "bytes32" },
          { name: "orderData", type: "bytes" },
        ],
      },
    ],
    outputs: [],
  },
  {
    name: "refund",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "orderId", type: "bytes32" }],
    outputs: [],
  },
  {
    name: "getUserNonce",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "user", type: "address" }],
    outputs: [{ name: "nonce", type: "uint256" }],
  },
] as const;

const ERC721_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "tokenId", type: "uint256" },
    ],
    outputs: [],
  },
  {
    name: "setApprovalForAll",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "operator", type: "address" },
      { name: "approved", type: "bool" },
    ],
    outputs: [],
  },
  {
    name: "getApproved",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "operator", type: "address" }],
  },
  {
    name: "isApprovedForAll",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "operator", type: "address" },
    ],
    outputs: [{ name: "approved", type: "bool" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "uri", type: "string" }],
  },
  {
    name: "royaltyInfo",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "salePrice", type: "uint256" },
    ],
    outputs: [
      { name: "receiver", type: "address" },
      { name: "royaltyAmount", type: "uint256" },
    ],
  },
] as const;

const CHAIN_DOMAINS: Record<SupportedChain, number> = {
  jeju: 420690,
  base: 8453,
  optimism: 10,
  arbitrum: 42161,
  ethereum: 1,
};

const NFT_TRANSFER_ORDER_TYPE = keccak256(toHex("NFTTransfer"));

export function createNFTModule(
  wallet: JejuWallet,
  network: NetworkType,
): NFTModule {
  const services = getServicesConfig(network);

  // Contract addresses from environment or defaults
  function getNFTPaymasterAddress(): Address {
    const addr =
      process.env.NFTEIL_PAYMASTER || process.env.VITE_NFTEIL_PAYMASTER;
    if (!addr) throw new Error("NFTEIL_PAYMASTER not configured");
    return addr as Address;
  }

  function getNFTInputSettlerAddress(): Address {
    const addr =
      process.env.NFTEIL_INPUT_SETTLER || process.env.VITE_NFTEIL_INPUT_SETTLER;
    if (!addr) throw new Error("NFTEIL_INPUT_SETTLER not configured");
    return addr as Address;
  }

  function addressToBytes32(addr: Address): Hex {
    return `0x${addr.slice(2).padStart(64, "0")}` as Hex;
  }

  async function getNFTInfo(
    collection: Address,
    tokenId: bigint,
  ): Promise<NFTInfo> {
    const response = await fetch(
      `${services.storage.api}/nft/${collection}/${tokenId}`,
    );
    if (!response.ok) throw new Error("Failed to get NFT info");
    const rawData: unknown = await response.json();
    const data = NFTInfoResponseSchema.parse(rawData);
    return {
      assetType: data.assetType as NFTAssetType,
      collection: data.collection,
      tokenId: BigInt(data.tokenId),
      amount: BigInt(data.amount),
      tokenURI: data.tokenURI,
      owner: data.owner,
      royaltyReceiver: data.royaltyReceiver,
      royaltyBps: data.royaltyBps,
    };
  }

  async function getProvenance(
    collection: Address,
    tokenId: bigint,
  ): Promise<ProvenanceEntry[]> {
    const response = await fetch(
      `${services.storage.api}/nft/${collection}/${tokenId}/provenance`,
    );
    if (!response.ok) return [];
    const rawData: unknown = await response.json();
    const data = ProvenanceResponseSchema.parse(rawData);
    return data.provenance.map((p) => ({
      chainId: p.chainId,
      blockNumber: BigInt(p.blockNumber),
      timestamp: BigInt(p.timestamp),
      from: p.from,
      to: p.to,
      txHash: p.txHash,
    }));
  }

  async function getWrappedInfo(
    collection: Address,
    tokenId: bigint,
  ): Promise<WrappedNFTInfo | null> {
    const response = await fetch(
      `${services.storage.api}/nft/${collection}/${tokenId}/wrapped`,
    );
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`Failed to get wrapped info: ${response.statusText}`);
    }
    const rawData: unknown = await response.json();
    const data = WrappedNFTInfoResponseSchema.parse(rawData);
    return {
      isWrapped: data.isWrapped,
      homeChainId: data.homeChainId,
      originalCollection: data.originalCollection,
      originalTokenId: BigInt(data.originalTokenId),
      wrappedAt: BigInt(data.wrappedAt),
      provenance: data.provenance.map((p) => ({
        chainId: p.chainId,
        blockNumber: BigInt(p.blockNumber),
        timestamp: BigInt(p.timestamp),
        from: p.from,
        to: p.to,
        txHash: p.txHash,
      })),
    };
  }

  async function getBridgeQuote(
    params: BridgeNFTParams,
  ): Promise<NFTBridgeQuote> {
    const quotes = await getBridgeQuotes(params);
    if (quotes.length === 0) throw new Error("No quotes available");
    return quotes[0];
  }

  async function getBridgeQuotes(
    params: BridgeNFTParams,
  ): Promise<NFTBridgeQuote[]> {
    const response = await fetch(`${services.oif.aggregator}/nft/quotes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collection: params.collection,
        tokenId: params.tokenId.toString(),
        amount: (params.amount ?? 1n).toString(),
        sourceChain: params.from,
        destinationChain: params.to,
        recipient: params.recipient ?? wallet.address,
        preferredRoute: params.preferredRoute,
      }),
    });

    if (!response.ok)
      throw new Error(`Failed to get quotes: ${response.statusText}`);

    const rawData: unknown = await response.json();
    const data = NFTBridgeQuotesResponseSchema.parse(rawData);

    return data.quotes.map((q) => ({
      ...q,
      tokenId: BigInt(q.tokenId),
      amount: BigInt(q.amount),
      gasFee: BigInt(q.gasFee),
      xlpFee: q.xlpFee ? BigInt(q.xlpFee) : undefined,
    }));
  }

  async function bridgeViaHyperlane(quote: NFTBridgeQuote): Promise<Hex> {
    if (quote.route !== "hyperlane")
      throw new Error("Quote is not for Hyperlane route");

    const destinationDomain = CHAIN_DOMAINS[quote.destinationChain];
    const recipient = addressToBytes32(wallet.address);

    const data = encodeFunctionData({
      abi: CROSS_CHAIN_NFT_ABI,
      functionName: "bridgeNFT",
      args: [destinationDomain, recipient, quote.tokenId],
    });

    return wallet.sendTransaction({
      to: quote.collection,
      data,
      value: quote.gasFee,
    });
  }

  async function createVoucherRequest(
    params: NFTVoucherRequestParams,
  ): Promise<Hex> {
    const paymaster = getNFTPaymasterAddress();

    const data = encodeFunctionData({
      abi: NFT_PAYMASTER_ABI,
      functionName: "createNFTVoucherRequest",
      args: [
        0, // ERC721
        params.collection,
        params.tokenId,
        params.amount ?? 1n,
        BigInt(CHAIN_DOMAINS[params.destinationChain]),
        params.recipient ?? wallet.address,
        params.minFee,
        params.maxFee,
        params.feeIncrement,
      ],
    });

    return wallet.sendTransaction({
      to: paymaster,
      data,
      value: params.maxFee,
    });
  }

  async function getVoucherRequestStatus(
    requestId: Hex,
  ): Promise<NFTTransferStatus> {
    const response = await fetch(
      `${services.oif.aggregator}/nft/voucher/${requestId}`,
    );
    if (!response.ok) throw new Error("Failed to get voucher request status");
    const rawData: unknown = await response.json();
    return NFTTransferStatusSchema.parse(rawData) as NFTTransferStatus;
  }

  async function refundVoucherRequest(requestId: Hex): Promise<Hex> {
    const paymaster = getNFTPaymasterAddress();

    const data = encodeFunctionData({
      abi: NFT_PAYMASTER_ABI,
      functionName: "refundRequest",
      args: [requestId],
    });

    return wallet.sendTransaction({ to: paymaster, data });
  }

  async function createNFTIntent(params: NFTIntentParams): Promise<Hex> {
    const settler = getNFTInputSettlerAddress();
    const chainId = CHAIN_DOMAINS.jeju; // Source chain
    const destChainId = CHAIN_DOMAINS[params.destinationChain];
    const deadline = params.deadline ?? Math.floor(Date.now() / 1000) + 3600;

    // Get current nonce
    const response = await fetch(
      `${services.oif.aggregator}/nft/nonce/${wallet.address}`,
    );
    const rawData: unknown = await response.json();
    const { nonce } = NFTNonceResponseSchema.parse(rawData);

    // Encode NFT transfer data
    const orderData = encodeAbiParameters(
      parseAbiParameters(
        "uint8 assetType, address collection, uint256 tokenId, uint256 amount, uint256 destinationChainId, address recipient, bytes32 metadataHash",
      ),
      [
        0, // ERC721
        params.collection,
        params.tokenId,
        params.amount ?? 1n,
        BigInt(destChainId),
        params.recipient ?? wallet.address,
        keccak256(toHex("")),
      ],
    );

    const order = {
      originSettler: settler,
      user: wallet.address,
      nonce: BigInt(nonce),
      originChainId: BigInt(chainId),
      openDeadline: deadline,
      fillDeadline: deadline + 3600,
      orderDataType: NFT_TRANSFER_ORDER_TYPE,
      orderData,
    };

    const data = encodeFunctionData({
      abi: NFT_INPUT_SETTLER_ABI,
      functionName: "open",
      args: [order],
    });

    return wallet.sendTransaction({ to: settler, data });
  }

  async function getNFTIntentStatus(intentId: Hex): Promise<NFTTransferStatus> {
    const response = await fetch(
      `${services.oif.aggregator}/nft/intent/${intentId}`,
    );
    if (!response.ok) throw new Error("Failed to get intent status");
    const rawData: unknown = await response.json();
    return NFTTransferStatusSchema.parse(rawData) as NFTTransferStatus;
  }

  async function cancelNFTIntent(intentId: Hex): Promise<Hex> {
    const settler = getNFTInputSettlerAddress();

    const data = encodeFunctionData({
      abi: NFT_INPUT_SETTLER_ABI,
      functionName: "refund",
      args: [intentId],
    });

    return wallet.sendTransaction({ to: settler, data });
  }

  async function bridgeNFT(quote: NFTBridgeQuote): Promise<Hex> {
    switch (quote.route) {
      case "hyperlane":
        return bridgeViaHyperlane(quote);
      case "eil":
        return createVoucherRequest({
          collection: quote.collection,
          tokenId: quote.tokenId,
          amount: quote.amount,
          destinationChain: quote.destinationChain,
          minFee: quote.xlpFee ?? quote.gasFee,
          maxFee: (quote.xlpFee ?? quote.gasFee) * 2n,
          feeIncrement: (quote.xlpFee ?? quote.gasFee) / 100n,
        });
      case "oif":
        return createNFTIntent({
          collection: quote.collection,
          tokenId: quote.tokenId,
          amount: quote.amount,
          destinationChain: quote.destinationChain,
        });
    }
  }

  async function approveForBridge(
    collection: Address,
    operator: Address,
    tokenId?: bigint,
  ): Promise<Hex> {
    if (tokenId !== undefined) {
      const data = encodeFunctionData({
        abi: ERC721_ABI,
        functionName: "approve",
        args: [operator, tokenId],
      });
      return wallet.sendTransaction({ to: collection, data });
    }

    const data = encodeFunctionData({
      abi: ERC721_ABI,
      functionName: "setApprovalForAll",
      args: [operator, true],
    });
    return wallet.sendTransaction({ to: collection, data });
  }

  async function isApprovedForBridge(
    collection: Address,
    operator: Address,
    tokenId?: bigint,
  ): Promise<boolean> {
    // Check approval via aggregator API (more reliable than on-chain for cross-chain state)
    const response = await fetch(
      `${services.oif.aggregator}/nft/approved?collection=${collection}&operator=${operator}&owner=${wallet.address}${tokenId ? `&tokenId=${tokenId}` : ""}`,
    );
    if (!response.ok) return false;
    const rawData: unknown = await response.json();
    const data = NFTApprovalResponseSchema.parse(rawData);
    return data.approved;
  }

  async function listMyBridgedNFTs(): Promise<NFTTransferStatus[]> {
    const response = await fetch(
      `${services.oif.aggregator}/nft/transfers?user=${wallet.address}`,
    );
    if (!response.ok) return [];
    const rawData: unknown = await response.json();
    const data = NFTTransfersListSchema.parse(rawData);
    return data.transfers as NFTTransferStatus[];
  }

  async function listPendingTransfers(): Promise<NFTTransferStatus[]> {
    const all = await listMyBridgedNFTs();
    return all.filter((t) => t.status === "pending" || t.status === "bridging");
  }

  return {
    getNFTInfo,
    getProvenance,
    getWrappedInfo,
    getBridgeQuote,
    getBridgeQuotes,
    bridgeViaHyperlane,
    createVoucherRequest,
    getVoucherRequestStatus,
    refundVoucherRequest,
    createNFTIntent,
    getNFTIntentStatus,
    cancelNFTIntent,
    bridgeNFT,
    approveForBridge,
    isApprovedForBridge,
    listMyBridgedNFTs,
    listPendingTransfers,
  };
}
