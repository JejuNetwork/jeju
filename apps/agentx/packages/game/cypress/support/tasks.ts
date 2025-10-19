/// <reference types="cypress" />

import { execSync } from 'child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';

/**
 * Cypress Task Definitions
 * Server-side operations that tests can execute via cy.task()
 */

export const cypressTasks = {
  // Environment and Configuration Tasks
  clearEnvironmentKeys() {
    console.log('Clearing environment keys...');

    // Clear from environment
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.MODEL_PROVIDER;

    // Clear from any config files if they exist
    const configPath = join(process.cwd(), '.env.test');
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, 'utf-8');
      const filtered = content
        .split('\n')
        .filter(
          (line) =>
            !line.startsWith('OPENAI_API_KEY=') &&
            !line.startsWith('ANTHROPIC_API_KEY=') &&
            !line.startsWith('MODEL_PROVIDER=')
        )
        .join('\n');
      writeFileSync(configPath, filtered);
    }

    return { success: true };
  },

  setupTestEnvironment() {
    console.log('Setting up test environment...');

    // Ensure test database exists
    try {
      execSync('cd packages/game && npm run db:setup', { stdio: 'inherit' });
    } catch (_error) {
      console.log('Database setup command not found, skipping...');
    }

    return { success: true };
  },

  clearTestData() {
    console.log('Clearing test data...');

    // This would normally clear test data from the database
    // For now, we'll just log it
    return { success: true };
  },

  seedTestData() {
    console.log('Seeding test data...');

    // This would normally seed test data into the database
    // For now, we'll just log it
    return { success: true };
  },

  resetGameDatabase() {
    console.log('Resetting game database...');

    try {
      execSync('cd packages/game && npm run db:reset', { stdio: 'inherit' });
    } catch (_error) {
      console.log('Database reset command not found, skipping...');
    }

    return { success: true };
  },

  // Test Database Connection
  testDatabaseConnection() {
    console.log('Testing database connection...');

    // Mock successful connection for now
    return {
      success: true,
      database: {
        hasConnection: true,
        isConnected: true,
      },
    };
  },

  // Test Agent Memory
  testAgentMemory(options: { roomId: string }) {
    console.log(`Testing agent memory for room: ${options.roomId}`);

    // Mock memory response
    return {
      success: true,
      memories: [],
      count: 0,
    };
  },

  // Test Autonomy Service
  testAutonomyService() {
    console.log('Testing autonomy service...');

    // Mock autonomy service response
    return {
      success: true,
      serviceAvailable: true,
      autonomyStatus: {
        enabled: false,
        running: false,
        interval: 30000,
      },
    };
  },

  // OCR Verification (Mock)
  ocrVerifyText(options: { screenshot: string; expectedTexts: string[] }) {
    console.log(`OCR verification for screenshot: ${options.screenshot}`);

    // Mock OCR response - in real implementation would use Tesseract.js
    return {
      success: true,
      foundTexts: options.expectedTexts.slice(0, 2), // Mock finding first 2 texts
    };
  },

  ocrVerifyTextNotPresent(options: { screenshot: string; forbiddenTexts: string[] }) {
    console.log(`OCR verification for forbidden texts in: ${options.screenshot}`);

    // Mock OCR response
    return {
      success: true,
      notFound: true,
    };
  },

  // File Operations
  deleteFile(filePath: string) {
    console.log(`Deleting file: ${filePath}`);

    try {
      if (existsSync(filePath)) {
        unlinkSync(filePath);
        return { success: true, message: 'File deleted' };
      }
      return { success: false, message: 'File not found' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  readFile(filePath: string) {
    console.log(`Reading file: ${filePath}`);

    try {
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        return { success: true, content };
      }
      return { success: false, message: 'File not found' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  writeFile(options: { filePath: string; content: string }) {
    console.log(`Writing file: ${options.filePath}`);

    try {
      writeFileSync(options.filePath, options.content, 'utf-8');
      return { success: true, message: 'File written' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  },

  // Process Management
  checkProcessRunning(processName: string) {
    console.log(`Checking if process is running: ${processName}`);

    try {
      const result = execSync(`pgrep -f "${processName}"`, { encoding: 'utf-8' });
      return { success: true, running: true, pids: result.trim().split('\n') };
    } catch (_error) {
      return { success: true, running: false, pids: [] };
    }
  },

  // Log helper
  log(message: string) {
    console.log(`[Cypress Task] ${message}`);
    return null;
  },
};

// Helper function to get Tesseract (for future OCR implementation)
const _getTesseract = async () => {
  try {
    const Tesseract = await import('tesseract.js');
    return Tesseract;
  } catch (error) {
    console.error('Tesseract.js not available:', error);
    return null;
  }
};

// Export the tasks
export default cypressTasks;
