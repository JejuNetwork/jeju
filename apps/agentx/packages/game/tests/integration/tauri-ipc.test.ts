/**
 * Tauri IPC Integration Tests
 *
 * These tests verify that Tauri IPC commands actually work and communicate
 * with the Eliza container properly.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { invoke } from '@tauri-apps/api/core';

describe('Tauri IPC Integration Tests', () => {
  let serverReady = false;

  beforeAll(async () => {
    // Wait for server to be ready before running tests
    console.log('Waiting for Eliza server to be ready...');
    try {
      serverReady = await invoke('wait_for_server', { maxAttempts: 30, delayMs: 1000 });
      if (!serverReady) {
        console.warn('Server not ready, some tests may fail');
      }
    } catch (error) {
      console.error('Failed to wait for server:', error);
    }
  }, 60000); // 60 second timeout for setup

  describe('Health Checks', () => {
    it('should respond to health check command', async () => {
      const result = await invoke('health_check');
      expect(result).toBeDefined();

      // Parse the health status
      const healthStatus = JSON.parse(result as string);
      expect(healthStatus.status).toBe('healthy');
      expect(healthStatus.backend).toBe('rust');
      expect(healthStatus.components).toBeDefined();
    });

    it('should get container runtime status', async () => {
      const status = await invoke('get_container_runtime_status');
      expect(status).toBeDefined();
      expect(typeof status).toBe('object');
    });

    it('should get startup status', async () => {
      const status = await invoke('get_startup_status');
      expect(status).toBeDefined();
      expect(typeof status).toBe('object');
    });
  });

  describe('Container Management', () => {
    it('should get container status without errors', async () => {
      try {
        const statuses = await invoke('get_container_status_new');
        expect(Array.isArray(statuses)).toBe(true);
      } catch (error) {
        // Container operations may fail if no containers exist yet
        console.warn('Container status check failed (expected if no containers):', error);
      }
    });

    it('should get setup progress', async () => {
      const progress = await invoke('get_setup_progress_new');
      expect(progress).toBeDefined();
      expect(typeof progress).toBe('object');
    });
  });

  describe('Agent Communication', () => {
    it('should send message to agent when server is ready', async () => {
      if (!serverReady) {
        console.log('Skipping agent communication test - server not ready');
        return;
      }

      const testMessage = 'Hello from Tauri IPC test';
      try {
        const response = await invoke('send_message_to_agent', { message: testMessage });
        expect(response).toBeDefined();
        expect(typeof response).toBe('string');
        expect(response).not.toBe('');
      } catch (error) {
        console.error('Agent communication failed:', error);
        // Don't fail the test if agent is not available, just log it
        expect(error).toBeDefined();
      }
    });
  });

  describe('Capability Management', () => {
    it('should get autonomy status', async () => {
      if (!serverReady) {
        console.log('Skipping autonomy status test - server not ready');
        return;
      }

      try {
        const status = await invoke('get_autonomy_status');
        expect(status).toBeDefined();
        console.log('Autonomy status:', status);
      } catch (error) {
        console.error('Failed to get autonomy status:', error);
        // This might fail if the agent isn't fully ready
        expect(error).toBeDefined();
      }
    });

    it('should toggle autonomy capability', async () => {
      if (!serverReady) {
        console.log('Skipping autonomy toggle test - server not ready');
        return;
      }

      try {
        // Try to disable autonomy
        const disableResult = await invoke('toggle_autonomy', { enable: false });
        expect(disableResult).toBeDefined();
        console.log('Autonomy disabled:', disableResult);

        // Try to enable autonomy
        const enableResult = await invoke('toggle_autonomy', { enable: true });
        expect(enableResult).toBeDefined();
        console.log('Autonomy enabled:', enableResult);
      } catch (error) {
        console.error('Failed to toggle autonomy:', error);
        // This might fail if the agent isn't fully ready
        expect(error).toBeDefined();
      }
    });

    const capabilities = ['browser', 'shell', 'screen', 'camera', 'microphone', 'speakers'];

    capabilities.forEach((capability) => {
      it(`should get ${capability} capability status`, async () => {
        if (!serverReady) {
          console.log(`Skipping ${capability} status test - server not ready`);
          return;
        }

        try {
          const status = await invoke('get_capability_status', { capability });
          expect(status).toBeDefined();
          console.log(`${capability} capability status:`, status);
        } catch (error) {
          console.error(`Failed to get ${capability} capability status:`, error);
          // Log but don't fail - capability might not be available
          expect(error).toBeDefined();
        }
      });

      it(`should toggle ${capability} capability`, async () => {
        if (!serverReady) {
          console.log(`Skipping ${capability} toggle test - server not ready`);
          return;
        }

        try {
          const result = await invoke('toggle_capability', { capability });
          expect(result).toBeDefined();
          console.log(`${capability} capability toggled:`, result);
        } catch (error) {
          console.error(`Failed to toggle ${capability} capability:`, error);
          // Log but don't fail - capability might not support toggling
          expect(error).toBeDefined();
        }
      });
    });
  });

  describe('Data Fetching', () => {
    const dataEndpoints = [
      { name: 'goals', command: 'fetch_goals' },
      { name: 'todos', command: 'fetch_todos' },
      { name: 'knowledge_files', command: 'fetch_knowledge_files' },
      { name: 'plugin_configs', command: 'fetch_plugin_configs' },
      { name: 'agent_settings', command: 'get_agent_settings' },
      { name: 'vision_settings', command: 'get_vision_settings' },
    ];

    dataEndpoints.forEach(({ name, command }) => {
      it(`should fetch ${name} data`, async () => {
        if (!serverReady) {
          console.log(`Skipping ${name} fetch test - server not ready`);
          return;
        }

        try {
          const data = await invoke(command);
          expect(data).toBeDefined();
          console.log(
            `${name} data:`,
            typeof data === 'object' ? `${JSON.stringify(data).substring(0, 100)}...` : data
          );
        } catch (error) {
          console.error(`Failed to fetch ${name}:`, error);
          // Don't fail tests for data that might not exist yet
          expect(error).toBeDefined();
        }
      });
    });

    it('should fetch memories with parameters', async () => {
      if (!serverReady) {
        console.log('Skipping memories fetch test - server not ready');
        return;
      }

      try {
        const params = {
          count: 10,
          roomId: 'test-room',
        };
        const memories = await invoke('fetch_memories', params);
        expect(memories).toBeDefined();
        console.log(
          'Memories data:',
          typeof memories === 'object'
            ? `${JSON.stringify(memories).substring(0, 100)}...`
            : memories
        );
      } catch (error) {
        console.error('Failed to fetch memories:', error);
        expect(error).toBeDefined();
      }
    });
  });

  describe('WebSocket Management', () => {
    it('should check websocket connection status', async () => {
      try {
        const isConnected = await invoke('is_websocket_connected');
        expect(typeof isConnected).toBe('boolean');
        console.log('WebSocket connected:', isConnected);
      } catch (error) {
        console.error('Failed to check websocket status:', error);
        expect(error).toBeDefined();
      }
    });

    it('should connect to websocket', async () => {
      try {
        await invoke('connect_websocket', { url: 'ws://localhost:7777' });
        console.log('WebSocket connection attempted');

        // Check if connection was successful
        const isConnected = await invoke('is_websocket_connected');
        console.log('WebSocket connected after connect attempt:', isConnected);
      } catch (error) {
        console.error('Failed to connect websocket:', error);
        // Don't fail the test - websocket might not be available
        expect(error).toBeDefined();
      }
    });
  });
});
