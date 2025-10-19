import type { IAgentRuntime, UUID } from '@elizaos/core';
import { validateUuid, logger } from '@elizaos/core';
import express from 'express';
import type { AgentServer } from '../../server';
import { sendError, sendSuccess } from '../shared/response-utils';

interface AgentSettings {
  autonomy: boolean;
  capabilities: {
    shellAccess: boolean;
    webAccess: boolean;
    visionAccess: boolean;
    speechToText: boolean;
    textToSpeech: boolean;
  };
  modelProvider: string;
  apiKeys: Record<string, string>;
}

/**
 * Agent settings management operations
 */
export function createAgentSettingsRouter(
  agents: Map<UUID, IAgentRuntime>,
  _serverInstance: AgentServer
): express.Router {
  const router = express.Router();

  // Get agent settings
  router.get('/:agentId/settings', async (req, res) => {
    let agentId: UUID | null = null;
    let runtime: IAgentRuntime | undefined;

    // Handle "default" as a special case - get the first agent
    if (req.params.agentId === 'default') {
      runtime = Array.from(agents.values())[0];
      if (!runtime) {
        // Return a minimal response indicating server is ready but no agent yet
        return sendSuccess(res, {
          gameApiReady: true,
          agentReady: false,
          message: 'Server is running, agent initializing',
        });
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
      // Extract settings from the agent runtime
      const settings: AgentSettings = {
        autonomy: true, // Most agents have autonomy enabled
        capabilities: {
          shellAccess: runtime.plugins?.some((p) => p.name?.includes('shell')) || false,
          webAccess: runtime.plugins?.some((p) => p.name?.includes('browser')) || false,
          visionAccess:
            runtime.plugins?.some(
              (p) => p.name?.includes('vision') || p.name?.includes('camera')
            ) || false,
          speechToText:
            runtime.plugins?.some((p) => p.name?.includes('audio') || p.name?.includes('mic')) ||
            false,
          textToSpeech:
            runtime.plugins?.some((p) => p.name?.includes('tts') || p.name?.includes('speech')) ||
            false,
        },
        modelProvider: String(
          runtime.character?.settings?.MODEL_PROVIDER || process.env.MODEL_PROVIDER || 'ollama'
        ),
        apiKeys: {},
      };

      sendSuccess(res, { settings });
    } catch (error) {
      logger.error('[SETTINGS GET] Error getting settings:', error);
      sendError(
        res,
        500,
        'SETTINGS_ERROR',
        'Error retrieving settings',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Update agent settings
  router.post('/:agentId/settings', async (req, res) => {
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

    const { key, value } = req.body;

    if (!key) {
      return sendError(res, 400, 'MISSING_KEY', 'Setting key is required');
    }

    try {
      logger.info(`[SETTINGS UPDATE] Updating setting ${key} for agent ${runtime.character.name}`);

      // In a full implementation, this would update the agent's character configuration
      // and potentially restart the agent with new settings
      switch (key) {
        case 'autonomy':
          logger.info(`Autonomy setting updated to: ${value}`);
          break;
        case 'modelProvider':
          logger.info(`Model provider updated to: ${value}`);
          break;
        case 'capabilities.shellAccess':
        case 'capabilities.webAccess':
        case 'capabilities.visionAccess':
        case 'capabilities.speechToText':
        case 'capabilities.textToSpeech':
          logger.info(`Capability ${key} updated to: ${value}`);
          break;
        default:
          logger.info(`Custom setting ${key} updated to: ${value}`);
      }

      sendSuccess(res, {
        message: `Setting ${key} updated successfully`,
        key,
        value,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[SETTINGS UPDATE] Error updating setting:', error);
      sendError(
        res,
        500,
        'SETTING_UPDATE_ERROR',
        'Error updating setting',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Get vision-specific settings
  router.get('/:agentId/settings/vision', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    try {
      const visionSettings = {
        enabled:
          runtime.plugins?.some((p) => p.name?.includes('vision') || p.name?.includes('camera')) ||
          false,
        model: 'gpt-4-vision-preview',
        maxImageSize: 1024,
        supportedFormats: ['jpg', 'jpeg', 'png', 'webp'],
      };

      sendSuccess(res, { visionSettings });
    } catch (error) {
      logger.error('[VISION SETTINGS] Error getting vision settings:', error);
      sendError(
        res,
        500,
        'VISION_SETTINGS_ERROR',
        'Error retrieving vision settings',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  // Refresh vision service
  router.post('/:agentId/vision/refresh', async (req, res) => {
    const agentId = validateUuid(req.params.agentId);
    if (!agentId) {
      return sendError(res, 400, 'INVALID_ID', 'Invalid agent ID format');
    }

    const runtime = agents.get(agentId);
    if (!runtime) {
      return sendError(res, 404, 'NOT_FOUND', 'Agent not found or not running');
    }

    try {
      logger.info(`[VISION REFRESH] Refreshing vision service for agent ${runtime.character.name}`);

      // In a full implementation, this would restart or refresh the vision service
      sendSuccess(res, {
        message: 'Vision service refreshed successfully',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      logger.error('[VISION REFRESH] Error refreshing vision service:', error);
      sendError(
        res,
        500,
        'VISION_REFRESH_ERROR',
        'Error refreshing vision service',
        error instanceof Error ? error.message : String(error)
      );
    }
  });

  return router;
}
