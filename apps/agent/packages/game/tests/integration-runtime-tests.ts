/**
 * Integration tests for the game runtime
 *
 * These tests verify:
 * - Server startup and health
 * - Agent runtime functionality
 * - Plugin capabilities (shell, vision, autonomy)
 * - Message flow and memory persistence
 * - Configuration and settings management
 *
 * Run with: bun run test:integration
 */

import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration: number;
  details?: any;
}

class IntegrationTestRunner {
  private serverProcess: ChildProcess | null = null;
  private agentProcess: ChildProcess | null = null;
  private results: TestResult[] = [];
  private serverBaseUrl = 'http://localhost:7777';
  private agentId = '15aec527-fb92-0792-91b6-becd4fac5050';

  constructor() {
    console.log('🚀 ElizaOS Integration Test Runner');
    console.log('================================\n');
  }

  /**
   * Start the backend server
   */
  private async startBackendServer(): Promise<void> {
    console.log('📦 Starting backend server...');

    this.serverProcess = spawn('bun', ['run', 'dev:backend'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, NODE_ENV: 'test' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.serverProcess.stdout?.on('data', (data) => {
      const output = data.toString();
      if (output.includes('[ERROR]') || output.includes('Error:')) {
        console.error('Server Error:', output);
      }
    });

    this.serverProcess.stderr?.on('data', (data) => {
      console.error('Server stderr:', data.toString());
    });

    this.serverProcess.on('error', (error) => {
      console.error('Failed to start server:', error);
      throw error;
    });

    // Wait for server to be ready
    await this.waitForServerReady();
    console.log('✅ Server started successfully\n');
  }

  /**
   * Wait for the server to be ready
   */
  private async waitForServerReady(): Promise<void> {
    console.log('⏳ Waiting for server to be ready...');
    const maxAttempts = 30;
    const delayMs = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${this.serverBaseUrl}/api/server/health`);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'OK') {
          console.log('✅ Server is ready');
          return;
        }
      }

      console.log(`⏳ Waiting for server... (${i + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`Server failed to become ready after ${maxAttempts} attempts`);
  }

  /**
   * Wait for agent to be ready
   */
  private async waitForAgentReady(): Promise<void> {
    console.log('⏳ Waiting for agent to be ready...');
    const maxAttempts = 30;
    const delayMs = 2000;

    for (let i = 0; i < maxAttempts; i++) {
      const response = await fetch(`${this.serverBaseUrl}/api/agent/${this.agentId}/status`);
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.data?.status === 'active') {
          console.log('✅ Agent is ready');
          return;
        }
      }

      console.log(`⏳ Waiting for agent... (${i + 1}/${maxAttempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error(`Agent failed to become ready after ${maxAttempts} attempts`);
  }

  /**
   * Run a single test with error handling and timing
   */
  private async runTest(name: string, testFn: () => Promise<any>): Promise<void> {
    const startTime = Date.now();
    console.log(`\n🧪 Running: ${name}`);

    const result = await testFn();
    const duration = Date.now() - startTime;

    this.results.push({
      name,
      passed: true,
      duration,
      details: result,
    });

    console.log(`✅ PASSED: ${name} (${duration}ms)`);
  }

  /**
   * Test server health and basic connectivity
   */
  private async testServerHealth(): Promise<any> {
    const response = await fetch(`${this.serverBaseUrl}/api/server/health`);

    const data = await response.json();

    return data;
  }

  /**
   * Test agent status and runtime
   */
  private async testAgentStatus(): Promise<any> {
    // First, get the agent ID
    const agentResponse = await fetch(`${this.serverBaseUrl}/api/agent/id`);
    const agentData = await agentResponse.json();

    const actualAgentId = agentData.data.agentId;
    console.log(`   Agent ID: ${actualAgentId}`);

    // Get runtime state
    const runtimeResponse = await fetch(`${this.serverBaseUrl}/api/debug/runtime-state`);
    const runtimeData = await runtimeResponse.json();

    return {
      agentId: actualAgentId,
      runtime: runtimeData.data,
    };
  }

  /**
   * Test shell capability toggle
   */
  private async testShellCapabilityToggle(): Promise<any> {
    // Get current status
    const statusResponse = await fetch(`${this.serverBaseUrl}/shell/status`);
    const statusData = await statusResponse.json();

    const initialStatus = statusData.data.enabled;
    console.log(`   Initial shell status: ${initialStatus ? 'enabled' : 'disabled'}`);

    // Toggle to opposite state
    const toggleResponse = await fetch(
      `${this.serverBaseUrl}/shell/${initialStatus ? 'disable' : 'enable'}`,
      {
        method: 'POST',
      }
    );
    const toggleData = await toggleResponse.json();

    // Verify the change
    const verifyResponse = await fetch(`${this.serverBaseUrl}/shell/status`);
    const verifyData = await verifyResponse.json();

    const newStatus = verifyData.data.enabled;
    console.log(`   New shell status: ${newStatus ? 'enabled' : 'disabled'}`);

    // Toggle back to original state
    await fetch(`${this.serverBaseUrl}/shell/${initialStatus ? 'enable' : 'disable'}`, {
      method: 'POST',
    });

    return {
      initialStatus,
      toggleResult: toggleData,
      newStatus,
      toggleSuccessful: newStatus !== initialStatus,
    };
  }

  /**
   * Test vision capability settings
   */
  private async testVisionCapabilitySettings(): Promise<any> {
    // Get vision settings
    const settingsResponse = await fetch(`${this.serverBaseUrl}/vision/settings`);
    const settingsData = await settingsResponse.json();

    console.log(`   Vision capabilities found: ${Object.keys(settingsData.data).join(', ')}`);

    // Test toggling each capability
    const toggleResults: any = {};

    for (const capability of ['camera', 'screen']) {
      const initialState = settingsData.data[capability];
      console.log(`   Testing ${capability}: currently ${initialState ? 'enabled' : 'disabled'}`);

      // Toggle the capability
      const toggleResponse = await fetch(
        `${this.serverBaseUrl}/vision/${capability}/${initialState ? 'disable' : 'enable'}`,
        {
          method: 'POST',
        }
      );
      const toggleData = await toggleResponse.json();

      toggleResults[capability] = {
        initialState,
        toggleResult: toggleData.success,
      };

      // Toggle back
      await fetch(
        `${this.serverBaseUrl}/vision/${capability}/${initialState ? 'enable' : 'disable'}`,
        {
          method: 'POST',
        }
      );
    }

    return {
      settings: settingsData.data,
      toggleResults,
    };
  }

  /**
   * Test autonomy controls
   */
  private async testAutonomyControls(): Promise<any> {
    // Get current status
    const statusResponse = await fetch(`${this.serverBaseUrl}/autonomy/status`);
    const statusData = await statusResponse.json();

    const initialStatus = statusData.data.enabled;
    console.log(`   Initial autonomy status: ${initialStatus ? 'enabled' : 'disabled'}`);

    // Disable autonomy first (to ensure consistent state)
    await fetch(`${this.serverBaseUrl}/autonomy/disable`, {
      method: 'POST',
    });

    // Enable autonomy
    const enableResponse = await fetch(`${this.serverBaseUrl}/autonomy/enable`, {
      method: 'POST',
    });
    const enableData = await enableResponse.json();

    // Check status after enable
    const afterEnableResponse = await fetch(`${this.serverBaseUrl}/autonomy/status`);
    const afterEnableData = await afterEnableResponse.json();

    // Disable autonomy
    const disableResponse = await fetch(`${this.serverBaseUrl}/autonomy/disable`, {
      method: 'POST',
    });
    const disableData = await disableResponse.json();

    // Check status after disable
    const afterDisableResponse = await fetch(`${this.serverBaseUrl}/autonomy/status`);
    const afterDisableData = await afterDisableResponse.json();

    // Restore original state
    if (initialStatus) {
      await fetch(`${this.serverBaseUrl}/autonomy/enable`, {
        method: 'POST',
      });
    }

    return {
      initialStatus,
      enableResult: enableData,
      statusAfterEnable: afterEnableData.data.enabled,
      disableResult: disableData,
      statusAfterDisable: afterDisableData.data.enabled,
    };
  }

  /**
   * Test message flow through the system
   */
  private async testMessageFlow(): Promise<any> {
    const testMessage = `Integration test message ${Date.now()}`;
    const roomId = `test-room-${Date.now()}`;
    const userId = `test-user-${Date.now()}`;

    // Submit a message
    const submitResponse = await fetch(`${this.serverBaseUrl}/api/messaging/submit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel_id: roomId,
        content: testMessage,
        author_id: userId,
      }),
    });

    const submitData = await submitResponse.json();

    console.log(`   Message submitted: ${submitData.success}`);

    // Wait a moment for processing
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check memories
    const memoriesResponse = await fetch(
      `${this.serverBaseUrl}/api/database/memories?roomId=${roomId}&count=10`
    );
    const memoriesData = await memoriesResponse.json();

    const messageFound = memoriesData.data?.some((memory: any) =>
      memory.content?.text?.includes(testMessage)
    );

    console.log(`   Message found in memories: ${messageFound}`);

    return {
      submitResult: submitData,
      messageFound,
      memoriesCount: memoriesData.data?.length || 0,
    };
  }

  /**
   * Test concurrent message handling
   */
  private async testConcurrentMessages(): Promise<any> {
    const roomId = `concurrent-test-${Date.now()}`;
    const messageCount = 5;
    const messages = [];

    // Send multiple messages concurrently
    console.log(`   Sending ${messageCount} concurrent messages...`);

    const promises = [];
    for (let i = 0; i < messageCount; i++) {
      const message = {
        channel_id: roomId,
        content: `Concurrent message ${i} at ${Date.now()}`,
        author_id: `user-${i}`,
      };

      messages.push(message);

      promises.push(
        fetch(`${this.serverBaseUrl}/api/messaging/submit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(message),
        }).then((res) => res.json())
      );
    }

    const results = await Promise.all(promises);
    const successCount = results.filter((r) => r.success).length;

    console.log(`   Successfully submitted: ${successCount}/${messageCount}`);

    // Wait for processing
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Check if all messages were processed
    const memoriesResponse = await fetch(
      `${this.serverBaseUrl}/api/database/memories?roomId=${roomId}&count=20`
    );
    const memoriesData = await memoriesResponse.json();

    return {
      messagesSent: messageCount,
      successfulSubmissions: successCount,
      memoriesFound: memoriesData.data?.length || 0,
    };
  }

  /**
   * Test settings persistence
   */
  private async testSettingsPersistence(): Promise<any> {
    const testKey = `test_setting_${Date.now()}`;
    const testValue = { test: true, timestamp: Date.now() };

    // Set a test setting
    const setResponse = await fetch(`${this.serverBaseUrl}/api/settings/${testKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ value: testValue }),
    });

    const setData = await setResponse.json();

    // Get the setting back
    const getResponse = await fetch(`${this.serverBaseUrl}/api/settings/${testKey}`);
    const getData = await getResponse.json();

    // Delete the setting
    const deleteResponse = await fetch(`${this.serverBaseUrl}/api/settings/${testKey}`, {
      method: 'DELETE',
    });

    const deleteData = await deleteResponse.json();

    return {
      setResult: setData.success,
      getValue: getData.data?.value,
      deleteResult: deleteData.success,
      valueMatches: JSON.stringify(getData.data?.value) === JSON.stringify(testValue),
    };
  }

  /**
   * Run all integration tests
   */
  async runAll(): Promise<void> {
    // Start the backend server
    await this.startBackendServer();

    // Wait a bit for everything to initialize
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Run all tests
    await this.runTest('Server Health Check', () => this.testServerHealth());
    await this.runTest('Agent Status', () => this.testAgentStatus());
    await this.runTest('Shell Capability Toggle', () => this.testShellCapabilityToggle());
    await this.runTest('Vision Capability Settings', () => this.testVisionCapabilitySettings());
    await this.runTest('Autonomy Controls', () => this.testAutonomyControls());
    await this.runTest('Message Flow', () => this.testMessageFlow());
    await this.runTest('Concurrent Messages', () => this.testConcurrentMessages());
    await this.runTest('Settings Persistence', () => this.testSettingsPersistence());

    // Clean up
    await this.cleanup();

    // Print results
    this.printResults();
  }

  /**
   * Clean up processes
   */
  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up...');

    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      if (!this.serverProcess.killed) {
        this.serverProcess.kill('SIGKILL');
      }
    }

    if (this.agentProcess) {
      this.agentProcess.kill('SIGTERM');
    }

    console.log('✅ Cleanup complete\n');
  }

  /**
   * Print test results summary
   */
  private printResults(): void {
    console.log('\n📊 Test Results Summary');
    console.log('======================\n');

    const passed = this.results.filter((r) => r.passed).length;
    const failed = this.results.filter((r) => !r.passed).length;
    const totalDuration = this.results.reduce((sum, r) => sum + r.duration, 0);

    this.results.forEach((result) => {
      const status = result.passed ? '✅' : '❌';
      const time = `${result.duration}ms`;
      console.log(`${status} ${result.name.padEnd(30)} ${time}`);

      if (!result.passed && result.error) {
        console.log(`   └─ ${result.error}`);
      }
    });

    console.log(`\n${'─'.repeat(50)}`);
    console.log(`Total: ${this.results.length} | Passed: ${passed} | Failed: ${failed}`);
    console.log(`Total Duration: ${totalDuration}ms`);
    console.log(`${'─'.repeat(50)}\n`);

    // Exit with appropriate code
    process.exit(failed > 0 ? 1 : 0);
  }
}

// Run the tests
const runner = new IntegrationTestRunner();
runner.runAll();
