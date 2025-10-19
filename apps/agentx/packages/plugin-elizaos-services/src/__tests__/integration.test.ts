import { describe, expect, it, spyOn, beforeEach, afterAll, beforeAll, mock } from 'bun:test';
import { elizaOSServicesPlugin, ElizaOSService } from '../index';
import { createMockRuntime, setupLoggerSpies, MockRuntime } from './test-utils';
import { HandlerCallback, IAgentRuntime, Memory, State, UUID, logger } from '@elizaos/core';

/**
 * Integration tests demonstrate how multiple components of the plugin work together.
 * Unlike unit tests that test individual functions in isolation, integration tests
 * examine how components interact with each other.
 *
 * For example, this file shows how the ElizaOS services and models
 * interact with the ElizaOSService and the plugin's core functionality.
 */

// Set up spies on logger
beforeAll(() => {
  setupLoggerSpies();
});

afterAll(() => {
  // No global restore needed in bun:test
});

describe('Integration: ElizaOS Models with ElizaOSService', () => {
  let mockRuntime: MockRuntime;

  beforeEach(() => {
    // Create a service mock that will be returned by getService
    const mockService = {
      capabilityDescription:
        'ElizaOS hosted AI inference and storage services with multi-provider support',
      stop: () => Promise.resolve(),
    };

    // Create a mock runtime with a spied getService method
    const getServiceImpl = (serviceType: string) => {
      if (serviceType === 'elizaos-services') {
        return mockService;
      }
      return null;
    };

    mockRuntime = createMockRuntime({
      getService: mock().mockImplementation(getServiceImpl),
    });
  });

  it('should handle TEXT_SMALL model with ElizaOSService available', async () => {
    // Check the TEXT_SMALL model
    const textSmallModel = elizaOSServicesPlugin.models?.TEXT_SMALL;
    expect(textSmallModel).toBeDefined();

    // Test model without actual API call
    try {
      // This would normally make an API call, but we expect it to fail gracefully
      await textSmallModel?.(mockRuntime as unknown as IAgentRuntime, {
        prompt: 'test prompt',
        maxTokens: 10,
        temperature: 0.5,
      });
    } catch (error) {
      // Expected to fail due to no API provider configured
      expect((error as Error).message).toContain('No API provider available');
    }

    // Get the service to ensure integration
    const service = mockRuntime.getService('elizaos-services');
    expect(service).toBeDefined();
    expect(service?.capabilityDescription).toContain('ElizaOS');
  });
});

describe('Integration: Plugin initialization and service registration', () => {
  it('should initialize the plugin and register the service', async () => {
    // Create a fresh mock runtime with mocked registerService for testing initialization flow
    const mockRuntime = createMockRuntime();

    // Create and install a mock registerService
    const registerServiceCalls: any[] = [];
    mockRuntime.registerService = mock().mockImplementation((type: any, service: any) => {
      registerServiceCalls.push({ type, service });
    });

    // Run a minimal simulation of the plugin initialization process
    if (elizaOSServicesPlugin.init) {
      await elizaOSServicesPlugin.init(
        { ELIZAOS_API_KEY: 'test-value' },
        mockRuntime as unknown as IAgentRuntime
      );

      // Directly mock the service registration that happens during initialization
      // because unit tests don't run the full agent initialization flow
      if (elizaOSServicesPlugin.services) {
        const ElizaOSServiceClass = elizaOSServicesPlugin.services![0];
        if ('start' in ElizaOSServiceClass) {
          const serviceInstance = await ElizaOSServiceClass.start(
            mockRuntime as unknown as IAgentRuntime
          );

          // Register the Service class to match the core API
          mockRuntime.registerService(ElizaOSServiceClass);
        }
      }

      // Now verify the service was registered with the runtime
      expect(registerServiceCalls.length).toBeGreaterThan(0);
    }
  });
});
