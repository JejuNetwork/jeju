/**
 * Network SDK - Complete protocol access
 *
 * @example
 * ```ts
 * import { createJejuClient } from '@jejunetwork/sdk';
 *
 * const jeju = await createJejuClient({
 *   network: 'testnet',
 *   privateKey: '0x...',
 * });
 *
 * // Compute
 * await jeju.compute.listProviders();
 * await jeju.compute.createRental({ provider, durationHours: 2 });
 *
 * // Storage
 * await jeju.storage.upload(file);
 *
 * // DeFi
 * await jeju.defi.swap({ tokenIn, tokenOut, amountIn });
 *
 * // Cross-chain
 * await jeju.crosschain.transfer({ from: 'base', to: 'arbitrum', amount });
 * ```
 */

export { createJejuClient } from "./client";
export type { JejuClient, JejuClientConfig } from "./client";

// Module exports
export * from "./compute";
export * from "./storage";
export * from "./defi";
export * from "./governance";
export * from "./names";
export * from "./identity";
export * from "./validation";
export * from "./crosschain";
export * from "./nfts";
export * from "./payments";
export * from "./a2a";

// Extended modules
export * from "./games";
export * from "./containers";
export * from "./launchpad";
export * from "./federation";
export * from "./moderation";
export * from "./work";
export * from "./staking";
export * from "./dws";
export * from "./otc";
export * from "./messaging";
export * from "./distributor";
export * from "./training";
export * from "./perps";
export * from "./amm";
export * from "./agents";
export * from "./bridge";
export * from "./oracle";
export * from "./sequencer";
export * from "./cdn";
export * from "./prediction";

// Developer tools
export * from "./git";
export * from "./packages";

// VPN
export * from "./vpn";
export * from "./vpn-module";

// Models (HuggingFace-like)
export * from "./models";

// Wallet utilities
export * from "./wallet";

// Contract utilities
export * from "./contracts";

// Re-export types
export type {
  ComputeProvider,
  ComputeRental,
  InferenceRequest,
  InferenceResponse,
  ComputeResources,
} from "@jejunetwork/types";

export type {
  Intent,
  IntentQuote,
  Solver,
  VoucherRequest,
  Voucher,
} from "@jejunetwork/types";

export type {
  Proposal,
  ProposalStatus,
  ProposalType,
  VoteType,
} from "@jejunetwork/types";

export type {
  VPNNode,
  VPNConnection,
  VPNProtocol,
  ContributionQuota,
  ContributionSettings,
  CountryCode,
} from "@jejunetwork/types";
