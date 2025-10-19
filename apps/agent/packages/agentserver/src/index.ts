import './polyfill';

import type { Character, Plugin } from '@elizaos/core';
import {
  AgentRuntime as ElizaAgentRuntime,
  IAgentRuntime,
  logger,
  stringToUuid,
} from '@elizaos/core';
import { Request, Response } from 'express';

import autocoderPlugin from '@elizaos/plugin-autocoder';
import { autonomyPlugin } from '@elizaos/plugin-autonomy';
import { bootstrapPlugin } from '@elizaos/plugin-bootstrap';
import { experiencePlugin } from '@elizaos/plugin-experience';
import GoalsPlugin from '@elizaos/plugin-goals';
import { inferencePlugin } from '@elizaos/plugin-inference';
import { knowledgePlugin } from '@elizaos/plugin-knowledge';
import PersonalityPlugin from '@elizaos/plugin-personality';
import { pluginManagerPlugin } from '@elizaos/plugin-plugin-manager';
import samPlugin from '@elizaos/plugin-sam';
import shellPlugin from '@elizaos/plugin-shell';
import { plugin as sqlPlugin } from '@elizaos/plugin-sql';
import { stagehandPlugin } from '@elizaos/plugin-stagehand';
import TodoPlugin from '@elizaos/plugin-todo';
import { visionPlugin } from '@elizaos/plugin-vision';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { terminalCharacter } from './character';
import { gameAPIPlugin } from './game-api-plugin';
import { AgentServer } from './server';
import { CapabilityProgressionService } from './services/capabilityProgressionService';
import { ProgressionTracker } from './services/progressionTracker';
import { ProgressivePluginService } from './services/progressivePluginService';
import { erc8004Plugin, autoRegisterToRegistry } from './erc8004';

/**
 * Agent ID Handling Strategy:
 *
 * The system supports multiple ways to access agent-specific endpoints:
 *
 * 1. Using "default" as agent ID - This resolves to the first available agent
 *    Example: /api/agents/default/settings
 *
 * 2. Using actual agent UUID - Direct access to a specific agent
 *    Example: /api/agents/123e4567-e89b-12d3-a456-426614174000/settings
 *
 * 3. Discovery endpoints:
 *    - GET /api/agents/primary - Returns the primary (first) agent's details
 *    - GET /api/agents - Returns list of all available agents
 *
 * Frontend should ideally:
 * 1. Call /api/agents/primary to get the actual agent ID
 * 2. Use the returned agent ID for subsequent API calls
 * 3. Fall back to "default" if needed for backward compatibility
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to load .env only if file exists
function loadEnvIfExists(envPath: string) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath });
  }
}

const envPaths = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env'),
  path.join(__dirname, '..', '..', '..', '.env'),
];

envPaths.forEach(loadEnvIfExists);

// Check which embedding provider to use
const embeddingProvider =
  process.env.EMBEDDING_PROVIDER || terminalCharacter.settings?.EMBEDDING_PROVIDER || 'ollama';
const modelProvider =
  process.env.MODEL_PROVIDER || terminalCharacter.settings?.MODEL_PROVIDER || 'ollama';

// Define all available plugins for progressive unlocking
const allAvailablePlugins: Record<string, Plugin> = {
  sql: sqlPlugin,
  bootstrap: bootstrapPlugin,
  autonomy: autonomyPlugin,
  goals: GoalsPlugin,
  todo: TodoPlugin,
  vision: visionPlugin,
  personality: PersonalityPlugin,
  experience: experiencePlugin,
  knowledge: knowledgePlugin,
  shell: shellPlugin,
  stagehand: stagehandPlugin,
  gameAPI: gameAPIPlugin,
  inference: inferencePlugin,
  autocoder: autocoderPlugin,
  pluginManager: pluginManagerPlugin,
  sam: samPlugin,
  erc8004: erc8004Plugin,
};

// Create initial plugin list with only basic capabilities
function createInitialPlugins(): Plugin[] {
  return [
    sqlPlugin, // Always needed for database
    bootstrapPlugin, // Always needed for basic runtime
    gameAPIPlugin, // Always needed for game API
    inferencePlugin, // Always needed for inference
    autonomyPlugin, // Start with autonomy enabled
    knowledgePlugin, // Always needed for memory
    PersonalityPlugin, // Always needed for character
    experiencePlugin, // Always needed for learning
    shellPlugin, // Shell is available from level 0
    erc8004Plugin, // ERC-8004 service discovery
    // Goals and Todo will be added via progression at level 2
  ].filter(Boolean);
}

const initialPlugins = createInitialPlugins();

// Function to start an agent runtime - called by server.ts
export async function startAgent(character: Character): Promise<IAgentRuntime> {
  console.log('[AGENT START] Starting agent:', character.name);

  // Generate the proper agent ID from the character name
  const agentId = stringToUuid(character.name);
  console.log('[AGENT START] Generated agent ID:', agentId, 'for character:', character.name);

  console.log('[AGENT START] Using embedding provider:', embeddingProvider);
  console.log('[AGENT START] Using model provider:', modelProvider);

  console.log(
    '[AGENT START] Initial plugins:',
    initialPlugins.map((p) => p.name || 'unnamed').join(', ')
  );

  // Ensure character has proper structure with UUID string
  const cleanCharacter = {
    ...character,
    id: agentId, // Ensure ID is always a string UUID
  };

  // Remove any nested objects that might have been accidentally included
  if (typeof cleanCharacter.id !== 'string') {
    console.warn('[AGENT START] Character ID was not a string, fixing...');
    cleanCharacter.id = agentId;
  }

  // Create the runtime using ElizaAgentRuntime with initial plugins only
  const runtime = new ElizaAgentRuntime({
    agentId,
    character: cleanCharacter,
    plugins: initialPlugins,
  });

  // Define plugin mappings for progressive unlocking
  const pluginMappings: Record<string, Plugin[]> = {
    // Level 1 capabilities
    browser: [allAvailablePlugins.stagehand], // Browser capability uses Stagehand for web automation
    stagehand: [allAvailablePlugins.stagehand], // Alias for backward compatibility

    // Level 2 capabilities
    goals: [allAvailablePlugins.goals],
    todo: [allAvailablePlugins.todo],

    // Level 3 capabilities
    vision: [allAvailablePlugins.vision], // Vision plugin handles both camera and screen capture

    // Level 4 capabilities
    sam: [allAvailablePlugins.sam], // SAM plugin for TTS/audio output

    // Level 5 capabilities
    advanced: [], // Placeholder for future advanced capabilities

    // Level 6 capabilities
    autocoder: [allAvailablePlugins.autocoder],
    code_generation: [allAvailablePlugins.autocoder],
    project_management: [allAvailablePlugins.autocoder],
    'plugin-manager': [allAvailablePlugins.pluginManager],

    // Note: 'shell' is already in initial plugins, no need to register progressively
    // Note: 'naming' is handled by ProgressionTracker, not a plugin capability
  };

  console.log(
    '[AGENT START] AgentRuntime created with initial capabilities and progressive plugin support'
  );

  // Initialize runtime - this will set up database connection AND create the agent via ensureAgentExists
  await runtime.initialize();
  console.log(
    '[AGENT START] Runtime initialized - agent creation handled by runtime.ensureAgentExists()'
  );

  // Register progression services
  await runtime.registerService(CapabilityProgressionService);
  await runtime.registerService(ProgressivePluginService);

  // Get the registered services
  const progressionService =
    runtime.getService<CapabilityProgressionService>('CAPABILITY_PROGRESSION');
  const progressivePluginService =
    runtime.getService<ProgressivePluginService>('PROGRESSIVE_PLUGIN');

  if (progressivePluginService) {
    progressivePluginService.setAvailablePlugins(pluginMappings);
  }

  // Initialize the progression tracker (event listener only)
  if (progressionService) {
    const _progressionTracker = new ProgressionTracker(runtime, progressionService);
  }

  console.log('[AGENT START] Capability progression system initialized');

  return runtime;
}

export async function startServer() {
  // Check for existing database URL in environment variables first
  const envDatabaseUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;

  // Use localhost for local development, eliza-postgres for container environments
  const isContainer =
    process.env.CONTAINER === 'true' ||
    process.env.AGENT_CONTAINER === 'true' ||
    process.env.DOCKER_CONTAINER === 'true' ||
    fs.existsSync('/.dockerenv');
  const postgresHost = isContainer ? 'eliza-postgres:5432' : 'localhost:5432';
  const fallbackDatabaseUrl = `postgresql://eliza:eliza_secure_pass@${postgresHost}/eliza`;

  // Use environment variable if set, otherwise use fallback
  const databaseUrl = envDatabaseUrl || fallbackDatabaseUrl;
  const _dataDir = path.resolve(process.cwd(), 'data');

  // Create and initialize server
  const server = new AgentServer();

  // Make server instance globally available for MessageBusService
  (global as Record<string, unknown>).elizaAgentServer = server;

  // Assign the startAgent method to make it compatible with the lifecycle API
  (server as unknown as Record<string, unknown>).startAgent = async (character: Character) => {
    logger.info('[SERVER] Starting agent via API call:', character.name);
    const runtime = await startAgent(character);
    await server.registerAgent(runtime);
    return runtime;
  };

  console.log(`[BACKEND] Using PostgreSQL database ${databaseUrl}`);

  // In containers, retry initialization to wait for PostgreSQL
  const maxRetries = 30; // 30 seconds total
  let retries = 0;
  let initialized = false;

  while (!initialized && retries < maxRetries) {
    try {
      await server.initialize(databaseUrl);
      initialized = true;
    } catch (error) {
      retries++;
      if (retries < maxRetries) {
        console.log(`[BACKEND] Waiting for PostgreSQL... (${retries}/${maxRetries})`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } else {
        throw new Error(
          `Failed to connect to PostgreSQL after ${maxRetries} attempts: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  // Add file upload middleware for knowledge document uploads
  const fileUpload = await import('express-fileupload');
  server.app.use(
    fileUpload.default({
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max file size
      useTempFiles: true,
      tempFileDir: '/tmp/',
      createParentPath: true,
    }) as any
  );
  console.log('[BACKEND] ✅ All plugin migrations completed');

  // Create and register the default agent BEFORE starting the server
  // This ensures the agent exists when WebSocket messages arrive
  const runtime = await startAgent(terminalCharacter);
  await server.registerAgent(runtime);
  console.log(
    '[BACKEND] ✅ Default agent started and registered successfully with secure configuration'
  );

  // Test the shell service to ensure it's working properly
  console.log('[BACKEND] Testing shell service...');
  try {
    const shellService = runtime.getService('SHELL');
    if (!shellService) {
      console.error('[BACKEND] ❌ Shell service not found! Shell commands will not work.');
    } else {
      console.log('[BACKEND] ✅ Shell service found, running test commands...');

      // Test 1: Execute a simple command
      const result1 = await (shellService as any).executeCommand('pwd');
      console.log('[BACKEND] Test 1 - Current directory:', result1.output.trim());
      console.log('[BACKEND]   Exit code:', result1.exitCode);
      const originalDir = result1.output.trim();

      // Test 2: Change directory to a cross-platform directory
      // Use temp directory which exists on all platforms
      const tempDir = process.platform === 'win32' ? process.env.TEMP || 'C:\\Temp' : '/tmp';
      const result2 = await (shellService as any).executeCommand(`cd ${tempDir}`);
      console.log('[BACKEND] Test 2 - Change directory result:', result2.output.trim());

      // Test 3: Verify directory change persisted
      const result3 = await (shellService as any).executeCommand('pwd');
      console.log('[BACKEND] Test 3 - New working directory:', result3.output.trim());
      console.log(
        '[BACKEND]   Directory change persisted:',
        result3.output.trim().includes(tempDir) ? '✅' : '❌'
      );

      // Test 4: Run a command in the new directory
      const listCmd = process.platform === 'win32' ? 'dir' : 'ls -la';
      const result4 = await (shellService as any).executeCommand(listCmd);
      console.log(
        '[BACKEND] Test 4 - Directory listing executed successfully:',
        result4.exitCode === 0 ? '✅' : '❌'
      );

      // Test 5: Return to original directory
      const result5 = await (shellService as any).executeCommand(`cd ${originalDir}`);
      console.log('[BACKEND] Test 5 - Return to original directory:', result5.output.trim());

      console.log('[BACKEND] ✅ Shell service tests completed successfully');
    }
  } catch (error) {
    console.error('[BACKEND] ❌ Shell service test failed:', error);
  }

  // Start the server on port 7777 AFTER the agent is ready
  const PORT = parseInt(process.env.PORT || '7777', 10);

  await server.start(PORT);
  console.log(`[BACKEND] ✅ Server started on port ${PORT}`);
  console.log(`[BACKEND] Server running at http://localhost:${PORT}`);

  // WebSocket server is already integrated in packages/server at the same port
  console.log(`[BACKEND] WebSocket available at ws://localhost:${PORT}/ws`);

  // Add messaging stub endpoints directly to the server for MessageBusService compatibility
  // These need to be available before the agent starts
  console.log('[BACKEND] Adding messaging stub endpoints...');

  // Plugin Config endpoint
  server.app.get('/api/plugin-config', async (req: Request, res: Response) => {
    try {
      const serverWithAgents = server as unknown as { agents: Map<string, IAgentRuntime> };
      const _targetRuntime = Array.from(serverWithAgents.agents?.values() || [])[0];
      const configurations = {
        environment: {
          OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '***SET***' : 'NOT_SET',
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '***SET***' : 'NOT_SET',
          MODEL_PROVIDER: process.env.MODEL_PROVIDER || 'ollama',
        },
      };
      res.json({ success: true, data: { configurations, availablePlugins: [] } });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  // Generic Capability Toggle endpoint - supports both default and specific agent IDs
  server.app.post(
    '/api/agents/:agentId/capabilities/:capability',
    async (req: Request, res: Response) => {
      try {
        const capability = req.params.capability.toLowerCase();
        let targetRuntime: IAgentRuntime | undefined;

        const serverWithAgents = server as unknown as { agents: Map<string, IAgentRuntime> };

        // Handle "default" as a special case - get the first agent
        if (req.params.agentId === 'default') {
          targetRuntime = Array.from(serverWithAgents.agents?.values() || [])[0];
        } else {
          // Try to get the specific agent by ID (cast to UUID type)
          targetRuntime = serverWithAgents.agents?.get(req.params.agentId as any);
        }

        if (!targetRuntime) {
          return res.status(503).json({
            success: false,
            error: {
              message:
                req.params.agentId === 'default'
                  ? 'No agents available'
                  : `Agent ${req.params.agentId} not found`,
            },
          });
        }

        const capabilityMappings = {
          camera: ['ENABLE_CAMERA', 'VISION_CAMERA_ENABLED'],
          microphone: ['ENABLE_MICROPHONE', 'VISION_MICROPHONE_ENABLED'],
          speakers: ['ENABLE_SPEAKER', 'VISION_SPEAKER_ENABLED'],
          screen: ['ENABLE_SCREEN_CAPTURE', 'VISION_SCREEN_ENABLED'],
          shell: ['ENABLE_SHELL', 'SHELL_ENABLED'],
          browser: ['ENABLE_BROWSER', 'BROWSER_ENABLED'],
          autonomy: ['AUTONOMY_ENABLED', 'ENABLE_AUTONOMY'],
        };

        if (!capabilityMappings[capability as keyof typeof capabilityMappings]) {
          return res
            .status(400)
            .json({ success: false, error: { message: `Unknown capability: ${capability}` } });
        }

        const settings = capabilityMappings[capability as keyof typeof capabilityMappings];
        const currentlyEnabled = settings.some(
          (setting: string) =>
            targetRuntime.getSetting(setting) === 'true' ||
            targetRuntime.getSetting(setting) === true
        );

        const newState = !currentlyEnabled;
        settings.forEach((setting: string) => {
          targetRuntime.setSetting(setting, newState.toString());
        });

        res.json({
          success: true,
          data: {
            enabled: newState,
            capability,
            settings_updated: settings,
            agentId: targetRuntime.agentId,
          },
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        res.status(500).json({ success: false, error: { message: errorMessage } });
      }
    }
  );

  // GET primary agent endpoint - returns the first available agent
  server.app.get('/api/agents/primary', async (req: Request, res: Response) => {
    try {
      const primaryAgent = Array.from(server.agents?.values() || [])[0] as
        | IAgentRuntime
        | undefined;

      if (!primaryAgent) {
        return res.status(200).json({
          success: true,
          data: {
            available: false,
            message: 'No agents loaded yet',
          },
        });
      }

      res.json({
        success: true,
        data: {
          available: true,
          agentId: primaryAgent.agentId,
          agentName: primaryAgent.character?.name || 'Unknown Agent',
          // Include the actual endpoints the frontend should use
          endpoints: {
            settings: `/api/agents/${primaryAgent.agentId}/settings`,
            capabilities: `/api/agents/${primaryAgent.agentId}/capabilities`,
            vision: `/api/agents/${primaryAgent.agentId}/vision`,
          },
        },
      });
    } catch (error) {
      console.error('[API] Error getting primary agent:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  // GET list of agents endpoint
  server.app.get('/api/agents', async (req: Request, res: Response) => {
    try {
      const agentEntries = Array.from(server.agents?.entries() || []) as Array<
        [string, IAgentRuntime]
      >;
      const agents = agentEntries.map(([id, runtime]) => ({
        id,
        name: runtime.character?.name || 'Unknown Agent',
        ready: true,
      }));

      res.json({
        success: true,
        data: {
          agents,
          count: agents.length,
        },
      });
    } catch (error) {
      console.error('[API] Error listing agents:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  // GET default agent settings endpoint - specific route to bypass UUID validation
  server.app.get('/api/agents/default/settings', async (req: Request, res: Response) => {
    try {
      // Get the first available agent
      const targetRuntime = Array.from(server.agents?.values() || [])[0] as IAgentRuntime;

      if (!targetRuntime) {
        // Return a minimal response indicating server is ready but no agent yet
        return res.status(200).json({
          success: true,
          data: {
            gameApiReady: true,
            agentReady: false,
            message: 'Server is running, agent initializing',
          },
        });
      }

      // Get common settings
      const settings: Record<string, unknown> = {};
      const commonSettingKeys = [
        'ENABLE_CAMERA',
        'ENABLE_SCREEN_CAPTURE',
        'ENABLE_MICROPHONE',
        'ENABLE_SPEAKER',
        'VISION_CAMERA_ENABLED',
        'VISION_SCREEN_ENABLED',
        'VISION_MICROPHONE_ENABLED',
        'VISION_SPEAKER_ENABLED',
        'AUTONOMY_ENABLED',
        'SHELL_ENABLED',
        'BROWSER_ENABLED',
      ];

      commonSettingKeys.forEach((key) => {
        const value = targetRuntime.getSetting(key);
        if (value !== undefined) {
          settings[key] = value;
        }
      });

      res.json({
        success: true,
        data: {
          ...settings,
          agentId: targetRuntime.agentId,
          agentName: targetRuntime.character?.name || 'Unknown Agent',
          gameApiReady: true,
          agentReady: true,
        },
      });
    } catch (error) {
      console.error('[API] Error retrieving default agent settings:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  // GET settings endpoint - supports both /api/agents/default/settings and /api/agents/:agentId/settings
  // Progression status endpoint
  server.app.get('/api/agents/:agentId/progression', async (req: Request, res: Response) => {
    try {
      let targetRuntime: IAgentRuntime | undefined;

      // Handle "default" as a special case - get the first agent
      if (req.params.agentId === 'default') {
        targetRuntime = Array.from(server.agents?.values() || [])[0] as IAgentRuntime;
      } else {
        // Try to get the specific agent by ID
        targetRuntime = server.agents?.get(req.params.agentId as any);
      }

      if (!targetRuntime) {
        return res.status(200).json({
          success: true,
          data: {
            progressionReady: false,
            message:
              req.params.agentId === 'default'
                ? 'No agents available yet'
                : `Agent ${req.params.agentId} not found`,
          },
        });
      }

      // Get progression service from the runtime
      const progressionService =
        targetRuntime.getService<CapabilityProgressionService>('CAPABILITY_PROGRESSION');
      if (!progressionService) {
        return res.status(200).json({
          success: true,
          data: {
            progressionReady: false,
            message: 'Progression system not initialized',
          },
        });
      }

      const progressionStatus = {
        progressionReady: true,
        ...progressionService.getProgressionState(),
        unlockedCapabilities: progressionService.getUnlockedCapabilities(),
        progressionMode: progressionService.isUnlockedModeEnabled() ? 'unlocked' : 'progression',
      };

      res.json({
        success: true,
        data: {
          agentId: targetRuntime.agentId,
          agentName: targetRuntime.character?.name || 'Unknown Agent',
          ...progressionStatus,
        },
      });
    } catch (error) {
      console.error('[API] Error retrieving progression status:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  // POST endpoint to switch progression mode
  server.app.post('/api/agents/:agentId/progression/mode', async (req: Request, res: Response) => {
    try {
      let targetRuntime: IAgentRuntime | undefined;

      // Handle "default" as a special case - get the first agent
      if (req.params.agentId === 'default') {
        targetRuntime = Array.from(server.agents?.values() || [])[0] as IAgentRuntime;
      } else {
        // Try to get the specific agent by ID
        targetRuntime = server.agents?.get(req.params.agentId as any);
      }

      if (!targetRuntime) {
        return res.status(404).json({
          success: false,
          error: {
            message:
              req.params.agentId === 'default'
                ? 'No agents available'
                : `Agent ${req.params.agentId} not found`,
          },
        });
      }

      // Get the mode from request body
      const { mode } = req.body;
      if (!mode || !['progression', 'unlocked'].includes(mode)) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Invalid mode. Must be either "progression" or "unlocked"',
          },
        });
      }

      // Get progression service from the runtime
      const progressionService =
        targetRuntime.getService<CapabilityProgressionService>('CAPABILITY_PROGRESSION');
      if (!progressionService) {
        return res.status(503).json({
          success: false,
          error: {
            message: 'Progression service not available',
          },
        });
      }

      // Switch the mode
      await progressionService.setProgressionMode(mode);

      // Get updated status
      const progressionStatus = {
        progressionReady: true,
        ...progressionService.getProgressionState(),
        unlockedCapabilities: progressionService.getUnlockedCapabilities(),
        progressionMode: progressionService.isUnlockedModeEnabled() ? 'unlocked' : 'progression',
      };

      res.json({
        success: true,
        data: {
          mode,
          message: `Progression mode switched to ${mode}`,
          agentId: targetRuntime.agentId,
          agentName: targetRuntime.character?.name || 'Unknown Agent',
          ...progressionStatus,
        },
      });
    } catch (error) {
      console.error('[API] Error switching progression mode:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  server.app.get('/api/agents/:agentId/settings', async (req: Request, res: Response) => {
    try {
      let targetRuntime: IAgentRuntime | undefined;

      // Handle "default" as a special case - get the first agent
      if (req.params.agentId === 'default') {
        targetRuntime = Array.from(server.agents?.values() || [])[0] as IAgentRuntime;
      } else {
        // Try to get the specific agent by ID
        targetRuntime = server.agents?.get(req.params.agentId as any);
      }

      if (!targetRuntime) {
        // Return a response indicating no agent found
        return res.status(200).json({
          success: true,
          data: {
            gameApiReady: true,
            agentReady: false,
            agentId: req.params.agentId,
            message:
              req.params.agentId === 'default'
                ? 'No agents available yet'
                : `Agent ${req.params.agentId} not found`,
          },
        });
      }

      // Get common settings
      const settings: Record<string, unknown> = {};
      const commonSettingKeys = [
        'ENABLE_CAMERA',
        'ENABLE_SCREEN_CAPTURE',
        'ENABLE_MICROPHONE',
        'ENABLE_SPEAKER',
        'VISION_CAMERA_ENABLED',
        'VISION_SCREEN_ENABLED',
        'VISION_MICROPHONE_ENABLED',
        'VISION_SPEAKER_ENABLED',
        'AUTONOMY_ENABLED',
        'SHELL_ENABLED',
        'BROWSER_ENABLED',
      ];

      commonSettingKeys.forEach((key) => {
        const value = targetRuntime.getSetting(key);
        if (value !== undefined) {
          settings[key] = value;
        }
      });

      res.json({
        success: true,
        data: {
          ...settings,
          agentId: targetRuntime.agentId,
          agentName: targetRuntime.character?.name || 'Unknown Agent',
          gameApiReady: true,
          agentReady: true,
        },
      });
    } catch (error) {
      console.error('[API] Error retrieving settings:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  // POST endpoint to track action execution for progression
  server.app.post('/api/agents/:agentId/track-action', async (req: Request, res: Response) => {
    try {
      let targetRuntime: IAgentRuntime | undefined;

      // Handle "default" as a special case - get the first agent
      if (req.params.agentId === 'default') {
        targetRuntime = Array.from(server.agents?.values() || [])[0] as IAgentRuntime;
      } else {
        // Try to get the specific agent by ID
        targetRuntime = server.agents?.get(req.params.agentId as any);
      }

      if (!targetRuntime) {
        return res.status(404).json({
          success: false,
          error: {
            message:
              req.params.agentId === 'default'
                ? 'No agents available'
                : `Agent ${req.params.agentId} not found`,
          },
        });
      }

      const { action, details } = req.body;
      if (!action) {
        return res.status(400).json({
          success: false,
          error: {
            message: 'Action type is required',
          },
        });
      }

      // Emit event for the action instead of direct tracking
      // This follows the event-driven pattern
      switch (action) {
        case 'form_submitted':
          await targetRuntime.emitEvent('FORM_SUBMITTED', { details });
          break;
        case 'browser_used':
          await targetRuntime.emitEvent('BROWSER_ACTION_PERFORMED', { action, details });
          break;
        case 'vision_used':
          await targetRuntime.emitEvent('VISION_ACTION_PERFORMED', { action, details });
          break;
        case 'microphone_used':
          await targetRuntime.emitEvent('MICROPHONE_USED', { details });
          break;
        case 'shell_command':
          await targetRuntime.emitEvent('SHELL_COMMAND_EXECUTED', {
            command: details?.command,
            exitCode: details?.exitCode || 0,
          });
          break;
        case 'goal_created':
          await targetRuntime.emitEvent('GOAL_CREATED', { goalData: details });
          break;
        case 'todo_created':
          await targetRuntime.emitEvent('TODO_CREATED', { todoData: details });
          break;
        case 'agent_named':
          await targetRuntime.emitEvent('AGENT_NAMED', { name: details?.name });
          break;
        default:
          // For generic capability usage
          await targetRuntime.emitEvent('CAPABILITY_USED', { capability: action, details });
          break;
      }

      res.json({
        success: true,
        data: {
          action,
          tracked: true,
          agentId: targetRuntime.agentId,
        },
      });
    } catch (error) {
      console.error('[API] Error tracking action:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      res.status(500).json({ success: false, error: { message: errorMessage } });
    }
  });

  return server;
}

// Start the server only if this file is run directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer().catch((error) => {
    console.error('[BACKEND] Fatal error:', error);
    process.exit(1);
  });
}
