import type { IAgentRuntime, UUID } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../server';
import { createAgentCrudRouter } from './crud';
import { createAgentLifecycleRouter } from './lifecycle';
import { createAgentWorldsRouter } from './worlds';
import { createAgentPanelsRouter } from './panels';
import { createAgentLogsRouter } from './logs';
import { createAgentCapabilitiesRouter } from './capabilities';
import { createAgentGoalsRouter } from './goals';
import { createAgentTodosRouter } from './todos';
import { createAgentSettingsRouter } from './settings';
import { createAgentKnowledgeRouter } from './knowledge';
import { createAgentPluginsRouter } from './plugins';
import { createAgentMemoryRouter } from '../memory/agents';
import { createRoomManagementRouter } from '../memory/rooms';
import { createAgentPortabilityRouter } from './portability';
import { createERC8004Router } from './erc8004';

/**
 * Creates the agents router for agent lifecycle and management operations
 */
export function agentsRouter(
  agents: Map<UUID, IAgentRuntime>,
  serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Mount CRUD operations at root level
  router.use('/', createAgentCrudRouter(agents, serverInstance));

  // Mount lifecycle operations
  router.use('/', createAgentLifecycleRouter(agents, serverInstance));

  // Mount world management operations
  router.use('/', createAgentWorldsRouter(agents));

  // Mount panels operations
  router.use('/', createAgentPanelsRouter(agents));

  // Mount logs operations
  router.use('/', createAgentLogsRouter(agents));

  // Mount capabilities management
  router.use('/', createAgentCapabilitiesRouter(agents, serverInstance));

  // Mount goals management
  router.use('/', createAgentGoalsRouter(agents, serverInstance));

  // Mount todos management
  router.use('/', createAgentTodosRouter(agents, serverInstance));

  // Mount settings management
  router.use('/', createAgentSettingsRouter(agents, serverInstance));

  // Mount knowledge management
  router.use('/', createAgentKnowledgeRouter(agents, serverInstance));

  // Mount plugin management
  router.use('/', createAgentPluginsRouter(agents, serverInstance));

  // Mount memory operations
  router.use('/', createAgentMemoryRouter(agents));
  // Mount room management (list rooms and room details) under agents
  router.use('/', createRoomManagementRouter(agents));

  // Mount portability operations (export/import)
  router.use('/', createAgentPortabilityRouter(agents, serverInstance));

  // Mount ERC-8004 service discovery
  router.use('/', createERC8004Router(agents));

  return router;
}
