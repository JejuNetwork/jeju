/**
 * Infrastructure Service
 * 
 * Manages all required infrastructure for Jeju development:
 * - CQL (CovenantSQL) - runs natively via packages/db
 * - Docker services (IPFS, Cache, DA)
 * - Localnet (Anvil)
 * 
 * CQL is ALWAYS started - it's the core database for all apps.
 * NO FALLBACKS - all infrastructure must be running.
 */

import { execa, type ExecaChildProcess } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';
import { logger } from '../lib/logger';
import { DEFAULT_PORTS } from '../types';

export interface ServiceHealth {
  name: string;
  port: number;
  healthy: boolean;
  url: string;
}

export interface InfrastructureStatus {
  docker: boolean;
  cql: boolean;
  services: ServiceHealth[];
  localnet: boolean;
  allHealthy: boolean;
}

// CQL runs natively - not in Docker
const CQL_PORT = 4661;
const CQL_DATA_DIR = '.data/cql';

// Docker services (excludes CQL which runs natively)
// Only IPFS is required - cache and da are optional services not yet implemented
const DOCKER_SERVICES = {
  ipfs: { port: 5001, healthPath: '/api/v0/id', name: 'IPFS', container: 'jeju-ipfs', required: true },
} as const;

// Optional services (not yet implemented)
const OPTIONAL_DOCKER_SERVICES = {
  cache: { port: 4115, healthPath: '/health', name: 'Cache Service', container: 'jeju-cache' },
  da: { port: 4010, healthPath: '/health', name: 'DA Server', container: 'jeju-da' },
} as const;

const LOCALNET_PORT = DEFAULT_PORTS.l2Rpc;

// Track CQL process
let cqlProcess: ExecaChildProcess | null = null;

export class InfrastructureService {
  private rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  // ============================================================================
  // CQL (CovenantSQL) - Runs natively, not in Docker
  // ============================================================================

  /**
   * Check if CQL is running
   */
  async isCQLRunning(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${CQL_PORT}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start CQL server natively
   */
  async startCQL(): Promise<boolean> {
    if (await this.isCQLRunning()) {
      logger.success('CQL already running');
      return true;
    }

    logger.step('Starting CQL (CovenantSQL)...');

    const cqlServerPath = join(this.rootDir, 'packages/db/src/server.ts');
    if (!existsSync(cqlServerPath)) {
      logger.error('CQL server not found at packages/db/src/server.ts');
      return false;
    }

    // Start CQL server in background
    cqlProcess = execa('bun', ['run', cqlServerPath], {
      cwd: this.rootDir,
      env: {
        ...process.env,
        PORT: String(CQL_PORT),
        CQL_PORT: String(CQL_PORT),
        CQL_DATA_DIR: join(this.rootDir, CQL_DATA_DIR),
      },
      stdio: 'pipe',
      detached: true,
    });

    cqlProcess.unref();

    // Wait for CQL to be ready
    for (let i = 0; i < 30; i++) {
      await this.sleep(500);
      if (await this.isCQLRunning()) {
        logger.success(`CQL running on port ${CQL_PORT}`);
        return true;
      }
    }

    logger.error('CQL failed to start within 15 seconds');
    return false;
  }

  /**
   * Stop CQL server
   */
  async stopCQL(): Promise<void> {
    if (cqlProcess) {
      cqlProcess.kill('SIGTERM');
      cqlProcess = null;
    }
    // Also kill any orphaned CQL processes
    await execa('pkill', ['-f', 'packages/db/src/server.ts'], { reject: false });
  }

  // ============================================================================
  // Docker
  // ============================================================================

  /**
   * Check if Docker is running
   */
  async isDockerRunning(): Promise<boolean> {
    try {
      const result = await execa('docker', ['info'], { 
        timeout: 10000,
        reject: false,
      });
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }

  /**
   * Check if Docker is installed
   */
  async isDockerInstalled(): Promise<boolean> {
    try {
      await execa('docker', ['--version'], { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Attempt to start Docker
   * - macOS: Opens Docker Desktop
   * - Linux: Attempts to start docker service
   */
  async startDocker(): Promise<boolean> {
    const os = platform();
    
    logger.step('Starting Docker...');

    if (os === 'darwin') {
      // macOS - open Docker Desktop
      try {
        await execa('open', ['-a', 'Docker'], { reject: false });
        
        // Wait for Docker to be ready (up to 60 seconds)
        for (let i = 0; i < 60; i++) {
          await this.sleep(1000);
          if (await this.isDockerRunning()) {
            logger.success('Docker started');
            return true;
          }
          if (i % 10 === 9) {
            logger.info(`  Waiting for Docker to start... (${i + 1}s)`);
          }
        }
        
        logger.error('Docker failed to start within 60 seconds');
        return false;
      } catch {
        logger.error('Failed to start Docker Desktop');
        return false;
      }
    } else if (os === 'linux') {
      // Linux - try to start docker service
      try {
        await execa('sudo', ['systemctl', 'start', 'docker'], { 
          timeout: 30000,
          reject: false,
        });
        
        // Wait for Docker to be ready
        for (let i = 0; i < 30; i++) {
          await this.sleep(1000);
          if (await this.isDockerRunning()) {
            logger.success('Docker started');
            return true;
          }
        }
        
        return false;
      } catch {
        logger.error('Failed to start Docker service');
        logger.info('  Try: sudo systemctl start docker');
        return false;
      }
    } else {
      logger.error(`Unsupported OS: ${os}`);
      logger.info('  Please start Docker manually');
      return false;
    }
  }

  /**
   * Check health of a specific Docker service
   */
  async checkDockerServiceHealth(key: keyof typeof DOCKER_SERVICES): Promise<ServiceHealth> {
    const config = DOCKER_SERVICES[key];
    const url = `http://127.0.0.1:${config.port}${config.healthPath}`;
    
    try {
      const response = await fetch(url, {
        method: config.healthPath.startsWith('/api/v0') ? 'POST' : 'GET',
        signal: AbortSignal.timeout(3000),
      });
      
      return {
        name: config.name,
        port: config.port,
        healthy: response.ok,
        url: `http://127.0.0.1:${config.port}`,
      };
    } catch {
      return {
        name: config.name,
        port: config.port,
        healthy: false,
        url: `http://127.0.0.1:${config.port}`,
      };
    }
  }

  /**
   * Check all Docker services (excludes CQL which runs natively)
   */
  async checkDockerServices(): Promise<ServiceHealth[]> {
    const results: ServiceHealth[] = [];
    
    for (const key of Object.keys(DOCKER_SERVICES) as (keyof typeof DOCKER_SERVICES)[]) {
      results.push(await this.checkDockerServiceHealth(key));
    }
    
    return results;
  }

  /**
   * Get CQL health status
   */
  async getCQLHealth(): Promise<ServiceHealth> {
    const healthy = await this.isCQLRunning();
    return {
      name: 'CovenantSQL',
      port: CQL_PORT,
      healthy,
      url: `http://127.0.0.1:${CQL_PORT}`,
    };
  }

  /**
   * Start Docker Compose services (excludes CQL which runs natively)
   */
  async startDockerServices(): Promise<boolean> {
    logger.step('Starting Docker services...');
    
    const composePath = join(this.rootDir, 'packages/deployment/docker/localnet.compose.yaml');
    if (!existsSync(composePath)) {
      logger.error('localnet.compose.yaml not found in packages/deployment/docker/');
      return false;
    }

    try {
      // Only start Docker services - CQL is started natively
      // Only start IPFS for now - cache and da services not yet implemented
      await execa('docker', [
        'compose', '-f', composePath, 'up', '-d',
        'ipfs',
      ], {
        cwd: this.rootDir,
        stdio: 'pipe',
      });

      // Wait for services to be healthy
      logger.info('  Waiting for Docker services to be healthy...');
      for (let attempt = 0; attempt < 60; attempt++) {
        const services = await this.checkDockerServices();
        const allHealthy = services.every(s => s.healthy);
        
        if (allHealthy) {
          for (const service of services) {
            logger.success(`  ${service.name} ready`);
          }
          return true;
        }
        
        await this.sleep(1000);
        
        if (attempt % 10 === 9) {
          const unhealthy = services.filter(s => !s.healthy).map(s => s.name);
          logger.info(`  Still waiting for: ${unhealthy.join(', ')}`);
        }
      }
      
      logger.error('Docker services did not become healthy within 60 seconds');
      return false;
    } catch (error) {
      logger.error('Failed to start Docker services');
      logger.debug(String(error));
      return false;
    }
  }

  /**
   * Stop all services (CQL + Docker)
   */
  async stopServices(): Promise<void> {
    logger.step('Stopping all services...');
    
    // Stop CQL first
    await this.stopCQL();
    logger.success('CQL stopped');
    
    // Stop Docker services
    const composePath = join(this.rootDir, 'packages/deployment/docker/localnet.compose.yaml');
    await execa('docker', ['compose', '-f', composePath, 'down'], {
      cwd: this.rootDir,
      stdio: 'pipe',
      reject: false,
    });
    logger.success('Docker services stopped');
  }

  /**
   * Check if localnet is running
   */
  async isLocalnetRunning(): Promise<boolean> {
    try {
      const response = await fetch(`http://127.0.0.1:${LOCALNET_PORT}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Start localnet (Anvil)
   */
  async startLocalnet(): Promise<boolean> {
    if (await this.isLocalnetRunning()) {
      logger.success('Localnet already running');
      return true;
    }

    logger.step('Starting localnet...');

    try {
      // Check if anvil is installed
      const { exitCode } = await execa('which', ['anvil'], { reject: false });
      if (exitCode !== 0) {
        logger.error('Anvil not found');
        logger.info('  Install: curl -L https://foundry.paradigm.xyz | bash');
        return false;
      }

      // Start anvil in background
      execa('anvil', ['--port', String(LOCALNET_PORT), '--chain-id', '1337'], {
        cwd: this.rootDir,
        stdio: 'ignore',
        detached: true,
      }).unref();

      // Wait for it to be ready
      for (let i = 0; i < 30; i++) {
        await this.sleep(500);
        if (await this.isLocalnetRunning()) {
          logger.success('Localnet running on port ' + LOCALNET_PORT);
          return true;
        }
      }

      logger.error('Localnet failed to start');
      return false;
    } catch (error) {
      logger.error('Failed to start localnet');
      logger.debug(String(error));
      return false;
    }
  }

  /**
   * Stop localnet
   */
  async stopLocalnet(): Promise<void> {
    await execa('pkill', ['-f', `anvil.*--port.*${LOCALNET_PORT}`], { reject: false });
  }

  /**
   * Get full infrastructure status
   */
  async getStatus(): Promise<InfrastructureStatus> {
    const cql = await this.isCQLRunning();
    const docker = await this.isDockerRunning();
    const dockerServices = docker ? await this.checkDockerServices() : [];
    const localnet = await this.isLocalnetRunning();
    
    // All services including CQL
    const cqlHealth = await this.getCQLHealth();
    const services = [cqlHealth, ...dockerServices];
    
    const allHealthy = cql && 
      docker && 
      dockerServices.every(s => s.healthy) && 
      localnet;

    return {
      docker,
      cql,
      services,
      localnet,
      allHealthy,
    };
  }

  /**
   * Ensure all infrastructure is running
   * Auto-starts what's missing
   */
  async ensureRunning(): Promise<boolean> {
    logger.header('INFRASTRUCTURE');

    // Step 1: Start CQL first - it's the core database for all apps
    logger.subheader('CQL (CovenantSQL)');
    
    if (!(await this.isCQLRunning())) {
      const started = await this.startCQL();
      if (!started) {
        return false;
      }
    } else {
      logger.success(`CQL running on port ${CQL_PORT}`);
    }

    // Step 2: Check/start Docker
    logger.subheader('Docker');
    
    if (!(await this.isDockerInstalled())) {
      logger.error('Docker is not installed');
      logger.info('  Install: https://docs.docker.com/get-docker/');
      return false;
    }

    if (!(await this.isDockerRunning())) {
      const started = await this.startDocker();
      if (!started) {
        return false;
      }
    } else {
      logger.success('Docker running');
    }

    // Step 3: Check/start Docker services (excludes CQL)
    logger.subheader('Docker Services');
    
    let dockerServices = await this.checkDockerServices();
    const unhealthyServices = dockerServices.filter(s => !s.healthy);
    
    if (unhealthyServices.length > 0) {
      logger.info(`Starting: ${unhealthyServices.map(s => s.name).join(', ')}`);
      const started = await this.startDockerServices();
      if (!started) {
        return false;
      }
      dockerServices = await this.checkDockerServices();
    } else {
      for (const service of dockerServices) {
        logger.success(`${service.name} healthy`);
      }
    }

    // Verify all Docker services are healthy
    const stillUnhealthy = dockerServices.filter(s => !s.healthy);
    if (stillUnhealthy.length > 0) {
      logger.error(`Services not healthy: ${stillUnhealthy.map(s => s.name).join(', ')}`);
      return false;
    }

    // Step 4: Check/start localnet
    logger.subheader('Localnet');
    
    if (!(await this.isLocalnetRunning())) {
      const started = await this.startLocalnet();
      if (!started) {
        return false;
      }
    } else {
      logger.success('Localnet running on port ' + LOCALNET_PORT);
    }

    logger.newline();
    logger.success('All infrastructure ready');
    
    return true;
  }

  /**
   * Print status table
   */
  printStatus(status: InfrastructureStatus): void {
    logger.subheader('Infrastructure Status');

    // CQL first - it's the core database
    logger.table([
      { label: 'CQL (native)', value: status.cql ? `http://127.0.0.1:${CQL_PORT}` : 'stopped', status: status.cql ? 'ok' : 'error' },
    ]);

    logger.table([
      { label: 'Docker', value: status.docker ? 'running' : 'stopped', status: status.docker ? 'ok' : 'error' },
    ]);

    // Docker services (CQL already shown above)
    for (const service of status.services) {
      if (service.name === 'CovenantSQL') continue; // Already shown
      logger.table([
        { label: service.name, value: service.healthy ? service.url : 'not running', status: service.healthy ? 'ok' : 'error' },
      ]);
    }

    logger.table([
      { label: 'Localnet', value: status.localnet ? `http://127.0.0.1:${LOCALNET_PORT}` : 'stopped', status: status.localnet ? 'ok' : 'error' },
    ]);
  }

  /**
   * Get environment variables for running services
   */
  getEnvVars(): Record<string, string> {
    return {
      L2_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      JEJU_RPC_URL: `http://127.0.0.1:${LOCALNET_PORT}`,
      CQL_BLOCK_PRODUCER_ENDPOINT: 'http://127.0.0.1:4661',
      CQL_URL: 'http://127.0.0.1:4661',
      IPFS_API_URL: 'http://127.0.0.1:5001',
      CHAIN_ID: '1337',
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export function createInfrastructureService(rootDir: string): InfrastructureService {
  return new InfrastructureService(rootDir);
}

