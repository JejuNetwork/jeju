/**
 * Jeju Decentralized Proxy Network
 * 
 * A permissionless bandwidth-sharing marketplace on Jeju L2.
 * 
 * Components:
 * - Coordinator: Central service that routes requests and manages payments
 * - Node Client: Runs on user machines to provide bandwidth
 * - SDK: Client library for consuming proxy services
 * - External Adapters: Fallback to third-party providers when needed
 * 
 * @module @jeju/proxy
 */

// ============ Types ============
export type {
  RegionCode,
  ProxyNode,
  ConnectedNode,
  ProxySession,
  ProxyRequest,
  ProxyResponse,
  CoordinatorConfig,
  NodeClientConfig,
  ExternalProviderConfig,
  ExternalProxyProvider,
  ProxySDKConfig,
  FetchOptions,
  FetchResult,
  RegionInfo,
  WsMessage,
  AuthSubmitPayload,
  AuthResponsePayload,
  TaskAssignPayload,
  TaskResultPayload,
  HeartbeatResponsePayload,
  StatusUpdatePayload,
  SessionStatusType,
  WsMessageTypeValue,
  ApiResponse,
  SessionOpenResponse,
} from './types';

export {
  REGION_CODES,
  SessionStatus,
  WsMessageType,
  hashRegion,
  regionFromHash,
} from './types';

// ============ Coordinator ============
export {
  ProxyCoordinatorServer,
  startProxyCoordinator,
} from './coordinator/server';

export { NodeManager } from './coordinator/node-manager';
export { RequestRouter } from './coordinator/request-router';

// ============ Node Client ============
export {
  ProxyNodeClient,
  startProxyNode,
} from './node/client';

// ============ SDK ============
export {
  JejuProxySDK,
  createProxySDK,
} from './sdk/proxy-sdk';

// ============ External Adapters ============
export {
  BaseExternalAdapter,
  REGION_TO_COUNTRY,
  getAllRegionCodes,
  type ExternalAdapterConfig,
} from './external/adapter';

export {
  BrightDataAdapter,
  createBrightDataAdapter,
} from './external/brightdata';

