/**
 * ERC-8004 Service Discovery Routes
 * Mounted under /api/agents/:agentId/erc8004
 */

import { Router } from 'express';
import type { IAgentRuntime, UUID } from '@elizaos/core';
import {
  listServices,
  getService,
  connectToService,
  disconnectFromService,
  listConnections,
  sendToService
} from '../erc8004/services';

export function createERC8004Router(agents: Map<UUID, IAgentRuntime>): Router {
  const router = Router({ mergeParams: true });

  // GET /api/agents/:agentId/erc8004/services - List available ERC-8004 services
  router.get('/services', listServices);

  // GET /api/agents/:agentId/erc8004/services/:serviceId - Get specific service details
  router.get('/services/:serviceId', getService);

  // POST /api/agents/:agentId/erc8004/connect - Connect to a service
  router.post('/connect', connectToService);

  // POST /api/agents/:agentId/erc8004/disconnect - Disconnect from a service
  router.post('/disconnect', disconnectFromService);

  // GET /api/agents/:agentId/erc8004/connections - List active connections
  router.get('/connections', listConnections);

  // POST /api/agents/:agentId/erc8004/message - Send message to connected service
  router.post('/message', sendToService);

  return router;
}

