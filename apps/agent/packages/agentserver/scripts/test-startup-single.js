#!/usr/bin/env node

/**
 * ElizaOS Startup Test Script - Single Attempt
 *
 * This script runs a single startup test of the ElizaOS agentserver and:
 * 1. Monitors for PostgreSQL container to be ready
 * 2. Continues monitoring for 30 seconds after PostgreSQL is ready
 * 3. Captures and categorizes any errors that occur
 * 4. Provides a summary of all errors found
 * 5. Exits with code 0 if no errors, code 1 if errors found
 *
 * Usage: node test-startup-single.js
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONTAINER_READY_PATTERN = /Container eliza-postgres status: state=Running/;
const ERROR_PATTERNS = [
  { pattern: /ERROR.*syntax error/, type: 'SQL_SYNTAX' },
  { pattern: /ERROR.*violates foreign key constraint/, type: 'FK_VIOLATION' },
  { pattern: /ERROR:/, type: 'GENERAL_ERROR' },
  { pattern: /CRITICAL:/, type: 'CRITICAL' },
  { pattern: /Failed to/, type: 'FAILURE' },
];

const MONITORING_DURATION = 30000; // 30 seconds
const STARTUP_TIMEOUT = 120000; // 2 minutes to start

class StartupTester {
  constructor() {
    this.errors = [];
    this.logs = [];
    this.postgresReady = false;
    this.process = null;
    this.startTime = null;
  }

  async run() {
    console.log('🚀 Starting ElizaOS startup test (single attempt)...\n');

    console.log('📍 Running startup test');
    console.log('─'.repeat(50));

    const result = await this.runSingleTest();

    if (result.success) {
      console.log('\n✅ SUCCESS! No errors detected during startup.');
      process.exit(0);
    } else {
      console.log(`\n❌ Errors detected. ${result.errors.length} error(s) found.\n`);

      // Display all errors
      console.log('📋 Error Summary:');
      console.log('─'.repeat(50));

      for (const error of result.errors) {
        console.log(`\n🔴 ${error.type}`);
        console.log(`   Time: ${error.timestamp}`);
        console.log(`   Error: ${error.line}`);
        console.log(`   After Postgres Ready: ${error.afterPostgresReady}`);
      }

      // Analyze errors but don't try to fix
      console.log('\n🔍 Error Analysis:');
      console.log('─'.repeat(50));
      await this.analyzeErrors(result.errors);

      // Exit with error code
      process.exit(1);
    }
  }

  async runSingleTest() {
    this.errors = [];
    this.logs = [];
    this.postgresReady = false;
    this.startTime = Date.now();

    return new Promise((resolve) => {
      console.log('📦 Starting bun run dev...');

      // Start the dev server
      this.process = spawn('bun', ['run', 'dev'], {
        cwd: path.resolve(__dirname, '../..'),
        env: { ...process.env, FORCE_COLOR: '1' },
      });

      let postgresReadyTime = null;
      let monitoringStarted = false;
      let monitoringTimeout = null;

      const processLine = (line) => {
        const timestamp = new Date().toISOString();
        this.logs.push({ timestamp, line });

        // Check if postgres is ready
        if (!this.postgresReady && CONTAINER_READY_PATTERN.test(line)) {
          this.postgresReady = true;
          postgresReadyTime = Date.now();
          console.log(
            `\n✅ PostgreSQL container is running! (took ${postgresReadyTime - this.startTime}ms)`
          );
          console.log('📊 Starting 30-second monitoring period...\n');
          monitoringStarted = true;

          // Start 30-second monitoring timer
          monitoringTimeout = setTimeout(() => {
            this.cleanup();
            const success = this.errors.length === 0;
            resolve({ success, errors: this.errors, logs: this.logs });
          }, MONITORING_DURATION);
        }

        // Check for errors
        for (const errorPattern of ERROR_PATTERNS) {
          if (errorPattern.pattern.test(line)) {
            const error = {
              type: errorPattern.type,
              line: line.trim(),
              timestamp,
              afterPostgresReady: this.postgresReady,
            };
            this.errors.push(error);

            if (monitoringStarted) {
              console.log(`❌ ${errorPattern.type}: ${line.trim()}`);
            }
          }
        }

        // Print all lines during monitoring
        if (monitoringStarted && !line.includes('[eliza-postgres]')) {
          // Skip postgres logs unless they're errors
          if (!line.includes('INFO') || line.includes('ERROR')) {
            console.log(`  ${line.trim()}`);
          }
        }
      };

      this.process.stdout.on('data', (data) => {
        const lines = data
          .toString()
          .split('\n')
          .filter((l) => l.trim());
        lines.forEach(processLine);
      });

      this.process.stderr.on('data', (data) => {
        const lines = data
          .toString()
          .split('\n')
          .filter((l) => l.trim());
        lines.forEach(processLine);
      });

      // Timeout if postgres doesn't start
      setTimeout(() => {
        if (!this.postgresReady) {
          console.log('\n⏱️ Timeout: PostgreSQL container did not start within 2 minutes');
          this.cleanup();
          resolve({
            success: false,
            errors: [{ type: 'TIMEOUT', line: 'PostgreSQL container startup timeout' }],
            logs: this.logs,
          });
        }
      }, STARTUP_TIMEOUT);
    });
  }

  async analyzeErrors(errors) {
    const sqlSyntaxErrors = errors.filter((e) => e.type === 'SQL_SYNTAX');
    const fkViolations = errors.filter((e) => e.type === 'FK_VIOLATION');
    const criticalErrors = errors.filter((e) => e.type === 'CRITICAL');
    const generalErrors = errors.filter((e) => e.type === 'GENERAL_ERROR');
    const failures = errors.filter((e) => e.type === 'FAILURE');

    if (sqlSyntaxErrors.length > 0) {
      console.log(`\n📝 SQL Syntax Errors (${sqlSyntaxErrors.length}):`);
      for (const error of sqlSyntaxErrors) {
        console.log(`   - ${error.line}`);

        // Check for the specific "IF NOT EXISTS" issue
        if (error.line.includes('ADD CONSTRAINT IF NOT EXISTS')) {
          console.log('     💡 PostgreSQL doesn\'t support "IF NOT EXISTS" with ADD CONSTRAINT.');
          console.log('        Need to check constraint existence before adding.');
        }
      }
    }

    if (fkViolations.length > 0) {
      console.log(`\n🔗 Foreign Key Violations (${fkViolations.length}):`);
      for (const error of fkViolations) {
        console.log(`   - ${error.line}`);
      }
      console.log('   💡 Data is being inserted before the referenced records exist.');
      console.log('      Need to fix data initialization order.');
    }

    if (criticalErrors.length > 0) {
      console.log(`\n🚨 Critical Errors (${criticalErrors.length}):`);
      for (const error of criticalErrors) {
        console.log(`   - ${error.line}`);
      }
    }

    if (generalErrors.length > 0) {
      console.log(`\n⚠️  General Errors (${generalErrors.length}):`);
      for (const error of generalErrors) {
        console.log(`   - ${error.line}`);
      }
    }

    if (failures.length > 0) {
      console.log(`\n❌ Failures (${failures.length}):`);
      for (const error of failures) {
        console.log(`   - ${error.line}`);
      }
    }
  }

  cleanup() {
    if (this.process) {
      console.log('\n🛑 Stopping dev server...');
      this.process.kill('SIGTERM');
      this.process = null;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Run the test
const tester = new StartupTester();
tester.run().catch(console.error);
