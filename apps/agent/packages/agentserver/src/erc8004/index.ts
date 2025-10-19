/**
 * ERC-8004 Service Discovery Module
 * 
 * Provides agent registration, service discovery, and connection management
 * for the ERC-8004 Trustless Agent Registry standard.
 */

export { ERC8004RegistryClient, autoRegisterToRegistry } from './registry';
export { ServiceConnectionManager } from './connectionManager';
export { erc8004Actions } from './actions';
export { erc8004Plugin } from './plugin';
export { generateAgentCard, agentCardMiddleware } from './agentCard';
export type { 
  Service, 
  ServiceType, 
  ServiceFilters, 
  ServiceConnection, 
  RegistrationResult,
  AgentCard
} from './types';

