#!/usr/bin/env node

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const CONTAINER_NAME = 'eliza-postgres';
const NETWORK_NAME = 'eliza-network';
const POSTGRES_IMAGE = 'pgvector/pgvector:pg16';
const POSTGRES_PORT = 5432;
const POSTGRES_USER = 'eliza';
const POSTGRES_PASSWORD = 'eliza_secure_pass';
const POSTGRES_DB = 'eliza';

async function getContainerRuntime() {
  // Check for Podman first (preferred), then Docker
  try {
    await execAsync('podman --version');
    return 'podman';
  } catch {
    try {
      // Check if Docker daemon is actually running
      await execAsync('docker info');
      return 'docker';
    } catch {
      throw new Error(
        'Neither Podman nor Docker found or running. Please install Podman or Docker.'
      );
    }
  }
}

async function createNetwork(runtime) {
  try {
    await execAsync(`${runtime} network create ${NETWORK_NAME}`);
    console.log(`✅ Created network: ${NETWORK_NAME}`);
  } catch (error) {
    // Network might already exist, which is fine
    if (!error.message.includes('already exists')) {
      console.warn(`⚠️  Could not create network: ${error.message}`);
    }
  }
}

async function isContainerRunning(runtime, containerName) {
  try {
    const { stdout } = await execAsync(
      `${runtime} ps --filter name=${containerName} --format "{{.Names}}"`
    );
    return stdout.includes(containerName);
  } catch {
    return false;
  }
}

async function containerExists(runtime, containerName) {
  try {
    const { stdout } = await execAsync(
      `${runtime} ps -a --filter name=${containerName} --format "{{.Names}}"`
    );
    return stdout.includes(containerName);
  } catch {
    return false;
  }
}

async function waitForPostgres(maxAttempts = 30) {
  console.log('⏳ Waiting for PostgreSQL to be ready...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      execSync(
        `PGPASSWORD=${POSTGRES_PASSWORD} psql -h localhost -p ${POSTGRES_PORT} -U ${POSTGRES_USER} -d postgres -c '\\q'`,
        { stdio: 'ignore' }
      );
      console.log('✅ PostgreSQL is ready!');
      return true;
    } catch {
      process.stdout.write('.');
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.error('\n❌ PostgreSQL failed to start within 30 seconds');
  return false;
}

async function startPostgres() {
  try {
    console.log('🐘 Checking PostgreSQL container...');

    const runtime = await getContainerRuntime();
    console.log(`📦 Using container runtime: ${runtime}`);

    // Create network if it doesn't exist
    await createNetwork(runtime);

    // Check if container is already running
    if (await isContainerRunning(runtime, CONTAINER_NAME)) {
      console.log('✅ PostgreSQL container is already running');
      return true;
    }

    // Check if container exists but is stopped
    if (await containerExists(runtime, CONTAINER_NAME)) {
      console.log('🔄 Starting existing PostgreSQL container...');
      await execAsync(`${runtime} start ${CONTAINER_NAME}`);
    } else {
      // Create and start the container
      console.log('🚀 Creating new PostgreSQL container...');
      const initScript = path.join(__dirname, 'init-postgres.sql');

      execSync(
        `${runtime} run -d --name ${CONTAINER_NAME} ` +
          `--network ${NETWORK_NAME} ` +
          `--env POSTGRES_USER=${POSTGRES_USER} ` +
          `--env POSTGRES_PASSWORD=${POSTGRES_PASSWORD} ` +
          `--env POSTGRES_DB=${POSTGRES_DB} ` +
          `--env POSTGRES_INITDB_ARGS='--auth-host=scram-sha-256 --auth-local=scram-sha-256' ` +
          `-p ${POSTGRES_PORT}:5432 ` +
          `-v eliza-postgres-data:/var/lib/postgresql/data ` +
          `-v ${initScript}:/docker-entrypoint-initdb.d/init.sql:z ` +
          POSTGRES_IMAGE,
        { stdio: 'inherit' }
      );
      console.log('✅ PostgreSQL container created and started');
    }

    // Wait for PostgreSQL to be ready
    const isReady = await waitForPostgres();

    if (!isReady) {
      throw new Error('PostgreSQL failed to become ready');
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to start PostgreSQL:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startPostgres();
}

export { startPostgres };
