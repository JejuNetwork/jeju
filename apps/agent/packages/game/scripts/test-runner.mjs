#!/usr/bin/env node

/**
 * E2E Test Runner for ElizaOS Game
 * Manages backend and frontend servers, runs Cypress tests, and cleans up
 */

import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import fetch from 'node-fetch';
import { createWriteStream } from 'fs';
import { readFileSync } from 'fs';

// Get the directory name for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  reset: '\x1b[0m',
};

// Configuration
const BACKEND_PORT = 7777;
const FRONTEND_PORT = 5173;
const BACKEND_DIR = join(__dirname, '..', '..', 'agentserver');
const GAME_DIR = join(__dirname, '..');
const TIMEOUT_SECONDS = 60;
const BACKEND_URL = `http://localhost:${BACKEND_PORT}`;

let backendProcess = null;
let frontendProcess = null;
let exitCode = 0;

// Helper function to check if a server is running
async function checkServer(url, maxAttempts = TIMEOUT_SECONDS) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status < 500) {
        return true;
      }
    } catch (_error) {
      // Server not ready yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
    process.stdout.write('.');
  }
  return false;
}

// Start backend server
async function startBackend() {
  console.log(`${colors.yellow}Starting backend server...${colors.reset}`);
  const backendLogStream = createWriteStream(join(GAME_DIR, 'backend.log'));

  return new Promise((resolve, reject) => {
    // Start backend directly with environment variables for local PostgreSQL
    backendProcess = spawn(
      'env',
      [
        'EMBEDDING_PROVIDER=local_embedding',
        'MODEL_PROVIDER=openai',
        'TEXT_PROVIDER=openai',
        'ANTHROPIC_API_KEY=',
        'OLLAMA_ENABLED=false',
        'bun',
        'src/index.ts',
      ],
      {
        cwd: BACKEND_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    backendProcess.stdout.pipe(backendLogStream);
    backendProcess.stderr.pipe(backendLogStream);

    const timer = setTimeout(() => {
      console.log(`\n${colors.red}✗ Backend failed to start${colors.reset}`);

      // Read the last part of the log file to show what happened
      try {
        const logContent = readFileSync(join(GAME_DIR, 'backend.log'), 'utf8');
        console.log('Last output:', logContent.slice(-500));
      } catch {
        console.log('Could not read backend log');
      }

      reject(new Error('Backend startup timeout'));
    }, 60000);

    // Check if backend started successfully
    const checkInterval = setInterval(async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/server/health`);
        if (response.ok) {
          clearInterval(checkInterval);
          clearTimeout(timer);
          console.log(`${colors.green}✓ Backend started successfully${colors.reset}`);
          resolve();
        }
      } catch {
        process.stdout.write('.');
      }
    }, 1000);

    backendProcess.on('error', (error) => {
      clearInterval(checkInterval);
      clearTimeout(timer);
      console.log(`${colors.red}✗ Backend process error: ${error}${colors.reset}`);
      reject(error);
    });

    backendProcess.on('exit', (code) => {
      clearInterval(checkInterval);
      clearTimeout(timer);
      if (code !== 0) {
        console.log(`${colors.red}✗ Backend exited with code ${code}${colors.reset}`);
        reject(new Error(`Backend exited with code ${code}`));
      }
    });
  });
}

// Start frontend server
async function startFrontend() {
  console.log(`${colors.yellow}Starting frontend server...${colors.reset}`);
  const frontendLogStream = createWriteStream(join(GAME_DIR, 'frontend.log'));

  return new Promise((resolve, reject) => {
    frontendProcess = spawn('npx', ['vite', '--host'], {
      cwd: GAME_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    frontendProcess.stdout.pipe(frontendLogStream);
    frontendProcess.stderr.pipe(frontendLogStream);

    frontendProcess.on('error', (error) => {
      console.error(`${colors.red}Frontend failed to start:${colors.reset}`, error);
      reject(error);
    });

    // Check if frontend is ready
    process.stdout.write('Waiting for frontend to start');
    checkServer(`http://localhost:${FRONTEND_PORT}`).then((isRunning) => {
      if (isRunning) {
        console.log(`\n${colors.green}✓ Frontend is ready!${colors.reset}`);
        resolve();
      } else {
        console.log(`\n${colors.red}✗ Frontend failed to start${colors.reset}`);
        try {
          const logContent = readFileSync(join(GAME_DIR, 'frontend.log'), 'utf8');
          console.log('Last output:', logContent.slice(-500));
        } catch {
          console.log('Could not read frontend log');
        }
        reject(new Error('Frontend failed to start'));
      }
    });
  });
}

// Run Cypress tests
function runTests() {
  console.log(`\n${colors.yellow}Running E2E tests...${colors.reset}`);
  console.log('=================================');

  return new Promise((resolve) => {
    const cypress = spawn(
      'npx',
      ['cypress', 'run', '--spec', 'cypress/e2e/**/*.cy.ts', '--reporter', 'spec'],
      {
        cwd: GAME_DIR,
        stdio: 'inherit',
      }
    );

    cypress.on('close', (code) => {
      exitCode = code || 0;
      resolve();
    });

    cypress.on('error', (error) => {
      console.error(`${colors.red}Cypress failed:${colors.reset}`, error);
      exitCode = 1;
      resolve();
    });
  });
}

// Cleanup function
function cleanup() {
  console.log(`\n${colors.yellow}Cleaning up...${colors.reset}`);

  if (backendProcess) {
    console.log('Stopping backend server...');
    backendProcess.kill('SIGTERM');
  }

  if (frontendProcess) {
    console.log('Stopping frontend server...');
    frontendProcess.kill('SIGTERM');
  }

  // Force kill after 5 seconds if processes don't exit gracefully
  setTimeout(() => {
    if (backendProcess) backendProcess.kill('SIGKILL');
    if (frontendProcess) frontendProcess.kill('SIGKILL');
    process.exit(exitCode);
  }, 5000);
}

// Handle exit signals
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

// Main execution
async function main() {
  console.log(`${colors.yellow}🚀 Starting E2E Test Suite...${colors.reset}\n`);

  try {
    // Check if servers are already running
    const backendRunning = await checkServer(
      `http://localhost:${BACKEND_PORT}/api/server/health`,
      3
    );
    const frontendRunning = await checkServer(`http://localhost:${FRONTEND_PORT}`, 3);

    if (!backendRunning) {
      await startBackend();
    } else {
      console.log(`${colors.green}✓ Backend is already running${colors.reset}`);
    }

    if (!frontendRunning) {
      await startFrontend();
    } else {
      console.log(`${colors.green}✓ Frontend is already running${colors.reset}`);
    }

    // Run the tests
    await runTests();

    // Summary
    console.log('\n=================================');
    if (exitCode === 0) {
      console.log(`${colors.green}✓ All E2E tests passed!${colors.reset}`);
    } else {
      console.log(`${colors.red}✗ Some tests failed (exit code: ${exitCode})${colors.reset}`);
      console.log(
        `${colors.yellow}Check the screenshots and videos in cypress/screenshots and cypress/videos${colors.reset}`
      );
    }
  } catch (error) {
    console.error(`${colors.red}Error:${colors.reset}`, error.message);
    exitCode = 1;
  } finally {
    cleanup();
  }
}

// Run the main function
main().catch((error) => {
  console.error(`${colors.red}Unexpected error:${colors.reset}`, error);
  exitCode = 1;
  cleanup();
});
