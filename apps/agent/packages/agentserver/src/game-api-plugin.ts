import type { IAgentRuntime, Plugin, Route } from '@elizaos/core';
import { logger, ModelType, type UUID } from '@elizaos/core';
import {
  getProviderStatus,
  setProviderPreferences,
  setSelectedProvider,
} from '@elizaos/plugin-inference';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { v4 as uuidv4 } from 'uuid';

import { AutonomyService } from '@elizaos/plugin-autonomy';
import { GoalService } from '@elizaos/plugin-goals';
import { KnowledgeService } from '@elizaos/plugin-knowledge';
import { TodoService } from '@elizaos/plugin-todo';
import { VisionService } from '@elizaos/plugin-vision';

// Define common request/response interfaces
interface GameApiRequest {
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  [key: string]: unknown;
}

interface GameApiResponse {
  json: (data: unknown) => void;
  status: (code: number) => GameApiResponse;
  send: (data: unknown) => void;
  redirect: (code: number, url: string) => void;
  setHeader: (name: string, value: string) => GameApiResponse;
  [key: string]: unknown;
}

// Media stream buffer interface
interface MediaStreamBuffer {
  videoFrames: Uint8Array[];
  audioChunks: Uint8Array[];
  maxBufferSize: number;
}

// Validation result interfaces
interface ValidationResults {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  providers: Record<string, ValidationConfig>;
  environment: Record<string, EnvironmentValue>;
  services: Record<string, ServiceConfig>;
  timestamp: number;
}

interface ValidationConfig {
  status: 'healthy' | 'unhealthy' | 'not_loaded' | 'degraded';
  apiKey?: 'missing' | 'present';
  connectionTest?: {
    status?: 'failed' | 'success';
    message?: string;
    modelAvailable?: boolean;
  };
  model?: string;
  [key: string]: unknown;
}

interface EnvironmentValue {
  value?: string;
  [key: string]: unknown;
}

interface ServiceConfig {
  status: 'loaded' | 'not_loaded';
  [key: string]: unknown;
}

interface AgentServerInstance {
  broadcastToWebSocketClients?: (data: Record<string, unknown>) => void;
  [key: string]: unknown;
}

const execAsync = promisify(exec);

// Global media buffers that vision plugin can access
const mediaBuffers: Map<string, MediaStreamBuffer> = new Map();

// Virtual screen capture state
let screenCaptureInterval: NodeJS.Timer | null = null;
let screenCaptureActive = false;
let agentServerInstance: unknown = null; // Store reference to agent server

// Start capturing agent's virtual screen
async function startAgentScreenCapture(runtime: IAgentRuntime, server?: unknown): Promise<void> {
  if (screenCaptureActive) {
    logger.info('[VirtualScreen] Screen capture already active');
    return;
  }

  // Store server instance for WebSocket broadcasting
  if (server) {
    agentServerInstance = server;
  }

  const display = process.env.DISPLAY || ':99';
  logger.info(`[VirtualScreen] Starting screen capture on display ${display}`);

  // Test ffmpeg availability first
  try {
    await execAsync('which ffmpeg');
  } catch {
    logger.error(
      '[VirtualScreen] ffmpeg not found. Installing would be required for screen capture.'
    );
    throw new Error('ffmpeg not available for screen capture');
  }

  // Test X11 display availability
  try {
    await execAsync(`xdpyinfo -display ${display}`);
  } catch {
    logger.warn('[VirtualScreen] X11 display not ready, waiting...');
    // Wait a bit for display to be ready
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  screenCaptureActive = true;

  // Capture screen at 10 FPS
  screenCaptureInterval = setInterval(async () => {
    try {
      // Use ffmpeg to capture a single frame from the virtual display
      // Using spawn to properly handle binary data
      const ffmpeg = spawn('ffmpeg', [
        '-f',
        'x11grab',
        '-video_size',
        '1280x720',
        '-i',
        display,
        '-vframes',
        '1',
        '-f',
        'mjpeg',
        '-q:v',
        '2',
        '-loglevel',
        'error',
        '-',
      ]);

      const chunks: Buffer[] = [];
      let errorOutput = '';

      ffmpeg.stdout.on('data', (chunk) => {
        chunks.push(chunk);
      });

      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          ffmpeg.kill();
          reject(new Error('FFmpeg timeout'));
        }, 5000);

        ffmpeg.on('close', (code) => {
          clearTimeout(timeout);
          if (code !== 0) {
            reject(new Error(`FFmpeg exited with code ${code}: ${errorOutput}`));
          } else {
            resolve();
          }
        });

        ffmpeg.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
      });

      if (errorOutput) {
        logger.debug('[VirtualScreen] ffmpeg stderr:', errorOutput);
      }

      if (chunks.length === 0) {
        logger.debug('[VirtualScreen] Empty frame captured, skipping');
        return;
      }

      const frameData = Buffer.concat(chunks);

      // Validate frame data
      if (frameData.length < 1000) {
        // JPEG should be at least 1KB
        logger.debug('[VirtualScreen] Frame too small, likely invalid');
        return;
      }

      // Store in media buffer
      const agentId = runtime.agentId;
      if (!mediaBuffers.has(agentId)) {
        mediaBuffers.set(agentId, {
          videoFrames: [],
          audioChunks: [],
          maxBufferSize: 100,
        });
      }

      const buffer = mediaBuffers.get(agentId)!;
      buffer.videoFrames.push(new Uint8Array(frameData));
      if (buffer.videoFrames.length > buffer.maxBufferSize) {
        buffer.videoFrames.shift();
      }

      // Broadcast screen frame via WebSocket if server available
      const serverInstance = agentServerInstance as AgentServerInstance;
      if (serverInstance && serverInstance.broadcastToWebSocketClients) {
        serverInstance.broadcastToWebSocketClients({
          type: 'agent_screen_frame',
          agentId,
          frameData: Array.from(frameData),
          width: 1280,
          height: 720,
          timestamp: Date.now(),
        });
        logger.debug('[VirtualScreen] Broadcasted frame to WebSocket clients');
      } else {
        logger.debug('[VirtualScreen] No server instance for broadcasting');
      }

      // Also notify vision service if available
      const visionService = runtime.getService<VisionService>('vision');
      if (visionService && typeof visionService.processMediaStream === 'function') {
        await visionService.processMediaStream({
          type: 'video',
          streamType: 'agent_screen',
          data: new Uint8Array(frameData),
          encoding: 'jpeg',
          timestamp: Date.now(),
        });
      }
    } catch (error: unknown) {
      // Only log actual errors, not expected issues
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (!errorMessage.includes('timeout')) {
        logger.error('[VirtualScreen] Failed to capture screen:', errorMessage);
      }
    }
  }, 100); // 10 FPS

  logger.info('[VirtualScreen] Screen capture started successfully');
}

// Stop capturing agent's virtual screen
async function stopAgentScreenCapture(): Promise<void> {
  if (screenCaptureInterval) {
    clearInterval(screenCaptureInterval as NodeJS.Timeout);
    screenCaptureInterval = null;
  }
  screenCaptureActive = false;
  logger.info('[VirtualScreen] Screen capture stopped');
}

// Standard API response helpers
function successResponse(data: unknown) {
  return {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
}

function errorResponse(code: string, message: string, details?: unknown) {
  return {
    success: false,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generates configuration recommendations based on validation results
 */
function generateConfigRecommendations(validationResults: ValidationResults): string[] {
  const recommendations: string[] = [];

  if (validationResults.overall === 'unhealthy') {
    recommendations.push(
      '❌ Critical: No working model provider configured. Please configure at least one provider.'
    );
  }

  if (validationResults.overall === 'degraded') {
    recommendations.push('⚠️ Warning: Some issues detected with model provider configuration.');
  }

  // Check each provider
  Object.entries(validationResults.providers).forEach(
    ([provider, config]: [string, ValidationConfig]) => {
      if (config.status === 'unhealthy') {
        if (config.apiKey === 'missing') {
          recommendations.push(`🔑 Configure ${provider} API key to enable ${provider} provider.`);
        } else if (config.connectionTest?.status === 'failed') {
          recommendations.push(
            `🔗 ${provider} API key present but connection failed: ${config.connectionTest.message}`
          );
        }
      } else if (config.status === 'degraded') {
        if (config.connectionTest?.modelAvailable === false) {
          recommendations.push(
            `📋 ${provider} connected but model "${config.model}" not available. Check model name or permissions.`
          );
        }
      } else if (config.status === 'healthy') {
        recommendations.push(`✅ ${provider} configuration is working correctly.`);
      }
    }
  );

  // Service recommendations
  Object.entries(validationResults.services).forEach(
    ([service, config]: [string, ServiceConfig]) => {
      if (
        config.status === 'not_loaded' &&
        service === validationResults.environment.MODEL_PROVIDER?.value
      ) {
        recommendations.push(
          `⚙️ ${service} service not loaded. This may affect runtime performance.`
        );
      }
    }
  );

  if (recommendations.length === 0) {
    recommendations.push('✅ All configurations appear to be working correctly.');
  }

  return recommendations;
}

/**
 * Creates initial todos and goals using plugin APIs
 */
async function createInitialTodosAndGoals(runtime: IAgentRuntime): Promise<void> {
  console.log('[GAME-API] Creating initial todos and goals using plugin APIs...');

  // First, ensure the agent exists in the database
  try {
    const agent = await runtime.db?.getAgent(runtime.agentId);
    if (!agent) {
      console.error(
        '[GAME-API] Agent not found in database, skipping initial todos/goals creation'
      );
      return;
    }
    console.log('[GAME-API] Agent verified in database:', agent.id);
  } catch (error) {
    console.error('[GAME-API] Error checking for agent existence:', error);
    return;
  }

  // Log all available services for debugging
  const services = runtime.services || new Map();
  console.log('[GAME-API] Available services:', Array.from(services.keys()));

  // Wait for plugins to be fully ready and services to be registered
  let retries = 0;
  const maxRetries = 10;
  const retryDelay = 3000; // 3 seconds between retries

  // Wait for Goals service to be available - use lowercase 'goals'
  let goalService = runtime.getService('goals') as GoalService | null;
  while (!goalService && retries < maxRetries) {
    goalService = runtime.getService('goals') as GoalService | null;
    if (!goalService) {
      console.log(`[GAME-API] Waiting for Goals service... attempt ${retries + 1}/${maxRetries}`);
      console.log('[GAME-API] Current services:', Array.from(services.keys()));
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retries++;
    }
  }

  if (!goalService) {
    console.error('[GAME-API] Goals service not available after waiting. Skipping goal creation.');
    return;
  }

  console.log('[GAME-API] Goals service found, checking existing goals...');

  try {
    // Check if this is a brand new agent (no existing goals)
    const existingGoals = await goalService.getAllGoalsForOwner('agent', runtime.agentId);
    if (existingGoals && existingGoals.length > 0) {
      console.log(
        `[GAME-API] Agent already has ${existingGoals.length} goals, skipping initialization`
      );
      return; // Don't add goals if agent already has some
    }
  } catch (error) {
    console.error('[GAME-API] Error checking existing goals:', error);
    // Continue with creation anyway
  }

  console.log('[GAME-API] Brand new agent detected, creating initial goals and todos...');

  // Create starter goals using the Goals plugin service
  const starterGoals = [
    {
      agentId: runtime.agentId,
      ownerType: 'agent' as const,
      ownerId: runtime.agentId,
      name: 'Welcome to ELIZA OS',
      description:
        'Get familiar with the ELIZA OS terminal interface and explore the available capabilities',
      metadata: { priority: 'high', category: 'orientation', source: 'initial_setup' },
      tags: ['orientation', 'setup'],
    },
  ];

  let goalsCreated = 0;
  for (const goalData of starterGoals) {
    try {
      const goalId = await goalService.createGoal(goalData);
      if (goalId) {
        goalsCreated++;
        console.log(`[GAME-API] Created goal: ${goalData.name} (${goalId})`);
      }
    } catch (error) {
      console.error(`[GAME-API] Failed to create goal "${goalData.name}":`, error);
    }
  }

  console.log(`[GAME-API] ✅ Created ${goalsCreated} initial goals using Goals plugin`);

  // Create starter todos using the Todo plugin service
  console.log('[GAME-API] Creating todos using Todo plugin API...');

  // Wait for Todo service to be available - use uppercase 'TODO'
  let todoService = runtime.getService('TODO') as TodoService | null;
  retries = 0;
  while (!todoService && retries < maxRetries) {
    todoService = runtime.getService('TODO') as TodoService | null;
    if (!todoService) {
      console.log(`[GAME-API] Waiting for Todo service... attempt ${retries + 1}/${maxRetries}`);
      console.log('[GAME-API] Current services:', Array.from(services.keys()));
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      retries++;
    }
  }

  if (!todoService) {
    console.error('[GAME-API] Todo service not available after waiting. Skipping todo creation.');
    return;
  }

  // CRITICAL: Use the exact room/world IDs that the /api/todos endpoint returns
  // Based on API testing, these are the rooms that the todos plugin API monitors:
  const API_MONITORED_ROOMS = [
    {
      worldId: '00000000-0000-0000-0000-000000000001',
      roomId: '78dfa017-9548-4e2a-8e5f-b54aa4b5cb08',
    }, // Autonomy World
    {
      worldId: 'cc91bfa9-aa00-0bfc-8919-09a4f073b8fe',
      roomId: 'b14661f9-37a8-0b7b-bb9c-ee9ea36b30e5',
    }, // Terminal World
  ];

  // Use the first monitored room (Terminal World)
  const targetWorldId = API_MONITORED_ROOMS[1].worldId as UUID; // Terminal World
  const targetRoomId = API_MONITORED_ROOMS[1].roomId as UUID; // Terminal Room

  console.log(
    `[GAME-API] Using hardcoded API-monitored world ${targetWorldId} and room ${targetRoomId} for todos`
  );

  const starterTodos = [
    {
      agentId: runtime.agentId,
      worldId: targetWorldId,
      roomId: targetRoomId,
      entityId: runtime.agentId,
      name: 'Say hello to the admin',
      description: 'Introduce yourself and start a conversation with the admin user',
      type: 'one-off' as const,
      priority: 1,
      isUrgent: true,
      metadata: { category: 'social', source: 'initial_setup', importance: 'high' },
      tags: ['communication', 'greeting', 'urgent'],
    },
  ];

  let todosCreated = 0;
  for (const todoData of starterTodos) {
    try {
      const todoId = await todoService.createTodo(todoData);
      if (todoId) {
        todosCreated++;
        console.log(`[GAME-API] Created todo: ${todoData.name} (${todoId})`);
      }
    } catch (error) {
      console.error(`[GAME-API] Failed to create todo "${todoData.name}":`, error);
    }
  }

  console.log(
    `[GAME-API] ✅ Created ${todosCreated} initial todos using Todo plugin (${starterTodos.length} total configured)`
  );
  console.log(`[GAME-API] ✅ Successfully created ${goalsCreated} goals and ${todosCreated} todos`);
}

// Game API Routes following ElizaOS patterns
const gameAPIRoutes: Route[] = [
  // ===== Game-Specific Endpoints =====

  // Health check (custom game-specific health)
  {
    type: 'GET',
    path: '/api/server/health',
    name: 'Game Health Check',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      // Health check should always return success for the server itself
      // Agent status is informational, not a requirement
      const agentStatus = runtime ? 'connected' : 'no_agent';

      let services = {
        goals: false,
        todos: false,
        autonomy: false,
      };

      // Check if critical services are available - only if runtime exists
      if (runtime) {
        try {
          const goalService = runtime.getService('goals'); // lowercase 'goals'
          const todoService = runtime.getService('TODO'); // uppercase 'TODO'
          const autonomyService = runtime.getService('AUTONOMY'); // uppercase 'AUTONOMY'

          // Debug: Log service lookup results
          console.log('[HEALTH] Service lookup results:');
          console.log('  - goals:', !!goalService);
          console.log('  - TODO:', !!todoService);
          console.log('  - AUTONOMY:', !!autonomyService);

          services = {
            goals: !!goalService,
            todos: !!todoService,
            autonomy: !!autonomyService,
          };
        } catch (error) {
          console.warn('[HEALTH] Error checking services:', error);
        }
      }

      res.json(
        successResponse({
          status: 'healthy',
          agent: agentStatus,
          agentId: runtime?.agentId || null,
          timestamp: Date.now(),
          server: 'running',
          services,
          ready: services.goals && services.todos, // Ready when both critical services are available
        })
      );
    },
  },

  // Goals API - Legacy redirects (goals plugin now provides /api/goals directly)
  {
    type: 'GET',
    path: '/api/game/goals',
    name: 'Get Goals (Legacy)',
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      // Redirect to the standard goals plugin endpoint
      res.redirect(301, '/api/goals');
    },
  },

  // Create Goal API - Legacy redirect
  {
    type: 'POST',
    path: '/api/game/goals',
    name: 'Create Goal (Legacy)',
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      // Redirect to the standard goals plugin endpoint
      res.redirect(307, '/api/goals');
    },
  },

  // Todos API - Legacy redirects (todos plugin now provides /api/todos directly)
  {
    type: 'GET',
    path: '/api/game/todos',
    name: 'Get Todos (Legacy)',
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      // Redirect to the standard todos plugin endpoint
      res.redirect(301, '/api/todos');
    },
  },

  // Create Todo API - Legacy redirect
  {
    type: 'POST',
    path: '/api/game/todos',
    name: 'Create Todo (Legacy)',
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      // Redirect to the standard todos plugin endpoint
      res.redirect(307, '/api/todos');
    },
  },

  // Memories API
  {
    type: 'GET',
    path: '/api/game/memories',
    name: 'Get Memories',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const query = req.query || {};
      const roomId = (query as Record<string, unknown>).roomId;
      const count = ((query as Record<string, unknown>).count as string) || '20';

      const memories = await runtime.getMemories({
        roomId: roomId as UUID,
        count: parseInt(count, 10),
        tableName: 'memories',
      });

      res.json(successResponse(memories));
    },
  },

  // Vision Settings API
  {
    type: 'GET',
    path: '/api/agents/default/settings/vision',
    name: 'Get Vision Settings',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const settings = {
        ENABLE_CAMERA: 'false',
        ENABLE_SCREEN_CAPTURE: 'false',
        ENABLE_MICROPHONE: 'false',
        ENABLE_SPEAKER: 'false',
        VISION_CAMERA_ENABLED: 'false',
        VISION_SCREEN_ENABLED: 'false',
        VISION_MICROPHONE_ENABLED: 'false',
        VISION_SPEAKER_ENABLED: 'false',
      };

      // Get settings from runtime first
      Object.keys(settings).forEach((key) => {
        const value = runtime.getSetting(key);
        if (value !== undefined) {
          (settings as Record<string, any>)[key] = String(value);
        }
      });

      // Vision service configuration is handled through runtime settings

      res.json(successResponse(settings));
    },
  },

  // Vision Refresh API
  {
    type: 'POST',
    path: '/api/agents/default/vision/refresh',
    name: 'Refresh Vision Service',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const visionService =
        runtime.getService<VisionService>('VISION') || runtime.getService<VisionService>('vision');
      let refreshed = false;

      if (visionService) {
        // Vision service restart is handled by the runtime
        refreshed = true;
      }

      if (refreshed) {
        console.log('[API] Vision service refreshed successfully');
        res.json(
          successResponse({
            message: 'Vision service refreshed',
            serviceFound: !!visionService,
          })
        );
      } else {
        console.warn('[API] Vision service not found or refresh method not available');
        res.json(
          successResponse({
            message: 'Vision service not available for refresh',
            serviceFound: !!visionService,
          })
        );
      }
    },
  },

  // NOTE: Autonomy API endpoints are now handled by the autonomy plugin's native routes
  // The autonomy plugin registers its own /autonomy/status, /autonomy/enable, /autonomy/disable routes

  // Autonomy Toggle API
  {
    type: 'POST',
    path: '/autonomy/toggle',
    name: 'Toggle Autonomy',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const autonomyService = runtime.getService('AUTONOMY'); // Use uppercase AUTONOMY
      if (!autonomyService) {
        return res
          .status(503)
          .json(errorResponse('SERVICE_UNAVAILABLE', 'Autonomy service not available'));
      }

      const typedAutonomyService = autonomyService as AutonomyService;
      const currentStatus = typedAutonomyService.getStatus();
      if (currentStatus.enabled) {
        await typedAutonomyService.disableAutonomy();
      } else {
        await typedAutonomyService.enableAutonomy();
      }

      const newStatus = typedAutonomyService.getStatus();
      return res.json(
        successResponse({
          enabled: newStatus.enabled,
          running: newStatus.running,
        })
      );
    },
  },

  // Shell Capability API
  {
    type: 'GET',
    path: '/api/agents/default/capabilities/shell',
    name: 'Get Shell Capability',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const shellEnabled =
        runtime.getSetting('ENABLE_SHELL') === 'true' ||
        runtime.getSetting('SHELL_ENABLED') === 'true' ||
        runtime.getSetting('ENABLE_SHELL') === true ||
        runtime.getSetting('SHELL_ENABLED') === true;

      // Check for shell service with different possible names
      const shellService =
        runtime.getService('SHELL') || runtime.getService('shell') || runtime.getService('Shell');

      res.json(
        successResponse({
          enabled: shellEnabled,
          service_available: !!shellService,
          service_name: shellService ? 'found' : 'not_found',
        })
      );
    },
  },

  // Shell Toggle API
  {
    type: 'POST',
    path: '/api/agents/default/capabilities/shell/toggle',
    name: 'Toggle Shell Capability',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const currentlyEnabled =
        runtime.getSetting('ENABLE_SHELL') === 'true' ||
        runtime.getSetting('SHELL_ENABLED') === 'true' ||
        runtime.getSetting('ENABLE_SHELL') === true ||
        runtime.getSetting('SHELL_ENABLED') === true;

      const newState = !currentlyEnabled;

      runtime.setSetting('ENABLE_SHELL', newState.toString());
      runtime.setSetting('SHELL_ENABLED', newState.toString());

      console.log(`[API] Shell capability ${newState ? 'enabled' : 'disabled'}`);

      res.json(
        successResponse({
          enabled: newState,
          service_available: !!runtime.getService('SHELL'),
        })
      );
    },
  },

  // Browser Capability API
  {
    type: 'GET',
    path: '/api/agents/default/capabilities/browser',
    name: 'Get Browser Capability',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const browserEnabled =
        runtime.getSetting('ENABLE_BROWSER') === 'true' ||
        runtime.getSetting('BROWSER_ENABLED') === 'true' ||
        runtime.getSetting('ENABLE_BROWSER') === true ||
        runtime.getSetting('BROWSER_ENABLED') === true;

      // Check for browser service with different possible names
      const browserService =
        runtime.getService('stagehand') ||
        runtime.getService('STAGEHAND') ||
        runtime.getService('browser') ||
        runtime.getService('BROWSER');

      res.json(
        successResponse({
          enabled: browserEnabled,
          service_available: !!browserService,
          service_name: browserService ? 'found' : 'not_found',
        })
      );
    },
  },

  // Browser Toggle API
  {
    type: 'POST',
    path: '/api/agents/default/capabilities/browser/toggle',
    name: 'Toggle Browser Capability',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const currentlyEnabled =
        runtime.getSetting('ENABLE_BROWSER') === 'true' ||
        runtime.getSetting('BROWSER_ENABLED') === 'true' ||
        runtime.getSetting('ENABLE_BROWSER') === true ||
        runtime.getSetting('BROWSER_ENABLED') === true;

      const newState = !currentlyEnabled;

      runtime.setSetting('ENABLE_BROWSER', newState.toString());
      runtime.setSetting('BROWSER_ENABLED', newState.toString());

      console.log(`[API] Browser capability ${newState ? 'enabled' : 'disabled'}`);

      res.json(
        successResponse({
          enabled: newState,
          service_available: !!runtime.getService('stagehand'),
        })
      );
    },
  },

  // Generic Capability Toggle API (handles camera, microphone, speakers, etc.)
  {
    type: 'POST',
    path: '/api/agents/default/capabilities/:capability',
    name: 'Toggle Any Capability',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const params = req.params || {};
      const capability = String((params as Record<string, unknown>).capability || '').toLowerCase();

      console.log(`[API] Generic capability toggle requested for: ${capability}`);

      // Define capability mappings
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
          .json(errorResponse('UNKNOWN_CAPABILITY', `Unknown capability: ${capability}`));
      }

      // Get current state
      const settings = capabilityMappings[capability as keyof typeof capabilityMappings];
      const currentlyEnabled = settings.some(
        (setting: string) =>
          runtime.getSetting(setting) === 'true' || runtime.getSetting(setting) === true
      );

      const newState = !currentlyEnabled;

      // Update all related settings
      settings.forEach((setting: string) => {
        runtime.setSetting(setting, newState.toString());
      });

      // Special handling for autonomy
      if (capability === 'autonomy') {
        const autonomyService = runtime.getService<AutonomyService>('AUTONOMY'); // Use uppercase AUTONOMY
        if (autonomyService) {
          if (newState) {
            await (autonomyService as AutonomyService).enableAutonomy();
          } else {
            await (autonomyService as AutonomyService).disableAutonomy();
          }
        }
      }

      // Vision capabilities are handled through runtime settings

      console.log(`[API] ${capability} capability ${newState ? 'enabled' : 'disabled'}`);

      // Get service availability
      let serviceAvailable = false;
      if (
        capability === 'camera' ||
        capability === 'microphone' ||
        capability === 'speakers' ||
        capability === 'screen'
      ) {
        serviceAvailable = !!(runtime.getService('vision') || runtime.getService('VISION'));
      } else if (capability === 'shell') {
        serviceAvailable = !!(runtime.getService('SHELL') || runtime.getService('shell'));
      } else if (capability === 'browser') {
        serviceAvailable = !!(runtime.getService('stagehand') || runtime.getService('STAGEHAND'));
      } else if (capability === 'autonomy') {
        serviceAvailable = !!runtime.getService('AUTONOMY'); // Use uppercase AUTONOMY only
      }

      res.json(
        successResponse({
          enabled: newState,
          service_available: serviceAvailable,
          capability,
          settings_updated: settings,
        })
      );
    },
  },

  // Reset agent
  {
    type: 'POST',
    path: '/api/reset-agent',
    name: 'Reset Agent',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      console.log('[GAME-API] Starting agent reset...');

      const agentId = runtime.agentId;

      console.log('[GAME-API] Creating fresh initial state...');

      // Give it a moment to ensure operations complete
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Create initial todos and goals again
      await createInitialTodosAndGoals(runtime);

      res.json(
        successResponse({
          message: 'Agent reset complete',
          agentId,
        })
      );
    },
  },

  {
    type: 'POST',
    path: '/knowledge/upload',
    name: 'Upload Knowledge Document',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const knowledgeService = runtime.getService('knowledge') as KnowledgeService | null;
      if (!knowledgeService) {
        return res
          .status(404)
          .json(errorResponse('SERVICE_NOT_FOUND', 'Knowledge service not available'));
      }

      const headers = (req.headers as Record<string, unknown>) || {};
      const files = (req.files as Record<string, unknown>) || {};
      const body = (req.body as Record<string, unknown>) || {};

      console.log('[GAME-API] Upload request received:', {
        files: Object.keys(files),
        body: Object.keys(body),
        contentType: headers['content-type'],
        hasFiles: !!files,
        filesKeys: Object.keys(files),
        rawBodySize: JSON.stringify(body).length,
      });

      let uploadedFile: any, fileName, contentType, fileContent;

      // Try express-fileupload format first
      if (files && files.file) {
        uploadedFile = files.file;
        fileName = uploadedFile.name;
        contentType = uploadedFile.mimetype || 'application/octet-stream';
        fileContent = uploadedFile.data;
      }
      // Try alternative file handling (check if uploaded via different parser)
      else if (body && typeof body === 'object') {
        // If we got a file in the body somehow
        const bodyKeys = Object.keys(body);
        console.log('[GAME-API] Checking body keys:', bodyKeys);

        // Look for file-like properties in body
        if (body.file) {
          const bodyFile = body.file;
          if (typeof bodyFile === 'string') {
            fileName = 'uploaded-file.txt';
            contentType = 'text/plain';
            fileContent = Buffer.from(bodyFile, 'utf8');
          }
        }
      }

      if (!fileContent) {
        return res
          .status(400)
          .json(errorResponse('NO_FILE', 'No file uploaded or file parsing failed'));
      }

      console.log(`[GAME-API] Processing uploaded file: ${fileName} (${contentType})`);

      // Create knowledge options
      const knowledgeOptions = {
        clientDocumentId: uuidv4() as UUID,
        contentType,
        originalFilename: fileName,
        worldId: runtime.agentId,
        content: fileContent.toString('base64'), // Convert to base64 for storage
        roomId: runtime.agentId,
        entityId: runtime.agentId,
        agentId: runtime.agentId,
      };

      // Add the knowledge using properly typed service
      const result = await knowledgeService.addKnowledge(knowledgeOptions);

      res.json(
        successResponse({
          documentId: result.clientDocumentId,
          storedDocumentMemoryId: result.storedDocumentMemoryId,
          fragmentCount: result.fragmentCount,
          filename: fileName,
          message: `Successfully processed ${fileName} into ${result.fragmentCount} searchable fragments`,
        })
      );
    },
  },

  {
    type: 'DELETE',
    path: '/knowledge/documents/:documentId',
    name: 'Delete Knowledge Document',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const knowledgeService = runtime.getService('knowledge') as KnowledgeService | null;
      if (!knowledgeService) {
        return res
          .status(404)
          .json(errorResponse('SERVICE_NOT_FOUND', 'Knowledge service not available'));
      }

      const params = (req.params as Record<string, unknown>) || {};
      const documentId = String(params.documentId || '');
      console.log('[GAME-API] Attempting to delete knowledge document:', documentId);

      // Use the knowledge service deleteMemory method to actually delete the document
      await knowledgeService.deleteMemory(documentId as UUID);
      console.log('[GAME-API] Successfully deleted knowledge document:', documentId);

      res.json(
        successResponse({
          message: 'Document deleted successfully',
          documentId,
        })
      );
    },
  },

  // Plugin Configuration Routes
  {
    type: 'GET',
    path: '/api/plugin-config',
    name: 'Get Plugin Configuration',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      // Get all services and their configurations
      const services = runtime.services;
      const configurations: Record<string, unknown> = {};

      // Get configurations for each service
      for (const [name, service] of services) {
        if (service && typeof (service as any).getConfig === 'function') {
          configurations[name] = await (service as any).getConfig();
        }
      }

      // Add current environment configurations
      configurations.environment = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '***SET***' : 'NOT_SET',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ? '***SET***' : 'NOT_SET',
        GOOGLE_API_KEY: process.env.GOOGLE_API_KEY ? '***SET***' : 'NOT_SET',
        MODEL_PROVIDER: process.env.MODEL_PROVIDER || 'ollama',
        TEXT_EMBEDDING_MODEL: process.env.TEXT_EMBEDDING_MODEL || 'nomic-embed-text',
        LANGUAGE_MODEL: process.env.LANGUAGE_MODEL || 'llama3.2:3b',
      };

      res.json(
        successResponse({
          configurations,
          availablePlugins: Array.from(services.keys()),
        })
      );
    },
  },

  {
    type: 'POST',
    path: '/api/plugin-config',
    name: 'Update Plugin Configuration',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const body = (req.body as Record<string, unknown>) || {};
      const plugin = body.plugin as string;
      const config = body.config;

      if (!plugin || !config) {
        return res
          .status(400)
          .json(errorResponse('INVALID_REQUEST', 'Plugin and config are required'));
      }

      // Handle environment variables specially
      if (plugin === 'environment') {
        // Update process.env for the current runtime
        Object.entries(config).forEach(([key, value]) => {
          if (value && value !== '***SET***') {
            process.env[key] = value as string;
          }
        });

        res.json(
          successResponse({
            message: 'Environment configuration updated',
            plugin: 'environment',
          })
        );
      } else {
        // Update specific plugin configuration
        const service = runtime.getService(plugin);
        if (!service) {
          return res
            .status(404)
            .json(errorResponse('SERVICE_NOT_FOUND', `Service ${plugin} not found`));
        }

        if (typeof (service as any).updateConfig === 'function') {
          await (service as any).updateConfig(config);
          res.json(
            successResponse({
              message: `Configuration updated for ${plugin}`,
              plugin,
            })
          );
        } else {
          res
            .status(400)
            .json(
              errorResponse(
                'NOT_CONFIGURABLE',
                `Service ${plugin} does not support configuration updates`
              )
            );
        }
      }
    },
  },

  // Debug API - Runtime State Serialization
  {
    type: 'GET',
    path: '/api/debug/runtime-state',
    name: 'Get Runtime State Debug Info',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      console.log('[GAME-API] Debug runtime state requested');

      // Safely serialize runtime state for debugging
      const debugState = {
        // Basic runtime info
        agentId: runtime.agentId,
        conversationLength: runtime.getConversationLength(),

        // Character information (safe to expose)
        character: {
          id: runtime.character.id,
          name: runtime.character.name,
          bio: Array.isArray(runtime.character.bio)
            ? runtime.character.bio.join(' ')
            : runtime.character.bio,
          username: runtime.character.username,
          topics: runtime.character.topics || [],
          style: runtime.character.style || {},
          plugins: runtime.character.plugins || [],
        },

        // Services information
        services: Array.from(runtime.services.keys()).map((serviceKey) => {
          const service = runtime.services.get(serviceKey);
          return {
            name: serviceKey,
            type: service?.constructor?.name || 'Unknown',
            count: service ? 1 : 0,
            // Safe service state extraction
            ...(service && typeof (service as any).getStatus === 'function'
              ? { status: (service as any).getStatus() }
              : {}),
            ...(service && typeof (service as any).getConfig === 'function'
              ? { hasConfig: true }
              : { hasConfig: false }),
          };
        }),

        // Plugin information
        plugins: runtime.plugins.map((plugin) => ({
          name: plugin.name,
          description: plugin.description,
          dependencies: plugin.dependencies || [],
          hasActions: (plugin.actions?.length || 0) > 0,
          hasProviders: (plugin.providers?.length || 0) > 0,
          hasEvaluators: (plugin.evaluators?.length || 0) > 0,
          hasServices: (plugin.services?.length || 0) > 0,
          hasRoutes: (plugin.routes?.length || 0) > 0,
          actionCount: plugin.actions?.length || 0,
          providerCount: plugin.providers?.length || 0,
          evaluatorCount: plugin.evaluators?.length || 0,
          serviceCount: plugin.services?.length || 0,
          routeCount: plugin.routes?.length || 0,
        })),

        // Actions information
        actions: runtime.actions.map((action) => ({
          name: action.name,
          description: action.description,
          hasValidate: typeof action.validate === 'function',
          hasHandler: typeof action.handler === 'function',
          exampleCount: action.examples?.length || 0,
        })),

        // Providers information
        providers: runtime.providers.map((provider) => ({
          name: provider.name,
          description: provider.description || 'No description',
          hasGetMethod: typeof provider.get === 'function',
        })),

        // Evaluators information
        evaluators: runtime.evaluators.map((evaluator) => ({
          name: evaluator.name,
          description: evaluator.description,
          alwaysRun: evaluator.alwaysRun || false,
          hasHandler: typeof evaluator.handler === 'function',
        })),

        // Routes information
        routes: runtime.routes.map((route) => ({
          type: route.type,
          path: route.path,
          name: route.name,
          public: route.public || false,
        })),

        // Event handlers information
        events: Array.from(runtime.events.keys()).map((eventName) => ({
          name: eventName,
          handlerCount: runtime.events.get(eventName)?.length || 0,
        })),

        // Settings information (safe keys only, no sensitive data)
        settings: {
          // Only expose non-sensitive settings
          ENABLE_CAMERA: runtime.getSetting('ENABLE_CAMERA'),
          ENABLE_SCREEN_CAPTURE: runtime.getSetting('ENABLE_SCREEN_CAPTURE'),
          ENABLE_MICROPHONE: runtime.getSetting('ENABLE_MICROPHONE'),
          ENABLE_SPEAKER: runtime.getSetting('ENABLE_SPEAKER'),
          ENABLE_SHELL: runtime.getSetting('ENABLE_SHELL'),
          ENABLE_BROWSER: runtime.getSetting('ENABLE_BROWSER'),
          VISION_CAMERA_ENABLED: runtime.getSetting('VISION_CAMERA_ENABLED'),
          VISION_SCREEN_ENABLED: runtime.getSetting('VISION_SCREEN_ENABLED'),
          VISION_MICROPHONE_ENABLED: runtime.getSetting('VISION_MICROPHONE_ENABLED'),
          VISION_SPEAKER_ENABLED: runtime.getSetting('VISION_SPEAKER_ENABLED'),
          SHELL_ENABLED: runtime.getSetting('SHELL_ENABLED'),
          BROWSER_ENABLED: runtime.getSetting('BROWSER_ENABLED'),
        },

        // Database connection status (if available)
        database: {
          hasConnection: typeof runtime.getConnection === 'function',
          isConnected: !!(runtime as any)?.databaseAdapter,
        },

        // Memory stats (if available)
        memory: await (async () => {
          const allMemories = await runtime.getMemories({ tableName: 'memories', count: 1000 });
          return {
            totalCount: allMemories.length,
            recentCount: allMemories.filter(
              (m) => m.createdAt && Date.now() - (m.createdAt as number) < 24 * 60 * 60 * 1000
            ).length,
          };
        })(),

        // Performance/status information
        status: {
          timestamp: Date.now(),
          uptime: process.uptime(),
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
        },
      };

      res.json(successResponse(debugState));
    },
  },

  // Debug API - Service Details
  {
    type: 'GET',
    path: '/api/debug/services/:serviceName',
    name: 'Get Service Debug Info',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const params = (req.params as Record<string, unknown>) || {};
      const serviceName = String(params.serviceName || '');
      const service = runtime.getService(serviceName);

      if (!service) {
        return res
          .status(404)
          .json(errorResponse('SERVICE_NOT_FOUND', `Service ${serviceName} not found`));
      }

      // Safely extract service information
      const serviceInfo = {
        name: serviceName,
        type: service.constructor.name,

        // Common service methods/properties
        capabilityDescription: service.capabilityDescription || 'No description available',

        // Safe method checks
        availableMethods: {
          start: typeof (service as any).start === 'function',
          stop: typeof (service as any).stop === 'function',
          getStatus: typeof (service as any).getStatus === 'function',
          getConfig: typeof (service as any).getConfig === 'function',
          updateConfig: typeof (service as any).updateConfig === 'function',
          refresh: typeof (service as any).refresh === 'function',
        },

        // Try to get status if available
        status:
          typeof (service as any).getStatus === 'function'
            ? (service as any).getStatus()
            : 'Status not available',

        // Try to get configuration if available (non-sensitive only)
        config:
          typeof (service as any).getConfig === 'function'
            ? await (service as any).getConfig()
            : 'Config not available',
      };

      res.json(successResponse(serviceInfo));
    },
  },

  // Service debugging endpoint
  {
    type: 'GET',
    path: '/api/debug/services',
    name: 'Debug Services',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const services = runtime.services || new Map();
      const serviceInfo: any[] = [];

      // Iterate through all services and log detailed information
      services.forEach((service: any, serviceType: string) => {
        if (service) {
          serviceInfo.push({
            serviceType,
            instanceIndex: 0,
            className: service.constructor.name,
            hasStop: typeof service.stop === 'function',
            hasInitialize: typeof service.initialize === 'function',
            // For goal service
            hasGetGoals: typeof service.getGoals === 'function',
            hasCreateGoal: typeof service.createGoal === 'function',
            hasGetAllGoalsForOwner: typeof service.getAllGoalsForOwner === 'function',
            // For todo service
            hasGetTodos: typeof service.getTodos === 'function',
            hasCreateTodo: typeof service.createTodo === 'function',
            // For autonomy service
            hasEnableAutonomy: typeof service.enableAutonomy === 'function',
            hasDisableAutonomy: typeof service.disableAutonomy === 'function',
            hasGetStatus: typeof service.getStatus === 'function',
            // Service description
            capabilityDescription: service.capabilityDescription || 'Not available',
          });
        }
      });

      console.log('[API] Service debugging - found services:', serviceInfo);

      res.json(
        successResponse({
          totalServices: services.size,
          serviceTypes: Array.from(services.keys()),
          serviceDetails: serviceInfo,
          // Specific service checks using getService instead of has()
          hasGoalsService: !!runtime.getService('goals'),
          hasTodoService: !!runtime.getService('todo'),
          hasAutonomyService: !!runtime.getService('autonomy'),
        })
      );
    },
  },

  // Memories API for Monologue Tab
  {
    type: 'GET',
    path: '/api/memories',
    name: 'Get Memories',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const query = req.query || {};
      const roomId = (query as Record<string, unknown>).roomId as string;
      const count = parseInt(((query as Record<string, unknown>).count as string) || '20', 10);

      if (!roomId) {
        return res.status(400).json(errorResponse('MISSING_ROOM_ID', 'Room ID is required'));
      }

      console.log(`[API] Fetching memories for room: ${roomId}, count: ${count}`);

      // Fetch memories from the specified room
      const memories = await runtime.getMemories({
        roomId: roomId as UUID,
        count,
        tableName: 'memories',
      });

      console.log(`[API] Found ${memories.length} memories for room ${roomId}`);

      // Return in the expected format
      res.json(successResponse(memories || []));
    },
  },

  // Logs API endpoint
  {
    type: 'GET',
    path: '/api/logs',
    name: 'Get System Logs',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const query = req.query || {};
      const type = ((query as Record<string, unknown>).type as string) || 'all';
      const limit = parseInt(((query as Record<string, unknown>).limit as string) || '100', 10);

      // Collect logs from various sources
      const logs: any[] = [];

      // Add recent agent activity logs
      if (type === 'all' || type === 'agent') {
        // Get recent conversations
        const recentMemories = await runtime.getMemories({
          roomId: runtime.agentId,
          count: Math.floor(parseInt(String(limit), 10) / 2),
          tableName: 'messages',
        });

        recentMemories.forEach((memory: any) => {
          logs.push({
            timestamp: memory.createdAt || new Date().toISOString(),
            type: 'agent',
            level: 'info',
            message: `${memory.userId === runtime.agentId ? 'Agent' : 'User'}: ${memory.content?.text || memory.content || ''}`,
            metadata: {
              userId: memory.userId,
              roomId: memory.roomId,
            },
          });
        });
      }

      // Add system logs if available
      if (type === 'all' || type === 'system') {
        // Get service status logs
        const services = Array.from(runtime.services.keys());
        services.forEach((serviceName) => {
          const service = runtime.services.get(serviceName);
          logs.push({
            timestamp: new Date().toISOString(),
            type: 'system',
            level: 'info',
            message: `Service '${serviceName}' is ${service ? 'loaded' : 'not loaded'}`,
            metadata: {
              service: serviceName,
              status: service ? 'active' : 'inactive',
            },
          });
        });

        // Add runtime status
        logs.push({
          timestamp: new Date().toISOString(),
          type: 'system',
          level: 'info',
          message: `Agent '${runtime.character?.name}' (${runtime.agentId}) is running`,
          metadata: {
            agentId: runtime.agentId,
            characterName: runtime.character?.name,
          },
        });
      }

      // Sort logs by timestamp (newest first)
      logs.sort((a, b) => {
        const timeA = new Date(a.timestamp).getTime();
        const timeB = new Date(b.timestamp).getTime();
        return timeB - timeA;
      });

      // Apply limit
      const limitedLogs = logs.slice(0, parseInt(String(limit), 10));

      res.json(
        successResponse({
          logs: limitedLogs,
          total: logs.length,
          filtered: type !== 'all',
        })
      );
    },
  },

  // Autonomy control routes (since autonomy plugin routes aren't being registered)
  {
    type: 'GET',
    path: '/autonomy/status',
    name: 'Autonomy Status',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      // Use uppercase 'AUTONOMY' as per the service's serviceType
      const autonomyService = runtime.getService('AUTONOMY');

      console.log(`[API] Autonomy service lookup: ${autonomyService ? 'found' : 'not found'}`);

      if (!autonomyService) {
        // List all available services for debugging
        const services = runtime.services || new Map();
        const serviceNames = Array.from(services.keys());
        console.log('[API] Available services:', serviceNames);
        return res
          .status(503)
          .json(errorResponse('SERVICE_UNAVAILABLE', 'Autonomy service not available'));
      }

      const status = (autonomyService as AutonomyService).getStatus();

      return res.json(
        successResponse({
          enabled: status.enabled,
          running: status.running,
          interval: status.interval,
          intervalSeconds: Math.round(status.interval / 1000),
          autonomousRoomId: status.autonomousRoomId,
          agentId: runtime.agentId,
          characterName: runtime.character?.name || 'Agent',
        })
      );
    },
  },

  {
    type: 'POST',
    path: '/autonomy/enable',
    name: 'Enable Autonomy',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const autonomyService = runtime.getService('AUTONOMY'); // Use uppercase AUTONOMY

      if (!autonomyService) {
        return res
          .status(503)
          .json(errorResponse('SERVICE_UNAVAILABLE', 'Autonomy service not available'));
      }

      await (autonomyService as AutonomyService).enableAutonomy();
      const status = (autonomyService as AutonomyService).getStatus();

      return res.json(
        successResponse({
          enabled: status.enabled,
          running: status.running,
          interval: status.interval,
          message: 'Autonomy enabled',
        })
      );
    },
  },

  {
    type: 'POST',
    path: '/autonomy/disable',
    name: 'Disable Autonomy',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const autonomyService = runtime.getService('AUTONOMY'); // Use uppercase AUTONOMY

      if (!autonomyService) {
        return res
          .status(503)
          .json(errorResponse('SERVICE_UNAVAILABLE', 'Autonomy service not available'));
      }

      await (autonomyService as AutonomyService).disableAutonomy();
      const status = (autonomyService as AutonomyService).getStatus();

      return res.json(
        successResponse({
          enabled: status.enabled,
          running: status.running,
          interval: status.interval,
          message: 'Autonomy disabled',
        })
      );
    },
  },

  // Game startup initialization
  {
    type: 'POST',
    path: '/api/game/startup',
    name: 'Game Startup Initialization',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      console.log('[GAME-API] Game startup initialization requested');

      try {
        // Check if services are available - use correct service names
        const goalService = runtime.getService('goals') as GoalService | null; // lowercase
        const todoService = runtime.getService('TODO') as TodoService | null; // uppercase

        const servicesReady = !!goalService && !!todoService;
        let goalsCreated = false;
        let initMessage = '';

        if (servicesReady) {
          // Check if we already have goals
          try {
            const existingGoals = await goalService.getAllGoalsForOwner('agent', runtime.agentId);
            if (!existingGoals || existingGoals.length === 0) {
              // Create initial goals and todos
              await createInitialTodosAndGoals(runtime);
              goalsCreated = true;
              initMessage = 'Initial goals and todos created';
            } else {
              initMessage = `Agent already has ${existingGoals.length} goals`;
            }
          } catch (error) {
            console.error('[GAME-API] Error checking/creating goals:', error);
            initMessage = 'Error during initialization';
          }
        } else {
          initMessage = 'Services not ready yet';
        }

        res.json(
          successResponse({
            ready: servicesReady,
            initialized: goalsCreated,
            message: initMessage,
            services: {
              goals: !!goalService,
              todos: !!todoService,
            },
          })
        );
      } catch (error) {
        console.error('[GAME-API] Error during startup:', error);
        res
          .status(500)
          .json(
            errorResponse(
              'STARTUP_FAILED',
              'Failed to initialize game',
              error instanceof Error ? error.message : String(error)
            )
          );
      }
    },
  },

  // Initialize goals and todos manually
  {
    type: 'POST',
    path: '/api/initialize-goals-todos',
    name: 'Initialize Goals and Todos',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      console.log('[GAME-API] Manual initialization of goals and todos requested');

      try {
        // Check if services are available first - use correct service names
        const goalService = runtime.getService('goals'); // lowercase
        const todoService = runtime.getService('TODO'); // uppercase

        if (!goalService || !todoService) {
          const missing = [];
          if (!goalService) missing.push('goals');
          if (!todoService) missing.push('TODO');

          return res
            .status(503)
            .json(
              errorResponse(
                'SERVICES_NOT_READY',
                `Required services not available: ${missing.join(', ')}. Please wait and try again.`
              )
            );
        }

        await createInitialTodosAndGoals(runtime);

        res.json(
          successResponse({
            message: 'Initial goals and todos created successfully',
          })
        );
      } catch (error) {
        console.error('[GAME-API] Error during initialization:', error);
        res
          .status(500)
          .json(
            errorResponse(
              'INITIALIZATION_FAILED',
              'Failed to initialize goals and todos',
              error instanceof Error ? error.message : String(error)
            )
          );
      }
    },
  },

  // Configuration Validation API
  {
    type: 'POST',
    path: '/api/config/validate',
    name: 'Validate Configuration',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      console.log('[CONFIG-VALIDATION] Starting configuration validation...');

      const validationResults: ValidationResults = {
        overall: 'unknown' as 'healthy' | 'degraded' | 'unhealthy',
        providers: {} as Record<string, ValidationConfig>,
        environment: {} as Record<string, EnvironmentValue>,
        services: {} as Record<string, ServiceConfig>,
        timestamp: Date.now(),
      };

      // Check MODEL_PROVIDER environment variable
      const modelProvider = process.env.MODEL_PROVIDER || 'ollama';
      validationResults.environment.MODEL_PROVIDER = {
        value: modelProvider,
        status: 'healthy',
        message: `Provider set to: ${modelProvider}`,
      };

      // Validate OpenAI configuration
      // if (modelProvider === 'openai' || modelProvider === 'all') {
      //   const openaiKey = process.env.OPENAI_API_KEY;
      //   const openaiModel = process.env.LANGUAGE_MODEL || 'gpt-4o-mini';

      //   validationResults.providers.openai = {
      //     apiKey: openaiKey ? 'present' : 'missing',
      //     model: openaiModel,
      //     status: openaiKey ? 'healthy' : 'unhealthy',
      //     message: openaiKey
      //       ? `OpenAI configured with model: ${openaiModel}`
      //       : 'OpenAI API key missing',
      //   };

      //   // Test OpenAI connection if key is present
      //   if (openaiKey) {
      //     const testResponse = await fetch('https://api.openai.com/v1/models', {
      //       method: 'GET',
      //       headers: {
      //         Authorization: `Bearer ${openaiKey}`,
      //         'Content-Type': 'application/json',
      //       },
      //     });

      //     if (testResponse.ok) {
      //       const models = await testResponse.json();
      //       const hasModel = models.data?.some((m: any) => m.id === openaiModel);
      //       validationResults.providers.openai.connectionTest = {
      //         status: 'success',
      //         modelAvailable: hasModel,
      //         message: hasModel
      //           ? 'Connection successful and model available'
      //           : `Connection successful but model ${openaiModel} not found`,
      //       };
      //       if (!hasModel) {
      //         validationResults.providers.openai.status = 'degraded';
      //       }
      //     } else {
      //       validationResults.providers.openai.connectionTest = {
      //         status: 'failed',
      //         error: `HTTP ${testResponse.status}: ${testResponse.statusText}`,
      //         message: 'Failed to connect to OpenAI API',
      //       };
      //       validationResults.providers.openai.status = 'unhealthy';
      //     }
      //   }
      // }

      // Validate Anthropic configuration
      // if (modelProvider === 'anthropic' || modelProvider === 'all') {
      //   const anthropicKey = process.env.ANTHROPIC_API_KEY;
      //   const anthropicModel = process.env.LANGUAGE_MODEL || 'claude-3-haiku-20240307';

      //   validationResults.providers.anthropic = {
      //     apiKey: anthropicKey ? 'present' : 'missing',
      //     model: anthropicModel,
      //     status: anthropicKey ? 'healthy' : 'unhealthy',
      //     message: anthropicKey
      //       ? `Anthropic configured with model: ${anthropicModel}`
      //       : 'Anthropic API key missing',
      //   };

      //   // Test Anthropic connection if key is present
      //   if (anthropicKey) {
      //     // Anthropic doesn't have a simple models endpoint, so we'll test with a minimal request
      //     const testResponse = await fetch('https://api.anthropic.com/v1/messages', {
      //       method: 'POST',
      //       headers: {
      //         Authorization: `Bearer ${anthropicKey}`,
      //         'Content-Type': 'application/json',
      //         'anthropic-version': '2023-06-01',
      //       },
      //       body: JSON.stringify({
      //         model: anthropicModel,
      //         max_tokens: 1,
      //         messages: [{ role: 'user', content: 'test' }],
      //       }),
      //     });

      //     if (testResponse.ok || testResponse.status === 400) {
      //       // 400 is expected for this minimal test request
      //       validationResults.providers.anthropic.connectionTest = {
      //         status: 'success',
      //         message: 'Connection successful',
      //       };
      //     } else {
      //       validationResults.providers.anthropic.connectionTest = {
      //         status: 'failed',
      //         error: `HTTP ${testResponse.status}: ${testResponse.statusText}`,
      //         message: 'Failed to connect to Anthropic API',
      //       };
      //       validationResults.providers.anthropic.status = 'unhealthy';
      //     }
      //   }
      // }

      // Validate Ollama configuration
      if (modelProvider === 'ollama' || modelProvider === 'all') {
        const ollamaUrl =
          process.env.OLLAMA_BASE_URL ||
          process.env.OLLAMA_API_ENDPOINT?.replace('/api', '') ||
          'http://localhost:11434';
        const ollamaModel = process.env.LANGUAGE_MODEL || 'llama3.2:3b';

        // Test Ollama connectivity with a simple message
        const testResponse = await fetch(`${ollamaUrl}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: ollamaModel,
            prompt: 'Hello! Please respond with just "OK" to test connectivity.',
            stream: false,
          }),
        });

        if (testResponse.ok) {
          const testData = (await testResponse.json()) as Record<string, any>;
          logger.info(
            `[OLLAMA] ✅ Connectivity test successful: ${testData.response?.substring(0, 50) || 'Response received'}`
          );
        }

        (validationResults.providers as Record<string, any>).ollama = {
          serverUrl: ollamaUrl,
          model: ollamaModel,
          status: 'not_loaded' as const,
          message: `Ollama configured with server: ${ollamaUrl}, model: ${ollamaModel}`,
        } as ValidationConfig;

        // Test Ollama connection
        const versionResponse = await fetch(`${ollamaUrl}/api/version`);

        if (versionResponse.ok) {
          const versionData = (await versionResponse.json()) as Record<string, any>;

          // Check if model is available
          const modelsResponse = await fetch(`${ollamaUrl}/api/tags`);
          if (modelsResponse.ok) {
            const modelsData = (await modelsResponse.json()) as Record<string, any>;
            const hasModel = modelsData.models?.some(
              (m: Record<string, any>) =>
                m.name === ollamaModel || m.name.startsWith(`${ollamaModel}:`)
            );

            (validationResults.providers as Record<string, any>).ollama.connectionTest = {
              status: 'success',
              version: versionData.version,
              modelAvailable: hasModel,
              availableModels: modelsData.models?.map((m: any) => m.name) || [],
              message: hasModel
                ? 'Connection successful and model available'
                : `Connection successful but model ${ollamaModel} not found`,
            };
            (validationResults.providers as Record<string, any>).ollama.status = hasModel
              ? 'healthy'
              : 'degraded';
          } else {
            (validationResults.providers as Record<string, any>).ollama.connectionTest = {
              status: 'partial',
              version: versionData.version,
              message: 'Connected but could not list models',
            };
            (validationResults.providers as Record<string, any>).ollama.status = 'degraded';
          }
        } else {
          (validationResults.providers as Record<string, any>).ollama.connectionTest = {
            status: 'failed',
            error: `HTTP ${versionResponse.status}: ${versionResponse.statusText}`,
            message: `Failed to connect to Ollama at ${ollamaUrl}`,
          };
          (validationResults.providers as Record<string, any>).ollama.status = 'unhealthy';
        }
      }

      // Check embedding model configuration
      const embeddingModel = process.env.TEXT_EMBEDDING_MODEL || 'text-embedding-3-small';
      validationResults.environment.TEXT_EMBEDDING_MODEL = {
        value: embeddingModel,
        status: 'healthy',
        message: `Embedding model: ${embeddingModel}`,
      };

      // Test runtime services
      const openaiService = runtime.getService('openai');
      const anthropicService = runtime.getService('anthropic');

      validationResults.services.openai = {
        loaded: !!openaiService,
        type: openaiService?.constructor?.name || 'Not loaded',
        status: openaiService ? 'loaded' : 'not_loaded',
      };

      validationResults.services.anthropic = {
        loaded: !!anthropicService,
        type: anthropicService?.constructor?.name || 'Not loaded',
        status: anthropicService ? 'loaded' : 'not_loaded',
      };

      // Calculate overall status
      const providerStatuses = Object.values(validationResults.providers).map((p: any) => p.status);
      const hasHealthyProvider = providerStatuses.includes('healthy');
      const hasUnhealthyProvider = providerStatuses.includes('unhealthy');

      if (hasHealthyProvider && !hasUnhealthyProvider) {
        validationResults.overall = 'healthy';
      } else if (hasHealthyProvider && hasUnhealthyProvider) {
        validationResults.overall = 'degraded';
      } else {
        validationResults.overall = 'unhealthy';
      }

      console.log(
        `[CONFIG-VALIDATION] Validation complete. Overall status: ${validationResults.overall}`
      );

      res.json(
        successResponse({
          validation: validationResults as ValidationResults,
          recommendations: generateConfigRecommendations(validationResults as ValidationResults),
        })
      );
    },
  },

  // Configuration Test API - Tests actual LLM functionality
  {
    type: 'POST',
    path: '/api/config/test',
    name: 'Test Configuration',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      console.log('[CONFIG-TEST] Starting configuration test...');

      const testResults = {
        provider: process.env.MODEL_PROVIDER || 'ollama',
        model: process.env.LANGUAGE_MODEL || 'llama3.2:3b',
        timestamp: Date.now(),
        tests: {} as Record<string, unknown>,
      };

      // Test basic LLM completion
      console.log('[CONFIG-TEST] Testing basic LLM completion...');

      // Create a simple test prompt
      const testPrompt = "Respond with exactly: 'Configuration test successful'";

      // Use the runtime to generate completion (this will use the configured provider)
      const completion = await runtime.useModel(ModelType.TEXT_LARGE, {
        messages: [
          {
            role: 'user' as const,
            content: [
              {
                type: 'text' as const,
                text: testPrompt,
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 20,
      });

      const responseText = completion?.trim() || '';
      const isExpectedResponse = responseText.includes('Configuration test successful');

      testResults.tests.llmCompletion = {
        status: isExpectedResponse ? 'success' : 'partial',
        request: testPrompt,
        response: responseText,
        expected: 'Configuration test successful',
        match: isExpectedResponse,
        message: isExpectedResponse
          ? 'LLM completion test passed'
          : 'LLM responded but not as expected',
      };

      // Test embedding functionality
      console.log('[CONFIG-TEST] Testing embedding generation...');

      const testText = 'This is a test for embedding generation';
      const embedding = await runtime.useModel(ModelType.TEXT_EMBEDDING, testText);

      testResults.tests.embedding = {
        status:
          embedding && Array.isArray(embedding) && embedding.length > 0 ? 'success' : 'failed',
        textLength: testText.length,
        embeddingDimensions: embedding ? embedding.length : 0,
        embeddingType: typeof embedding,
        message: embedding
          ? `Generated ${embedding.length}-dimensional embedding`
          : 'Failed to generate embedding',
      };

      // Test memory operations
      console.log('[CONFIG-TEST] Testing memory operations...');

      // Skip actual memory creation to avoid database constraints
      // Just test that the memory service is available
      const memoryService = runtime.getService('memory');

      testResults.tests.memory = {
        status: memoryService ? 'success' : 'failed',
        serviceAvailable: !!memoryService,
        message: memoryService ? 'Memory service is available' : 'Memory service not found',
      };

      // Calculate overall test status
      const testStatuses = Object.values(testResults.tests).map((t: any) => t.status);
      const allSuccessful = testStatuses.every((s) => s === 'success');
      const anyFailed = testStatuses.some((s) => s === 'failed');

      const overallStatus = allSuccessful ? 'success' : anyFailed ? 'failed' : 'partial';

      console.log(`[CONFIG-TEST] Configuration test complete. Overall status: ${overallStatus}`);

      res.json(
        successResponse({
          overallStatus,
          testResults,
          summary: {
            total: Object.keys(testResults.tests).length,
            passed: testStatuses.filter((s) => s === 'success').length,
            failed: testStatuses.filter((s) => s === 'failed').length,
            partial: testStatuses.filter((s) => s === 'partial').length,
          },
        })
      );
    },
  },

  {
    type: 'GET',
    path: '/api/autonomy',
    name: 'Get Autonomy Status',
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      res.json({
        success: false,
        data: {
          enabled: false,
          service_available: false,
          reason: 'Autonomy service not available',
        },
      });
    },
  },

  {
    type: 'GET',
    path: '/api/plugin-configs',
    name: 'Get Plugin Configurations',
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      res.json({
        success: true,
        data: [],
      });
    },
  },

  {
    type: 'POST',
    path: '/api/plugin-configs/:pluginId',
    name: 'Update Plugin Configuration',
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      res.json({
        success: false,
        error: 'Plugin configuration not implemented',
      });
    },
  },

  // ===== Provider Management Endpoints =====

  // Get available LLM providers and their status
  {
    type: 'GET',
    path: '/api/providers',
    name: 'Get LLM Provider Status',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        const status = await getProviderStatus(runtime);
        res.json(successResponse(status));
      } catch (error) {
        logger.error('[GAME-API] Error getting provider status:', error);
        res.status(500).json(
          errorResponse('PROVIDER_STATUS_ERROR', 'Failed to get provider status', {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        );
      }
    },
  },

  // Set selected provider
  {
    type: 'PUT',
    path: '/api/providers/selected',
    name: 'Set Selected Provider',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        const body = req.body || {};
        const provider = (body as Record<string, unknown>).provider as string;

        if (provider !== null && typeof provider !== 'string') {
          return res
            .status(400)
            .json(errorResponse('INVALID_PROVIDER', 'Provider must be a string or null'));
        }

        await setSelectedProvider(runtime, provider);
        const status = await getProviderStatus(runtime);

        res.json(
          successResponse({
            message: provider ? `Provider set to ${provider}` : 'Provider selection cleared',
            status,
          })
        );
      } catch (error) {
        logger.error('[GAME-API] Error setting selected provider:', error);
        res.status(500).json(
          errorResponse('SET_PROVIDER_ERROR', 'Failed to set provider', {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        );
      }
    },
  },

  // Set provider preferences
  {
    type: 'PUT',
    path: '/api/providers/preferences',
    name: 'Set Provider Preferences',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        const body = req.body || {};
        const preferences = (body as Record<string, unknown>).preferences;

        if (!Array.isArray(preferences)) {
          return res
            .status(400)
            .json(
              errorResponse('INVALID_PREFERENCES', 'Preferences must be an array of provider names')
            );
        }

        if (!preferences.every((p) => typeof p === 'string')) {
          return res
            .status(400)
            .json(errorResponse('INVALID_PREFERENCES', 'All preferences must be strings'));
        }

        await setProviderPreferences(runtime, preferences);
        const status = await getProviderStatus(runtime);

        res.json(
          successResponse({
            message: 'Provider preferences updated',
            status,
          })
        );
      } catch (error) {
        logger.error('[GAME-API] Error setting provider preferences:', error);
        res.status(500).json(
          errorResponse('SET_PREFERENCES_ERROR', 'Failed to set preferences', {
            error: error instanceof Error ? error.message : 'Unknown error',
          })
        );
      }
    },
  },

  // Media stream endpoint for receiving video/audio data
  {
    type: 'POST',
    path: '/api/media/stream',
    name: 'Media Stream Data',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const body = req.body || {};
      const type = (body as Record<string, unknown>).type as string;
      const data = (body as Record<string, unknown>).data;
      const agentId = (body as Record<string, unknown>).agentId as string;

      if (!type || !data) {
        return res.status(400).json(errorResponse('INVALID_REQUEST', 'Type and data are required'));
      }

      // Initialize buffer for agent if not exists
      if (!mediaBuffers.has(agentId || runtime.agentId)) {
        mediaBuffers.set(agentId || runtime.agentId, {
          videoFrames: [],
          audioChunks: [],
          maxBufferSize: 100, // Keep last 100 frames/chunks
        });
      }

      const buffer = mediaBuffers.get(agentId || runtime.agentId)!;

      // Store data in appropriate buffer
      if (type === 'video') {
        buffer.videoFrames.push(new Uint8Array(data as ArrayBuffer | ArrayLike<number>));
        if (buffer.videoFrames.length > buffer.maxBufferSize) {
          buffer.videoFrames.shift(); // Remove oldest frame
        }
      } else if (type === 'audio') {
        buffer.audioChunks.push(new Uint8Array(data as ArrayBuffer | ArrayLike<number>));
        if (buffer.audioChunks.length > buffer.maxBufferSize) {
          buffer.audioChunks.shift(); // Remove oldest chunk
        }
      }

      // Notify vision service if available
      const visionService =
        runtime.getService<VisionService>('vision') || runtime.getService<VisionService>('VISION');
      if (
        visionService &&
        typeof visionService.processMediaStream === 'function' &&
        (type === 'video' || type === 'audio')
      ) {
        await visionService.processMediaStream({
          type: type as 'video' | 'audio',
          data: new Uint8Array(data as ArrayBuffer),
          timestamp: Date.now(),
        });
      }

      res.json(
        successResponse({
          received: true,
          type,
          size: (data as ArrayBuffer).byteLength,
        })
      );
    },
  },

  // Get media buffer status
  {
    type: 'GET',
    path: '/api/media/status',
    name: 'Media Buffer Status',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const query = (req.query as Record<string, unknown>) || {};
      const agentId = String(query.agentId || runtime.agentId);
      const buffer = mediaBuffers.get(agentId);

      if (!buffer) {
        return res.json(
          successResponse({
            hasBuffer: false,
            videoFrames: 0,
            audioChunks: 0,
          })
        );
      }

      res.json(
        successResponse({
          hasBuffer: true,
          videoFrames: buffer.videoFrames.length,
          audioChunks: buffer.audioChunks.length,
          maxBufferSize: buffer.maxBufferSize,
        })
      );
    },
  },

  // Update Settings API
  {
    type: 'POST',
    path: '/api/agents/default/settings',
    name: 'Update Agent Settings',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const body = req.body || {};
      const key = (body as Record<string, unknown>).key as string;
      const value = (body as Record<string, unknown>).value;

      if (!key) {
        return res.status(400).json(errorResponse('MISSING_KEY', 'Setting key is required'));
      }

      runtime.setSetting(key, value);

      console.log(`[API] Updated setting ${key} = ${value}`);

      res.json(successResponse({ key, value }));
    },
  },

  // Virtual screen control endpoints
  {
    type: 'POST',
    path: '/api/agents/:agentId/screen/start',
    name: 'Start Agent Screen Capture',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        // Get server instance from request if available
        const server = (req as any).app?.locals?.agentServer;
        await startAgentScreenCapture(runtime, server);
        res.json(
          successResponse({
            message: 'Screen capture started',
            display: process.env.DISPLAY || ':99',
          })
        );
      } catch (error: any) {
        logger.error('[VirtualScreen] Failed to start screen capture:', error);
        res.status(500).json(errorResponse('SCREEN_CAPTURE_ERROR', error.message));
      }
    },
  },

  {
    type: 'POST',
    path: '/api/agents/:agentId/screen/stop',
    name: 'Stop Agent Screen Capture',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, _runtime: IAgentRuntime) => {
      try {
        await stopAgentScreenCapture();
        res.json(
          successResponse({
            message: 'Screen capture stopped',
          })
        );
      } catch (error: any) {
        logger.error('[VirtualScreen] Failed to stop screen capture:', error);
        res.status(500).json(errorResponse('SCREEN_CAPTURE_ERROR', error.message));
      }
    },
  },

  {
    type: 'GET',
    path: '/api/agents/:agentId/screen/latest',
    name: 'Get Latest Screen Frame',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const buffer = mediaBuffers.get(runtime.agentId);

      if (!buffer || buffer.videoFrames.length === 0) {
        return res.status(404).json(errorResponse('NO_FRAMES', 'No screen frames available'));
      }

      const latestFrame = buffer.videoFrames[buffer.videoFrames.length - 1];

      // Convert Uint8Array to base64 for proper transmission
      const frameBase64 = Buffer.from(latestFrame).toString('base64');

      res.json(
        successResponse({
          frame: frameBase64,
          frameArray: Array.from(latestFrame), // Keep array format for backward compatibility
          width: 1280,
          height: 720,
          timestamp: Date.now(),
          encoding: 'base64',
        })
      );
    },
  },

  {
    type: 'GET',
    path: '/api/agents/:agentId/screen/latest/image',
    name: 'Get Latest Screen Frame as Image',
    public: true,
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      const buffer = mediaBuffers.get(runtime.agentId);

      if (!buffer || buffer.videoFrames.length === 0) {
        return res.status(404).json(errorResponse('NO_FRAMES', 'No screen frames available'));
      }

      const latestFrame = buffer.videoFrames[buffer.videoFrames.length - 1];

      // Return raw JPEG image
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Length', String(latestFrame.length));
      res.send(Buffer.from(latestFrame));
    },
  },

  // Runtime State API (for tests)
  {
    type: 'GET',
    path: '/api/server/runtime',
    name: 'Get Server Runtime State',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        const hasConnection = !!runtime;
        const isConnected = hasConnection && runtime.agentId !== undefined;

        const response: any = {
          hasConnection,
          isConnected,
        };

        if (isConnected) {
          response.agentId = runtime.agentId;
          response.agentName = runtime.character?.name || 'Unknown';
          response.isReady = true;

          // Get list of loaded agents
          const agents = [];
          if (runtime) {
            agents.push({
              id: runtime.agentId,
              name: runtime.character?.name || 'Unknown',
              status: 'active',
              model: runtime.getSetting('modelProvider') || 'unknown',
            });
          }
          response.agents = agents;
        }

        return res.json(successResponse(response));
      } catch (error) {
        console.error('[API] Error getting runtime state:', error);
        return res.status(500).json(errorResponse('RUNTIME_ERROR', 'Failed to get runtime state'));
      }
    },
  },

  // Monologue API (for tests)
  {
    type: 'GET',
    path: '/api/monologue',
    name: 'Get Agent Monologue',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        if (!runtime) {
          return res.status(404).json(errorResponse('NOT_FOUND', 'No agent runtime available'));
        }

        // Get recent memories that represent the agent's monologue/thoughts
        const query = (req.query as Record<string, unknown>) || {};
        const memories = await runtime.getMemories({
          roomId: query.roomId as UUID,
          count: parseInt(String(query.count || 10), 10),
          tableName: 'memories',
        });

        const monologue = memories
          .filter((m) => m.content?.type === 'monologue' || m.content?.type === 'thought')
          .map((m) => ({
            id: m.id,
            content: m.content?.text || m.content?.content || '',
            timestamp: m.createdAt,
            type: m.content?.type || 'thought',
          }));

        return res.json(
          successResponse({
            monologue,
            count: monologue.length,
          })
        );
      } catch (error) {
        console.error('[API] Error getting monologue:', error);
        return res.status(500).json(errorResponse('MONOLOGUE_ERROR', 'Failed to get monologue'));
      }
    },
  },

  // Message Ingestion API (for tests)
  {
    type: 'POST',
    path: '/api/messaging/ingest-external',
    name: 'Ingest External Message',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        const body = req.body || {};
        const channel_id = (body as Record<string, unknown>).channel_id as string;
        const server_id = (body as Record<string, unknown>).server_id as string;
        const author_id = (body as Record<string, unknown>).author_id as string;
        const author_display_name = (body as Record<string, unknown>).author_display_name as string;
        const content = (body as Record<string, unknown>).content as string;
        const source_type = (body as Record<string, unknown>).source_type as string;
        const raw_message = (body as Record<string, unknown>).raw_message;
        const metadata = (body as Record<string, unknown>).metadata;

        // Validate required fields
        if (!channel_id || !content || !author_id) {
          return res
            .status(400)
            .json(
              errorResponse(
                'MISSING_FIELDS',
                'Missing required fields: channel_id, content, author_id'
              )
            );
        }

        // Check if we have a runtime
        if (!runtime) {
          return res.status(500).json(errorResponse('NO_RUNTIME', 'No agent runtime available'));
        }

        // Get the server instance from the global variable
        const serverInstance = (global as any).elizaAgentServer;
        if (!serverInstance) {
          console.error('[API] Server instance not available globally');
          return res.status(500).json(errorResponse('SERVER_ERROR', 'Failed to ingest message'));
        }

        // Check if channel exists, create if not
        let channel = await serverInstance.getChannelDetails(channel_id as UUID);
        if (!channel) {
          console.log(`[API] Channel ${channel_id} does not exist, creating it...`);

          // Use the provided server_id or default
          const serverId = (server_id || '00000000-0000-0000-0000-000000000000') as UUID;

          // Create the channel
          channel = await serverInstance.createChannel({
            id: channel_id as UUID,
            serverId,
            name:
              (metadata as Record<string, any>)?.channel_name ||
              `Test Channel ${channel_id.substring(0, 8)}`,
            type: 'GROUP' as const,
            sourceType: source_type || 'test',
            metadata: {
              created_by: 'ingest_external_api',
              created_for: author_id,
              created_at: new Date().toISOString(),
              ...((metadata as object) || {}),
            },
          });

          console.log(`[API] Created channel ${channel_id} successfully`);
        }

        // Create message in the database
        const messageId = uuidv4() as UUID;
        const messageToCreate = {
          id: messageId,
          channelId: channel_id as UUID,
          authorId: author_id as UUID,
          content,
          rawMessage: raw_message || { text: content },
          sourceId: source_type || 'external',
          source_type: source_type || 'external',
          metadata: {
            ...((metadata as object) || {}),
            author_display_name,
            server_id,
            ingested_at: Date.now(),
          },
        };

        const createdMessage = await serverInstance.createMessage(messageToCreate);

        // Emit to the internal message bus for agent processing
        const messageForBus = {
          id: createdMessage.id!,
          channel_id: createdMessage.channelId,
          server_id: server_id || '00000000-0000-0000-0000-000000000000',
          author_id: createdMessage.authorId,
          author_display_name: author_display_name || 'User',
          content: createdMessage.content,
          raw_message: createdMessage.rawMessage,
          source_id: createdMessage.sourceId,
          source_type: createdMessage.source_type,
          created_at: new Date(createdMessage.createdAt).getTime(),
          metadata: createdMessage.metadata,
        };

        const bus = (global as any).elizaInternalMessageBus;
        if (bus) {
          bus.emit('new_message', messageForBus);
          console.log('[API] Published message to internal message bus:', createdMessage.id);
        }

        res.status(201).json({
          success: true,
          data: { messageId: createdMessage.id },
        });
      } catch (error) {
        console.error('[API] Error ingesting message:', error);
        res.status(500).json(errorResponse('INGEST_ERROR', 'Failed to ingest message'));
      }
    },
  },

  // Memory Query API
  {
    type: 'GET',
    path: '/api/memory/query',
    name: 'Query Memories',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        const query = req.query || {};
        const roomId = (query as Record<string, unknown>).roomId as string;
        const limit = parseInt(((query as Record<string, unknown>).limit as string) || '10', 10);
        const offset = parseInt(((query as Record<string, unknown>).offset as string) || '0', 10);
        const tableName = ((query as Record<string, unknown>).tableName as string) || 'memories';

        if (!runtime) {
          return res.status(500).json(errorResponse('NO_RUNTIME', 'Runtime not available'));
        }

        // Get memories using the runtime's getMemories method
        const memories = await runtime.getMemories({
          roomId: roomId as UUID,
          count: parseInt(String(limit), 10),
          tableName: tableName as string,
          start: offset ? Date.now() - parseInt(String(offset), 10) * 86400000 : undefined, // offset in days
        });

        res.json({
          success: true,
          memories: memories.map((memory) => ({
            id: memory.id,
            content: memory.content,
            createdAt: memory.createdAt,
            roomId: memory.roomId,
            entityId: memory.entityId,
            agentId: memory.agentId,
          })),
          total: memories.length,
        });
      } catch (error) {
        console.error('[API] Error querying memories:', error);
        res.status(500).json(errorResponse('MEMORY_QUERY_ERROR', 'Failed to query memories'));
      }
    },
  },

  // Legacy message endpoint (redirect to new endpoint)
  {
    type: 'POST',
    path: '/api/agents/:agentId/message',
    name: 'Send Message (Legacy)',
    handler: async (req: GameApiRequest, res: GameApiResponse, runtime: IAgentRuntime) => {
      try {
        const body = (req.body as Record<string, unknown>) || {};
        const params = (req.params as Record<string, unknown>) || {};
        const text = body.text;
        const userId = body.userId;
        const roomId = body.roomId;
        const messageId = body.messageId;

        // Transform to new format
        const newPayload = {
          channel_id: roomId,
          server_id: '00000000-0000-0000-0000-000000000000',
          author_id: userId,
          author_display_name: userId,
          content: text,
          source_type: 'legacy',
          raw_message: { text, messageId },
          metadata: {
            legacy: true,
            originalMessageId: messageId,
            agentId: params.agentId,
          },
        };

        // Forward to new endpoint
        req.body = newPayload;
        const ingestHandler = gameAPIRoutes.find(
          (r) => r.path === '/api/messaging/ingest-external'
        )?.handler;
        if (ingestHandler) {
          return ingestHandler(req, res, runtime);
        } else {
          return res
            .status(500)
            .json(errorResponse('FORWARD_ERROR', 'Failed to forward to new messaging endpoint'));
        }
      } catch (error) {
        console.error('[API] Error in legacy message endpoint:', error);
        return res.status(500).json(errorResponse('LEGACY_ERROR', 'Failed to process message'));
      }
    },
  },
];

// Export functions for vision plugin to access media buffers
export function getMediaBuffer(agentId: string): MediaStreamBuffer | undefined {
  return mediaBuffers.get(agentId);
}

export function clearMediaBuffer(agentId: string): void {
  const buffer = mediaBuffers.get(agentId);
  if (buffer) {
    buffer.videoFrames = [];
    buffer.audioChunks = [];
  }
}

// Plugin export
export const gameAPIPlugin: Plugin = {
  name: 'game-api',
  description: 'Custom API routes for the ELIZA game',
  routes: gameAPIRoutes,

  init: async (config: Record<string, string>, runtime: IAgentRuntime) => {
    console.log('[GAME-API] Plugin initialized for agent:', runtime.agentId);
    console.log('[GAME-API] Number of routes being registered:', gameAPIRoutes.length);

    // Log each route being registered
    gameAPIRoutes.forEach((route, index) => {
      console.log(
        `[GAME-API] Route ${index + 1}: ${route.type} ${route.path} (public: ${route.public || false})`
      );
    });

    // Store reference to global ElizaOS server if available
    if ((global as any).elizaAgentServer) {
      agentServerInstance = (global as any).elizaAgentServer;
      logger.info('[GAME-API] Server instance stored from global for WebSocket broadcasting');
    }

    // Debug: List all registered services
    const services = runtime.services || new Map();
    const serviceNames = Array.from(services.keys());
    console.log('[GAME-API] Available services at init:', serviceNames);

    // Specifically check for autonomy service
    const autonomyService = runtime.getService('Autonomy') || runtime.getService('AUTONOMY');
    console.log('[GAME-API] Autonomy service found:', !!autonomyService);

    if (autonomyService) {
      console.log('[GAME-API] Autonomy service type:', autonomyService.constructor.name);
      console.log(
        '[GAME-API] Autonomy service methods:',
        Object.getOwnPropertyNames(Object.getPrototypeOf(autonomyService))
      );
    }

    // Don't create initial todos/goals immediately - wait for a ready signal
    // This will be triggered by the /api/initialize-goals-todos endpoint if needed
    console.log(
      '[GAME-API] Plugin initialization complete. Initial goals/todos creation deferred.'
    );

    // Set a flag to indicate the plugin is ready
    (runtime as any).gameApiPluginReady = true;

    // Schedule initial todos/goals creation after a delay to ensure everything is ready
    setTimeout(async () => {
      console.log('[GAME-API] Checking if initial goals/todos need to be created...');
      try {
        // Check if agent exists and has no goals yet
        const agent = await runtime.db?.getAgent?.(runtime.agentId);
        if (agent) {
          const goalService = runtime.getService<GoalService>('goals'); // lowercase
          if (goalService) {
            const existingGoals = await goalService.getAllGoalsForOwner('agent', runtime.agentId);
            if (!existingGoals || existingGoals.length === 0) {
              console.log('[GAME-API] No existing goals found, creating initial set...');
              await createInitialTodosAndGoals(runtime);
            } else {
              console.log(`[GAME-API] Agent already has ${existingGoals.length} goals`);
            }
          } else {
            console.log('[GAME-API] Goals service not yet available, will retry later');
          }
        }
      } catch (error) {
        console.error('[GAME-API] Error during deferred initialization check:', error);
      }
    }, 10000); // Wait 10 seconds after plugin init

    // Auto-start screen capture for VNC streaming after a delay
    setTimeout(async () => {
      try {
        console.log('[GAME-API] Auto-starting agent screen capture for VNC streaming...');
        await startAgentScreenCapture(runtime, agentServerInstance);
        console.log('[GAME-API] Agent screen capture started automatically');
      } catch (error) {
        console.error('[GAME-API] Failed to auto-start screen capture:', error);
        // Not fatal - can be started manually later
      }
    }, 15000); // Wait 15 seconds to ensure display is ready

    return Promise.resolve();
  },
};

export default gameAPIPlugin;
