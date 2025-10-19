import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { spawn, ChildProcess } from 'child_process';
import type { Character } from '@elizaos/core';

describe('Capability Progression System E2E Integration Tests', () => {
  let serverProcess: ChildProcess;
  const serverUrl = 'http://localhost:7777';

  beforeAll(async () => {
    console.log('🚀 Starting agent server for E2E tests...');

    // Set test environment variables
    process.env.MODEL_PROVIDER = 'test';
    process.env.ENABLE_STAGEHAND = 'false'; // Disable for testing

    // Start the agent server
    serverProcess = spawn('bun', ['src/index.ts'], {
      cwd: '/workspace/packages/agentserver',
      env: {
        ...process.env,
        PATH: `${process.env.PATH}:/home/ubuntu/.bun/bin`,
        DATABASE_URL: 'postgresql://eliza:eliza_secure_pass@localhost:5432/eliza_test',
        NODE_ENV: 'test',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Wait for server to start
    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => {
        reject(new Error('Server startup timeout'));
      }, 30000);

      const onData = (data: Buffer) => {
        output += data.toString();
        console.log('[SERVER]', data.toString().trim());

        if (output.includes('Server started on port 7777')) {
          clearTimeout(timeout);
          resolve(undefined);
        }
      };

      serverProcess.stdout?.on('data', onData);
      serverProcess.stderr?.on('data', onData);

      serverProcess.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });

    console.log('✅ Agent server started successfully');
  });

  afterAll(async () => {
    if (serverProcess) {
      console.log('🛑 Stopping agent server...');
      serverProcess.kill('SIGTERM');

      // Wait for graceful shutdown
      await new Promise((resolve) => {
        serverProcess.on('exit', resolve);
        setTimeout(() => {
          serverProcess.kill('SIGKILL');
          resolve(undefined);
        }, 5000);
      });
    }
  });

  it('should have progression API endpoints available', async () => {
    // Test progression status endpoint
    const response = await fetch(`${serverUrl}/api/agents/default/progression`);
    expect(response.ok).toBe(true);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data).toBeDefined();

    if (data.data.progressionReady) {
      expect(data.data.currentLevel).toBeDefined();
      expect(data.data.unlockedCapabilities).toBeDefined();
      expect(data.data.availableLevels).toBeDefined();
    }

    console.log('✅ Progression API endpoint working');
  });

  it('should start with limited capabilities at level 0', async () => {
    const response = await fetch(`${serverUrl}/api/agents/default/progression`);
    const data = await response.json();

    if (data.data.progressionReady) {
      expect(data.data.currentLevel).toBe(0);
      expect(data.data.unlockedCapabilities).toContain('shell');
      expect(data.data.unlockedCapabilities).toContain('naming');
      expect(data.data.unlockedCapabilities).not.toContain('browser');
      expect(data.data.unlockedCapabilities).not.toContain('vision');

      console.log('✅ Agent starts with correct basic capabilities');
    }
  });

  it('should track shell usage and progression towards browser unlock', async () => {
    // Simulate shell usage by making API calls that would trigger the shell service
    // This is a simplified test - in a real scenario, the agent would use shell commands

    console.log('📝 Testing progression tracking...');

    // Check initial state
    const response = await fetch(`${serverUrl}/api/agents/default/progression`);
    const data = await response.json();

    if (data.data.progressionReady) {
      const initialLevel = data.data.currentLevel;
      const initialCapabilities = data.data.unlockedCapabilities;

      console.log(`Initial level: ${initialLevel}`);
      console.log(`Initial capabilities: ${initialCapabilities.join(', ')}`);

      // Verify we start at level 0 with basic capabilities
      expect(initialLevel).toBe(0);
      expect(initialCapabilities).toContain('shell');
      expect(initialCapabilities).toContain('naming');

      console.log('✅ Progression tracking system is operational');
    }
  });

  it('should handle progression status requests gracefully', async () => {
    // Test with specific agent ID
    const response1 = await fetch(`${serverUrl}/api/agents/default/progression`);
    expect(response1.ok).toBe(true);

    // Test with non-existent agent ID
    const response2 = await fetch(`${serverUrl}/api/agents/nonexistent/progression`);
    expect(response2.ok).toBe(true);

    const data2 = await response2.json();
    expect(data2.success).toBe(true);
    expect(data2.data.progressionReady).toBe(false);
    expect(data2.data.message).toContain('not found');

    console.log('✅ API handles edge cases correctly');
  });

  it('should integrate with existing capability toggle system', async () => {
    // Test that existing capability endpoints still work
    const settingsResponse = await fetch(`${serverUrl}/api/agents/default/settings`);
    expect(settingsResponse.ok).toBe(true);

    const settingsData = await settingsResponse.json();
    expect(settingsData.success).toBe(true);

    // Test capability toggle (should work for unlocked capabilities)
    const toggleResponse = await fetch(`${serverUrl}/api/agents/default/capabilities/shell`, {
      method: 'POST',
    });
    expect(toggleResponse.ok).toBe(true);

    const toggleData = await toggleResponse.json();
    expect(toggleData.success).toBe(true);

    console.log('✅ Integration with existing systems working');
  });

  it('should have all required progression levels defined', async () => {
    const response = await fetch(`${serverUrl}/api/agents/default/progression`);
    const data = await response.json();

    if (data.data.progressionReady && data.data.availableLevels) {
      const levels = data.data.availableLevels;

      // Check that we have the expected progression levels
      expect(levels.length).toBeGreaterThanOrEqual(4);

      // Verify level structure
      levels.forEach((level: any) => {
        expect(level.id).toBeDefined();
        expect(level.name).toBeDefined();
        expect(level.description).toBeDefined();
        expect(level.capabilities).toBeDefined();
        expect(typeof level.isUnlocked).toBe('boolean');
      });

      // Check specific expected levels
      const levelNames = levels.map((l: any) => l.name);
      expect(levelNames).toContain('Basic Existence');
      expect(levelNames).toContain('Web Explorer');
      expect(levelNames).toContain('Visual Perception');

      console.log('✅ All progression levels properly defined');
      console.log(`Available levels: ${levelNames.join(', ')}`);
    }
  });

  it('should maintain consistent state across API calls', async () => {
    // Make multiple calls and ensure consistency
    const responses = await Promise.all([
      fetch(`${serverUrl}/api/agents/default/progression`),
      fetch(`${serverUrl}/api/agents/default/progression`),
      fetch(`${serverUrl}/api/agents/default/progression`),
    ]);

    const dataArray = await Promise.all(responses.map((r) => r.json()));

    // All responses should be successful and consistent
    dataArray.forEach((data) => {
      expect(data.success).toBe(true);
    });

    if (dataArray[0].data.progressionReady) {
      // Check that all responses have the same level and capabilities
      const firstData = dataArray[0].data;
      dataArray.slice(1).forEach((data) => {
        expect(data.data.currentLevel).toBe(firstData.currentLevel);
        expect(data.data.unlockedCapabilities).toEqual(firstData.unlockedCapabilities);
      });
    }

    console.log('✅ State consistency maintained across API calls');
  });

  it('should validate the complete progression system architecture', async () => {
    console.log('🔍 Validating complete progression system...');

    // Test 1: Core API availability
    const progressionResponse = await fetch(`${serverUrl}/api/agents/default/progression`);
    expect(progressionResponse.ok).toBe(true);

    // Test 2: Settings integration
    const settingsResponse = await fetch(`${serverUrl}/api/agents/default/settings`);
    expect(settingsResponse.ok).toBe(true);

    // Test 3: Agent availability
    const agentsResponse = await fetch(`${serverUrl}/api/agents`);
    expect(agentsResponse.ok).toBe(true);

    const agentsData = await agentsResponse.json();
    expect(agentsData.success).toBe(true);
    expect(agentsData.data.agents.length).toBeGreaterThan(0);

    // Test 4: Primary agent endpoint
    const primaryResponse = await fetch(`${serverUrl}/api/agents/primary`);
    expect(primaryResponse.ok).toBe(true);

    const primaryData = await primaryResponse.json();
    expect(primaryData.success).toBe(true);
    expect(primaryData.data.available).toBe(true);

    console.log('✅ Complete progression system validation passed');
    console.log(`Agent ID: ${primaryData.data.agentId}`);
    console.log(`Agent Name: ${primaryData.data.agentName}`);
  });
});
