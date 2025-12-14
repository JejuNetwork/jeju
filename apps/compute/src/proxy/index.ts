/**
 * Jeju Decentralized Proxy Network
 * Permissionless bandwidth-sharing marketplace on Jeju L2
 * @module @jeju/proxy
 */

// ============ Types ============
export type {
  Address,
  RegionCode,
  HttpMethod,
  ProxyNode,
  ConnectedNode,
  ProxySession,
  ProxyRequest,
  ProxyResponse,
  CoordinatorConfig,
  NodeClientConfig,
  ExternalProviderConfig,
  ExternalProxyProvider,
  DecentralizedProviderType,
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
  getAllRegionCodes,
} from './types';

// ============ Coordinator ============
export { ProxyCoordinatorServer, startProxyCoordinator } from './coordinator/server';
export { NodeManager } from './coordinator/node-manager';
export { RequestRouter } from './coordinator/request-router';

// ============ Node Client ============
export { ProxyNodeClient, startProxyNode } from './node/client';

// ============ SDK ============
export { JejuProxySDK, createProxySDK } from './sdk/proxy-sdk';

// ============ External Adapters ============
export {
  BaseExternalAdapter,
  REGION_TO_COUNTRY,
  PriceUtils,
  createErrorResponse,
  createSuccessResponse,
  executeProxiedFetch,
  countriesToRegions,
  type AdapterConfig,
} from './external/adapter';

export { MysteriumAdapter, createMysteriumAdapter } from './external/mysterium';
export { OrchidAdapter, createOrchidAdapter } from './external/orchid';
export { SentinelAdapter, createSentinelAdapter } from './external/sentinel';
