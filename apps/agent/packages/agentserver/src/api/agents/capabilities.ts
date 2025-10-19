import type { IAgentRuntime, UUID } from '@elizaos/core';
import { validateUuid, logger } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../server';
import { sendError, sendSuccess } from '../shared/response-utils';

/**
 * Agent capabilities management operations
 */
export function createAgentCapabilitiesRouter(
  agents: Map<UUID, IAgentRuntime>,
  _serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Get all capabilities for an agent
  router.get('/:agentId/capabilities', async (req, res) => {
    let agentId: UUID | null = null;
    let runtime: IAgentRuntime | undefined;

    // Handle "default" as a special case - get the first agent
    if (req.params.agentId === 'default') {
      runtime = Array.from(agents.values())[0];
      if (!runtime) {
        return sendError(res, 503, 'NO_AGENT', 'No agents available');
      }
      agentId = runtime.agentId;
    } else {
      // Validate as UUID for non-default IDs
      agentId = validateUuid(req.params.agentId);
      if (!agentId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
      }
      runtime = agents.get(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
      }
    }

    try {
      // Get current capabilities from the agent runtime
      // This is a basic implementation - extend as needed
      const capabilities = {
        autonomy: true, // Most agents have basic autonomy
        shell: runtime.plugins?.some((p) => p.name?.includes('shell')) || false,
        browser: runtime.plugins?.some((p) => p.name?.includes('browser')) || false,
        camera:
          runtime.plugins?.some((p) => p.name?.includes('camera') || p.name?.includes('vision')) ||
          false,
        screen: runtime.plugins?.some((p) => p.name?.includes('screen')) || false,
        microphone:
          runtime.plugins?.some((p) => p.name?.includes('mic') || p.name?.includes('audio')) ||
          false,
        speakers:
          runtime.plugins?.some((p) => p.name?.includes('speak') || p.name?.includes('tts')) ||
          false,
      };

      sendSuccess(res, { capabilities });
    } catch (error) {
      logger.error('[CAPABILITIES GET] Error getting capabilities:', error);
      sendError(
        res,
        500,
        'CAPABILITIES_ERROR',
        'Error retrieving capabilities',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Get specific capability status
  router.get('/:agentId/capabilities/:capability', async (req, res) => {
    let agentId: UUID | null = null;
    let runtime: IAgentRuntime | undefined;

    // Handle "default" as a special case - get the first agent
    if (req.params.agentId === 'default') {
      runtime = Array.from(agents.values())[0];
      if (!runtime) {
        return sendError(res, 503, 'NO_AGENT', 'No agents available');
      }
      agentId = runtime.agentId;
    } else {
      // Validate as UUID for non-default IDs
      agentId = validateUuid(req.params.agentId);
      if (!agentId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
      }
      runtime = agents.get(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
      }
    }

    const capability = req.params.capability;

    try {
      let enabled = false;

      // Check if the capability is enabled based on plugins or configuration
      switch (capability) {
        case 'autonomy':
          enabled = true; // Most agents have autonomy
          break;
        case 'shell':
          enabled = runtime.plugins?.some((p) => p.name?.includes('shell')) || false;
          break;
        case 'browser':
          enabled =
            runtime.plugins?.some(
              (p) => p.name?.includes('browser') || p.name?.includes('stagehand')
            ) || false;
          break;
        case 'camera':
          enabled =
            runtime.plugins?.some(
              (p) => p.name?.includes('camera') || p.name?.includes('vision')
            ) || false;
          break;
        case 'screen':
          enabled = runtime.plugins?.some((p) => p.name?.includes('screen')) || false;
          break;
        case 'microphone':
          enabled =
            runtime.plugins?.some((p) => p.name?.includes('mic') || p.name?.includes('audio')) ||
            false;
          break;
        case 'speakers':
          enabled =
            runtime.plugins?.some((p) => p.name?.includes('speak') || p.name?.includes('tts')) ||
            false;
          break;
        default:
          return sendError(res, 400, 'INVALID_CAPABILITY', `Unknown capability: ${capability}`);
      }

      sendSuccess(res, {
        capability,
        enabled,
        status: enabled ? 'active' : 'inactive',
      });
    } catch (error) {
      logger.error(`[CAPABILITY GET] Error getting ${capability} status:`, error);
      sendError(
        res,
        500,
        'CAPABILITY_ERROR',
        `Error retrieving ${capability} status`,
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Toggle a specific capability
  router.post('/:agentId/capabilities/:capability/toggle', async (req, res) => {
    let agentId: UUID | null = null;
    let runtime: IAgentRuntime | undefined;

    // Handle "default" as a special case - get the first agent
    if (req.params.agentId === 'default') {
      runtime = Array.from(agents.values())[0];
      if (!runtime) {
        return sendError(res, 503, 'NO_AGENT', 'No agents available');
      }
      agentId = runtime.agentId;
    } else {
      // Validate as UUID for non-default IDs
      agentId = validateUuid(req.params.agentId);
      if (!agentId) {
        return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
      }
      runtime = agents.get(agentId);
      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
      }
    }

    const capability = req.params.capability;
    const { enabled } = req.body;

    try {
      logger.info(
        `[CAPABILITY TOGGLE] ${enabled ? 'Enabling' : 'Disabling'} ${capability} for agent ${agentId}`
      );

      // Handle capability toggle - register/unregister progressive plugins
      switch (capability) {
        case 'autonomy':
          // Toggle autonomy - this would affect the agent's autonomous behavior
          logger.info(
            `Autonomy ${enabled ? 'enabled' : 'disabled'} for agent ${runtime.character.name}`
          );
          break;
        case 'shell':
        case 'browser':
        case 'camera':
        case 'screen':
        case 'microphone':
        case 'speakers':
          // Register/unregister progressive plugins based on capability
          logger.info(
            `${capability} capability ${enabled ? 'enabled' : 'disabled'} for agent ${runtime.character.name}`
          );

          // Use ProgressivePluginService to register/unregister plugins
          const progressivePluginService = runtime.getService('PROGRESSIVE_PLUGIN');

          if (enabled && progressivePluginService) {
            console.log(`[CAPABILITY] Registering progressive plugin for ${capability}`);
            logger.info(`[CAPABILITY] Registering progressive plugin for ${capability}`);
            try {
              await (progressivePluginService as any).registerCapabilityPlugins(capability);
            } catch (error) {
              logger.error(`[CAPABILITY] Failed to register plugins for ${capability}:`, error);
            }
          }
          console.log(`[API] ${capability} capability ${enabled ? 'enabled' : 'disabled'}`);
          break;
        default:
          return sendError(res, 400, 'INVALID_CAPABILITY', `Unknown capability: ${capability}`);
      }

      // Store the capability state (in a real implementation, this would persist to database)
      // For now, we'll just return success
      sendSuccess(res, {
        capability,
        enabled,
        message: `${capability} ${enabled ? 'enabled' : 'disabled'} successfully`,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error(`[CAPABILITY TOGGLE] Error toggling ${capability}:`, error);
      sendError(
        res,
        500,
        'CAPABILITY_ERROR',
        `Error toggling ${capability}`,
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Get autonomy status (for monologue functionality)
  router.get('/:agentId/autonomy/status', async (req, res) => {
    try {
      const agentId = validateUuid(req.params.agentId);
      const runtime = agents.get(agentId);

      if (!runtime) {
        return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
      }

      const autonomyEnabled = runtime.character.settings?.AUTONOMY_ENABLED || false;

      sendSuccess(res, {
        enabled: autonomyEnabled,
        status: autonomyEnabled ? 'active' : 'inactive',
        agent: runtime.character.name,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[AUTONOMY STATUS API] Error getting autonomy status:', error);
      sendError(
        res,
        500,
        'AUTONOMY_STATUS_ERROR',
        'Error retrieving autonomy status',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
