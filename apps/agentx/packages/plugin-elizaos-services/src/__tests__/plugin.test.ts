import { describe, expect, it, spyOn, beforeEach, afterEach, beforeAll, afterAll } from 'bun:test';
import { elizaOSServicesPlugin, ElizaOSService } from '../index';
import { ModelType, logger } from '@elizaos/core';
import * as dotenv from 'dotenv';

// Setup environment variables
dotenv.config();

// Need to spy on logger for documentation
beforeAll(() => {
  spyOn(logger, 'info');
  spyOn(logger, 'error');
  spyOn(logger, 'warn');
  spyOn(logger, 'debug');
});

afterAll(() => {
  // No global restore needed in bun:test
});

// Create a real runtime for testing
function createRealRuntime() {
  const services = new Map();

  // Create a real service instance if needed
  const createService = (serviceType: string) => {
    if (serviceType === ElizaOSService.serviceType) {
      return new ElizaOSService({
        character: {
          name: 'Test Character',
          system: 'You are a helpful assistant for testing.',
        },
      } as any);
    }
    return null;
  };

  return {
    character: {
      name: 'Test Character',
      system: 'You are a helpful assistant for testing.',
      plugins: [],
      settings: {},
    },
    getSetting: (key: string) => null,
    models: elizaOSServicesPlugin.models,
    db: {
      get: async (key: string) => null,
      set: async (key: string, value: any) => true,
      delete: async (key: string) => true,
      getKeys: async (pattern: string) => [],
    },
    getService: (serviceType: string) => {
      // Log the service request for debugging
      logger.debug(`Requesting service: ${serviceType}`);

      // Get from cache or create new
      if (!services.has(serviceType)) {
        logger.debug(`Creating new service: ${serviceType}`);
        services.set(serviceType, createService(serviceType));
      }

      return services.get(serviceType);
    },
    registerService: (serviceType: string, service: any) => {
      logger.debug(`Registering service: ${serviceType}`);
      services.set(serviceType, service);
    },
  };
}

describe('Plugin Configuration', () => {
  it('should have correct plugin metadata', () => {
    expect(elizaOSServicesPlugin.name).toBe('elizaos-services');
    expect(elizaOSServicesPlugin.description).toBe(
      'ElizaOS hosted services for AI inference and storage'
    );
    expect(elizaOSServicesPlugin.config).toBeDefined();
  });

  it('should include the EXAMPLE_PLUGIN_VARIABLE in config', () => {
    expect(elizaOSServicesPlugin.config).toHaveProperty('ELIZAOS_API_KEY');
  });

  it('should initialize properly', async () => {
    const originalEnv = process.env.ELIZAOS_API_KEY;

    try {
      process.env.ELIZAOS_API_KEY = 'test-value';

      // Initialize with config - using real runtime
      const runtime = createRealRuntime();

      if (elizaOSServicesPlugin.init) {
        await elizaOSServicesPlugin.init({ ELIZAOS_API_KEY: 'test-value' }, runtime as any);
        expect(true).toBe(true); // If we got here, init succeeded
      }
    } finally {
      process.env.ELIZAOS_API_KEY = originalEnv;
    }
  });

  it('should have a valid config', () => {
    expect(elizaOSServicesPlugin.config).toBeDefined();
    if (elizaOSServicesPlugin.config) {
      // Check if the config has expected ELIZAOS_API_KEY property
      expect(Object.keys(elizaOSServicesPlugin.config)).toContain('ELIZAOS_API_KEY');
    }
  });
});

describe('Plugin Models', () => {
  it('should have TEXT_SMALL model defined', () => {
    expect(elizaOSServicesPlugin.models?.[ModelType.TEXT_SMALL]).toBeDefined();
    if (elizaOSServicesPlugin.models) {
      expect(typeof elizaOSServicesPlugin.models[ModelType.TEXT_SMALL]).toBe('function');
    }
  });

  it('should have TEXT_LARGE model defined', () => {
    expect(elizaOSServicesPlugin.models?.[ModelType.TEXT_LARGE]).toBeDefined();
    if (elizaOSServicesPlugin.models) {
      expect(typeof elizaOSServicesPlugin.models[ModelType.TEXT_LARGE]).toBe('function');
    }
  });

  it('should return a response from TEXT_SMALL model when API is available', async () => {
    if (elizaOSServicesPlugin.models?.[ModelType.TEXT_SMALL]) {
      const runtime = createRealRuntime();

      try {
        const result = await elizaOSServicesPlugin.models[ModelType.TEXT_SMALL](runtime as any, {
          prompt: 'test',
        });

        // Check that we get a non-empty string response
        expect(result).toBeTruthy();
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(10);
      } catch (error) {
        // If no API provider is available or API authentication fails, that's expected in test environment
        if (
          error instanceof Error &&
          (error.message.includes('No API provider available') ||
            error.message.includes('API error') ||
            error.message.includes('invalid_api_key') ||
            error.message.includes('Incorrect API key'))
        ) {
          console.log(
            'Skipping test - API provider not available or not configured in test environment'
          );
          expect(error.message).toBeTruthy(); // Just ensure we got an error message
        } else {
          throw error;
        }
      }
    }
  });
});

describe('ElizaOSService', () => {
  it('should start the service', async () => {
    const runtime = createRealRuntime();
    const startResult = await ElizaOSService.start(runtime as any);

    expect(startResult).toBeDefined();
    expect(startResult.constructor.name).toBe('ElizaOSService');

    // Test real functionality - check stop method is available
    expect(typeof startResult.stop).toBe('function');
  });

  it('should stop the service', async () => {
    const runtime = createRealRuntime();

    // Register a real service first
    const service = new ElizaOSService(runtime as any);
    runtime.registerService(ElizaOSService.serviceType, service);

    // Spy on the real service's stop method
    const stopSpy = spyOn(service, 'stop');

    // Call the static stop method
    await ElizaOSService.stop(runtime as any);

    // Verify the service's stop method was called
    expect(stopSpy).toHaveBeenCalled();
  });

  it('should throw an error when stopping a non-existent service', async () => {
    const runtime = createRealRuntime();
    // Don't register a service, so getService will return null

    // We'll patch the getService function to ensure it returns null
    const originalGetService = runtime.getService;
    runtime.getService = () => null;

    await expect(ElizaOSService.stop(runtime as any)).rejects.toThrow('ElizaOS service not found');

    // Restore original getService function
    runtime.getService = originalGetService;
  });
});
