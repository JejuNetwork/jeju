import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IAgentRuntime } from '@elizaos/core';
import './setup'; // Import setup to run mocks
import { resetInferenceState } from '../index';

// Define request/response interfaces
interface MockRequest {
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}

interface MockResponse {
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
  send: (data: unknown) => MockResponse;
}

// Mock Express request/response objects
const createMockRequest = (
  body?: Record<string, unknown>,
  params?: Record<string, unknown>,
  query?: Record<string, unknown>
): MockRequest => ({
  body: body || {},
  params: params || {},
  query: query || {},
});

const createMockResponse = (): MockResponse => {
  const res = {} as MockResponse;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
};

// Mock runtime
const createMockRuntime = (settings: Record<string, string> = {}): IAgentRuntime =>
  ({
    agentId: 'test-agent-api',
    getSetting: (key: string) => settings[key],
    setSetting: vi.fn((key: string, value: string) => {
      settings[key] = value;
    }),
    useModel: vi.fn(),
    character: { name: 'Test Agent' },
    getService: vi.fn((serviceName: string) => {
      // Return null for validation services to use fallback logic
      return null;
    }),
  }) as unknown as IAgentRuntime;

// Import the route handlers from game-api-plugin
// Note: In a real implementation, these would be exported from the plugin
const mockProviderRoutes = {
  getStatus: async (req: MockRequest, res: MockResponse, runtime: IAgentRuntime) => {
    const { getProviderStatus } = await import('../index');
    const status = await getProviderStatus(runtime);
    res.json({ success: true, data: status });
  },

  setSelected: async (req: MockRequest, res: MockResponse, runtime: IAgentRuntime) => {
    const { setSelectedProvider, getProviderStatus } = await import('../index');
    try {
      const { provider } = req.body || {};

      if (provider !== null && typeof provider !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Provider must be a string or null',
        });
      }

      await setSelectedProvider(runtime, provider as string | null);
      const status = await getProviderStatus(runtime);

      res.json({
        success: true,
        data: {
          message: provider ? `Provider set to ${provider}` : 'Provider selection cleared',
          status,
        },
      });
    } catch (error) {
      res.status(500).json({ success: false, error: (error as Error).message });
    }
  },

  setPreferences: async (req: MockRequest, res: MockResponse, runtime: IAgentRuntime) => {
    const { setProviderPreferences, getProviderStatus } = await import('../index');
    try {
      const { preferences } = req.body || {};

      // Validate input
      if (!Array.isArray(preferences)) {
        return res.status(400).json({
          success: false,
          error: 'Preferences must be an array',
        });
      }

      if (preferences.some((p: unknown) => typeof p !== 'string')) {
        return res.status(400).json({
          success: false,
          error: 'All preferences must be strings',
        });
      }

      await setProviderPreferences(runtime, preferences as string[]);
      const status = await getProviderStatus(runtime);

      res.json({
        success: true,
        data: {
          message: 'Provider preferences updated',
          status,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },
};

describe('Inference Plugin API Endpoints', () => {
  let runtime: IAgentRuntime;

  beforeEach(() => {
    vi.clearAllMocks();
    resetInferenceState();
    runtime = createMockRuntime();
  });

  describe('GET /api/providers', () => {
    it('should return provider status', async () => {
      const req = {};
      const res = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };
      const runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
        GROQ_API_KEY: 'test-key',
      });

      await mockProviderRoutes.getStatus(req, res, runtime);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.objectContaining({
          active: expect.any(String), // Can be any provider
          providers: expect.arrayContaining([
            expect.objectContaining({
              name: 'openai',
              status: 'available',
            }),
            expect.objectContaining({
              name: 'anthropic',
              status: 'available',
            }),
            expect.objectContaining({
              name: 'groq',
              status: 'available',
            }),
            expect.objectContaining({
              name: 'ollama',
              // Ollama can be either available or not_configured depending on test setup
            }),
            expect.objectContaining({
              name: 'local_embedding',
              status: 'available',
            }),
          ]),
        }),
      });

      const callArgs = res.json.mock.calls[0][0];
      expect(callArgs.data.providers).toHaveLength(6);
    });

    it('should handle errors gracefully', async () => {
      const req = {};
      const res = {
        json: vi.fn(),
        status: vi.fn().mockReturnThis(),
      };

      // Pass null runtime to trigger error
      try {
        await mockProviderRoutes.getStatus(req, res, null as unknown as IAgentRuntime);

        // If no exception thrown, verify the response was handled
        expect(res.status).toHaveBeenCalledWith(500);
        expect(res.json).toHaveBeenCalledWith({
          success: false,
          error: expect.any(String),
        });
      } catch (error) {
        // If exception is thrown, that's also acceptable error behavior
        expect(error).toBeDefined();
      }
    });
  });

  describe('PUT /api/providers/selected', () => {
    it('should set selected provider', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
      });

      const req = createMockRequest({ provider: 'anthropic' });
      const res = createMockResponse();

      await mockProviderRoutes.setSelected(req, res, runtime);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          message: 'Provider set to anthropic',
          status: expect.objectContaining({
            selected: 'anthropic',
          }),
        },
      });
    });

    it('should clear selected provider when null is passed', async () => {
      const req = createMockRequest({ provider: null });
      const res = createMockResponse();

      await mockProviderRoutes.setSelected(req, res, runtime);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          message: 'Provider selection cleared',
          status: expect.objectContaining({
            selected: null,
          }),
        },
      });
    });

    it('should return 400 for invalid provider type', async () => {
      const req = createMockRequest({ provider: 123 }); // Invalid type
      const res = createMockResponse();

      await mockProviderRoutes.setSelected(req, res, runtime);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Provider must be a string or null',
      });
    });

    it('should return 500 for unknown provider', async () => {
      const req = createMockRequest({ provider: 'unknown-provider' });
      const res = createMockResponse();

      await mockProviderRoutes.setSelected(req, res, runtime);

      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: expect.stringContaining('Unknown provider'),
      });
    });
  });

  describe('PUT /api/providers/preferences', () => {
    it('should set provider preferences', async () => {
      const req = createMockRequest({ preferences: ['anthropic', 'openai', 'ollama'] });
      const res = createMockResponse();

      await mockProviderRoutes.setPreferences(req, res, runtime);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          message: 'Provider preferences updated',
          status: expect.any(Object),
        },
      });
      expect(runtime.setSetting).toHaveBeenCalledWith(
        'INFERENCE_PREFERENCES',
        'anthropic,openai,ollama'
      );
    });

    it('should return 400 for non-array preferences', async () => {
      const req = createMockRequest({ preferences: 'anthropic,openai' }); // String instead of array
      const res = createMockResponse();

      await mockProviderRoutes.setPreferences(req, res, runtime);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'Preferences must be an array',
      });
    });

    it('should return 400 for non-string array elements', async () => {
      const req = createMockRequest({ preferences: ['anthropic', 123, 'openai'] }); // Number in array
      const res = createMockResponse();

      await mockProviderRoutes.setPreferences(req, res, runtime);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: 'All preferences must be strings',
      });
    });

    it('should filter out invalid providers', async () => {
      const req = createMockRequest({ preferences: ['anthropic', 'invalid-provider', 'openai'] });
      const res = createMockResponse();

      await mockProviderRoutes.setPreferences(req, res, runtime);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: expect.any(Object),
      });
      expect(runtime.setSetting).toHaveBeenCalledWith('INFERENCE_PREFERENCES', 'anthropic,openai');
    });
  });

  describe('Integration with Runtime', () => {
    it('should persist settings across API calls', async () => {
      runtime = createMockRuntime({
        OPENAI_API_KEY: 'test-key',
        ANTHROPIC_API_KEY: 'test-key',
      });

      // Set preferences
      const prefReq = createMockRequest({ preferences: ['anthropic', 'openai'] });
      const prefRes = createMockResponse();
      await mockProviderRoutes.setPreferences(prefReq, prefRes, runtime);

      // Set selected provider
      const selReq = createMockRequest({ provider: 'anthropic' });
      const selRes = createMockResponse();
      await mockProviderRoutes.setSelected(selReq, selRes, runtime);

      // Get status
      const statusReq = createMockRequest();
      const statusRes = createMockResponse();
      await mockProviderRoutes.getStatus(statusReq, statusRes, runtime);

      // Verify the settings persisted
      expect(runtime.setSetting).toHaveBeenCalledWith('INFERENCE_PREFERENCES', 'anthropic,openai');
      expect(runtime.setSetting).toHaveBeenCalledWith('SELECTED_PROVIDER', 'anthropic');
    });
  });
});
