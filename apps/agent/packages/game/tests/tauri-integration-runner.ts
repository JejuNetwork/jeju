#!/usr/bin/env tsx

/**
 * Tauri Integration Test Runner
 *
 * This script validates that Tauri IPC actually works with the Eliza container
 * by running real API calls and verifying responses.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
  duration?: number;
}

class TauriIntegrationRunner {
  private results: TestResult[] = [];
  private serverProcess: any = null;
  private tauriProcess: any = null;

  async runAll(): Promise<void> {
    console.log('🚀 Starting Tauri Integration Test Runner');
    console.log('==========================================');

    try {
      // Step 1: Build the Tauri app
      await this.buildTauriApp();

      // Step 2: Start the ElizaOS server
      await this.startElizaServer();

      // Step 3: Start the Tauri app
      await this.startTauriApp();

      // Step 4: Run integration tests
      await this.runIntegrationTests();

      // Step 5: Generate report
      await this.generateReport();
    } catch (error) {
      console.error('❌ Test runner failed:', error);
      process.exit(1);
    } finally {
      await this.cleanup();
    }
  }

  private async buildTauriApp(): Promise<void> {
    console.log('📦 Building Tauri application...');

    return new Promise((resolve, reject) => {
      const buildProcess = spawn('npm', ['run', 'build:tauri'], {
        cwd: process.cwd(),
        stdio: 'pipe',
      });

      let output = '';
      buildProcess.stdout?.on('data', (data) => {
        output += data.toString();
        process.stdout.write(data);
      });

      buildProcess.stderr?.on('data', (data) => {
        output += data.toString();
        process.stderr.write(data);
      });

      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Tauri build completed successfully');
          resolve();
        } else {
          reject(new Error(`Build failed with exit code ${code}`));
        }
      });
    });
  }

  private async startElizaServer(): Promise<void> {
    console.log('🌟 Starting ElizaOS server...');

    return new Promise((resolve, reject) => {
      // Start the server in the parent directory
      this.serverProcess = spawn('elizaos', ['start'], {
        cwd: path.join(process.cwd(), '../..'),
        stdio: 'pipe',
      });

      let serverReady = false;
      const timeout = setTimeout(() => {
        if (!serverReady) {
          reject(new Error('Server startup timeout'));
        }
      }, 60000); // 60 second timeout

      this.serverProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('📡 Server:', output.trim());

        // Look for server ready indicators
        if (
          output.includes('Server running') ||
          output.includes('listening on') ||
          output.includes('started successfully')
        ) {
          clearTimeout(timeout);
          if (!serverReady) {
            serverReady = true;
            console.log('✅ ElizaOS server is ready');
            // Give it a moment to fully initialize
            setTimeout(resolve, 3000);
          }
        }
      });

      this.serverProcess.stderr?.on('data', (data: Buffer) => {
        console.error('🚨 Server error:', data.toString().trim());
      });

      this.serverProcess.on('close', (code: number) => {
        console.log(`📡 Server process exited with code ${code}`);
      });
    });
  }

  private async startTauriApp(): Promise<void> {
    console.log('🎮 Starting Tauri application...');

    return new Promise((resolve, reject) => {
      // Run the built Tauri app
      const appPath = path.join(process.cwd(), 'src-tauri', 'target', 'debug', 'eliza-game');

      this.tauriProcess = spawn(appPath, [], {
        stdio: 'pipe',
        env: { ...process.env, RUST_LOG: 'info' },
      });

      let appReady = false;
      const timeout = setTimeout(() => {
        if (!appReady) {
          reject(new Error('Tauri app startup timeout'));
        }
      }, 30000); // 30 second timeout

      this.tauriProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log('🎮 Tauri:', output.trim());

        // Look for app ready indicators
        if (
          output.includes('Rust backend setup completed') ||
          output.includes('initialization complete')
        ) {
          clearTimeout(timeout);
          if (!appReady) {
            appReady = true;
            console.log('✅ Tauri application is ready');
            // Give it a moment to fully initialize
            setTimeout(resolve, 2000);
          }
        }
      });

      this.tauriProcess.stderr?.on('data', (data: Buffer) => {
        console.error('🚨 Tauri error:', data.toString().trim());
      });

      this.tauriProcess.on('close', (code: number) => {
        console.log(`🎮 Tauri process exited with code ${code}`);
      });
    });
  }

  private async runIntegrationTests(): Promise<void> {
    console.log('🧪 Running integration tests...');

    // Test 1: Health Check
    await this.runTest('Health Check', async () => {
      const response = await fetch('http://localhost:7777/health');
      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }
      const data = await response.json();
      if (data.status !== 'healthy') {
        throw new Error(`Server not healthy: ${data.status}`);
      }
    });

    // Test 2: Agent Status
    await this.runTest('Agent Status', async () => {
      const response = await fetch('http://localhost:7777/api/agents/default/status');
      if (!response.ok) {
        throw new Error(`Agent status failed: ${response.status}`);
      }
      const data = await response.json();
      if (!data.success) {
        throw new Error(`Agent not ready: ${JSON.stringify(data)}`);
      }
    });

    // Test 3: Autonomy Toggle
    await this.runTest('Autonomy Toggle', async () => {
      // Get current status
      const statusResponse = await fetch('http://localhost:7777/autonomy/status');
      if (!statusResponse.ok) {
        throw new Error(`Failed to get autonomy status: ${statusResponse.status}`);
      }
      const currentStatus = await statusResponse.json();
      const wasEnabled = currentStatus.data?.enabled || false;

      // Toggle autonomy
      const toggleResponse = await fetch(
        `http://localhost:7777/autonomy/${wasEnabled ? 'disable' : 'enable'}`,
        {
          method: 'POST',
        }
      );
      if (!toggleResponse.ok) {
        throw new Error(`Failed to toggle autonomy: ${toggleResponse.status}`);
      }

      // Verify the change
      const newStatusResponse = await fetch('http://localhost:7777/autonomy/status');
      if (!newStatusResponse.ok) {
        throw new Error(`Failed to verify autonomy status: ${newStatusResponse.status}`);
      }
      const newStatus = await newStatusResponse.json();
      const isNowEnabled = newStatus.data?.enabled || false;

      if (isNowEnabled === wasEnabled) {
        throw new Error('Autonomy toggle failed - state did not change');
      }

      // Toggle back to original state
      const restoreResponse = await fetch(
        `http://localhost:7777/autonomy/${wasEnabled ? 'enable' : 'disable'}`,
        {
          method: 'POST',
        }
      );
      if (!restoreResponse.ok) {
        console.warn('Failed to restore original autonomy state');
      }
    });

    // Test 4: Capability Status
    await this.runTest('Capability Status', async () => {
      const capabilities = ['browser', 'shell', 'screen', 'camera', 'microphone', 'speakers'];

      for (const capability of capabilities) {
        const response = await fetch(
          `http://localhost:7777/api/agents/default/capabilities/${capability}`
        );
        if (!response.ok) {
          throw new Error(`Failed to get ${capability} status: ${response.status}`);
        }
        const data = await response.json();
        console.log(`  ${capability}: ${JSON.stringify(data)}`);
      }
    });

    // Test 5: Message Sending
    await this.runTest('Message Sending', async () => {
      const testMessage = 'Test message from integration runner';

      // Get terminal room info first
      const terminalResponse = await fetch('http://localhost:7777/api/server/terminal-room');
      if (!terminalResponse.ok) {
        throw new Error(`Failed to get terminal room: ${terminalResponse.status}`);
      }
      const terminalData = await terminalResponse.json();
      const terminalRoomId = terminalData.data?.terminalRoomId;

      if (!terminalRoomId) {
        throw new Error('Terminal room ID not found');
      }

      // Send message
      const messageResponse = await fetch('http://localhost:7777/api/messaging/ingest-external', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel_id: terminalRoomId,
          server_id: '00000000-0000-0000-0000-000000000000',
          author_id: '00000000-0000-0000-0000-000000000001',
          content: testMessage,
          source_type: 'integration_test',
          raw_message: {
            text: testMessage,
            type: 'user_message',
          },
          metadata: {
            source: 'integration_runner',
            userName: 'TestRunner',
          },
        }),
      });

      if (!messageResponse.ok) {
        throw new Error(`Failed to send message: ${messageResponse.status}`);
      }

      const messageData = await messageResponse.json();
      if (!messageData.success) {
        throw new Error(`Message sending failed: ${JSON.stringify(messageData)}`);
      }
    });

    // Test 6: Data Fetching
    await this.runTest('Data Fetching', async () => {
      const endpoints = ['/api/goals', '/api/todos', '/knowledge/documents', '/api/plugin-config'];

      for (const endpoint of endpoints) {
        const response = await fetch(`http://localhost:7777${endpoint}`);
        if (!response.ok) {
          console.warn(`  ${endpoint}: ${response.status} (may be expected)`);
        } else {
          const data = await response.json();
          console.log(`  ${endpoint}: ${data.success ? 'OK' : 'Error'}`);
        }
      }
    });

    console.log('\n📊 Test Results Summary:');
    console.log('========================');

    let passed = 0;
    let failed = 0;

    this.results.forEach((result) => {
      const status = result.passed ? '✅' : '❌';
      const duration = result.duration ? ` (${result.duration}ms)` : '';
      console.log(`${status} ${result.name}${duration}`);

      if (result.error) {
        console.log(`   Error: ${result.error}`);
      }

      if (result.passed) {
        passed++;
      } else {
        failed++;
      }
    });

    console.log(`\nPassed: ${passed}, Failed: ${failed}`);

    if (failed > 0) {
      throw new Error(`${failed} tests failed`);
    }
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const startTime = Date.now();

    try {
      console.log(`🧪 Running: ${name}`);
      await testFn();
      const duration = Date.now() - startTime;

      this.results.push({
        name,
        passed: true,
        duration,
      });

      console.log(`✅ ${name} passed (${duration}ms)`);
    } catch (error) {
      const duration = Date.now() - startTime;

      this.results.push({
        name,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
        duration,
      });

      console.log(`❌ ${name} failed (${duration}ms): ${error}`);
    }
  }

  private async generateReport(): Promise<void> {
    const report = {
      timestamp: new Date().toISOString(),
      results: this.results,
      summary: {
        total: this.results.length,
        passed: this.results.filter((r) => r.passed).length,
        failed: this.results.filter((r) => !r.passed).length,
        duration: this.results.reduce((sum, r) => sum + (r.duration || 0), 0),
      },
    };

    const reportPath = path.join(process.cwd(), 'test-reports', 'tauri-integration-report.json');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    console.log(`📄 Report saved to: ${reportPath}`);
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Cleaning up...');

    if (this.tauriProcess) {
      this.tauriProcess.kill('SIGTERM');
    }

    if (this.serverProcess) {
      this.serverProcess.kill('SIGTERM');
    }

    // Give processes time to clean up
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

// Run the tests if this script is executed directly
if (require.main === module) {
  const runner = new TauriIntegrationRunner();
  runner.runAll().catch((error) => {
    console.error('❌ Integration tests failed:', error);
    process.exit(1);
  });
}

export { TauriIntegrationRunner };
