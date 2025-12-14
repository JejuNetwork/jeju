/**
 * jeju compute - External compute provider management
 *
 * Manage external compute providers (Akash) and bridge nodes.
 */

import { Command } from 'commander';
import { spawn } from 'bun';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../lib/logger';
import { getChainStatus } from '../lib/chain';
import { DEFAULT_PORTS } from '../types';

const BRIDGE_PORT = 4010;

export const computeCommand = new Command('compute')
  .description('External compute marketplace operations')
  .addCommand(
    new Command('status')
      .description('Check compute services status')
      .action(async () => {
        await checkStatus();
      })
  )
  .addCommand(
    new Command('bridge')
      .description('Start the compute bridge (Akash integration)')
      .option('--network <network>', 'Network: localnet, testnet, mainnet', 'localnet')
      .option('--akash-network <network>', 'Akash network: testnet, mainnet', 'testnet')
      .option('--port <port>', 'Bridge port', String(BRIDGE_PORT))
      .action(async (options) => {
        await startBridge(options);
      })
  )
  .addCommand(
    new Command('offerings')
      .description('List available compute offerings')
      .option('--gpu', 'Show only GPU offerings')
      .option('--provider <provider>', 'Filter by provider: native, akash')
      .action(async (options) => {
        await listOfferings(options);
      })
  )
  .addCommand(
    new Command('deploy')
      .description('Deploy a container to compute network')
      .argument('<image>', 'Container image (Docker Hub, IPFS CID, or JNS name)')
      .option('--hours <hours>', 'Duration in hours', '1')
      .option('--cpu <cores>', 'CPU cores', '2')
      .option('--memory <gb>', 'Memory in GB', '4')
      .option('--gpu', 'Request GPU')
      .option('--ssh-key <key>', 'SSH public key for access')
      .option('--provider <provider>', 'Preferred provider: native, akash, auto', 'auto')
      .action(async (image, options) => {
        await deployContainer(image, options);
      })
  )
  .addCommand(
    new Command('list')
      .description('List your deployments')
      .option('--active', 'Show only active deployments')
      .action(async (options) => {
        await listDeployments(options);
      })
  )
  .addCommand(
    new Command('logs')
      .description('Get deployment logs')
      .argument('<deployment-id>', 'Deployment ID')
      .option('--tail <lines>', 'Number of lines', '100')
      .action(async (deploymentId, options) => {
        await getDeploymentLogs(deploymentId, options);
      })
  )
  .addCommand(
    new Command('terminate')
      .description('Terminate a deployment')
      .argument('<deployment-id>', 'Deployment ID')
      .action(async (deploymentId) => {
        await terminateDeployment(deploymentId);
      })
  );

async function checkStatus(): Promise<void> {
  logger.header('COMPUTE STATUS');

  // Check chain
  const chain = await getChainStatus('localnet');
  logger.table([
    {
      label: 'Chain',
      value: chain.running ? `Block ${chain.blockNumber}` : 'Not running',
      status: chain.running ? 'ok' : 'error',
    },
  ]);

  // Check bridge
  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;
  let bridgeOk = false;

  try {
    const response = await fetch(`${bridgeUrl}/status`, {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      bridgeOk = true;
      const status = (await response.json()) as {
        bridgeNode: { address: string; reputationScore: number };
        compute: { totalDeployments: number; activeDeployments: number };
        akash: { available: boolean };
      };

      logger.newline();
      logger.subheader('Bridge Node');
      logger.table([
        { label: 'Address', value: status.bridgeNode.address, status: 'ok' },
        { label: 'Reputation', value: String(status.bridgeNode.reputationScore), status: 'ok' },
        { label: 'Akash', value: status.akash.available ? 'Available' : 'Unavailable', status: status.akash.available ? 'ok' : 'error' },
      ]);

      logger.newline();
      logger.subheader('Deployments');
      logger.keyValue('Total', String(status.compute.totalDeployments));
      logger.keyValue('Active', String(status.compute.activeDeployments));
    }
  } catch {
    // Bridge not running
  }

  logger.table([
    {
      label: 'Bridge',
      value: bridgeOk ? bridgeUrl : 'Not running',
      status: bridgeOk ? 'ok' : 'error',
    },
  ]);

  if (!bridgeOk) {
    logger.newline();
    logger.info('Start the bridge with: jeju compute bridge');
  }
}

async function startBridge(options: {
  network: string;
  akashNetwork: string;
  port: string;
}): Promise<void> {
  logger.header('COMPUTE BRIDGE');

  const rootDir = process.cwd();
  const computeDir = join(rootDir, 'apps/compute');

  if (!existsSync(computeDir)) {
    logger.error('Compute app not found');
    process.exit(1);
  }

  // Check if chain is running
  const chain = await getChainStatus(options.network as 'localnet' | 'testnet' | 'mainnet');
  if (!chain.running && options.network === 'localnet') {
    logger.warn('Chain not running. Start with: jeju dev');
    process.exit(1);
  }

  const rpcUrl = options.network === 'localnet'
    ? `http://localhost:${DEFAULT_PORTS.l2Rpc}`
    : options.network === 'testnet'
      ? 'https://rpc.testnet.jeju.network'
      : 'https://rpc.jeju.network';

  logger.step(`Starting compute bridge on port ${options.port}...`);
  logger.keyValue('Network', options.network);
  logger.keyValue('Akash Network', options.akashNetwork);
  logger.keyValue('RPC URL', rpcUrl);

  const proc = spawn({
    cmd: ['bun', 'run', 'bridge'],
    cwd: computeDir,
    stdout: 'inherit',
    stderr: 'inherit',
    env: {
      ...process.env,
      PORT: options.port,
      NETWORK: options.network,
      JEJU_RPC_URL: rpcUrl,
      AKASH_NETWORK: options.akashNetwork,
      ENABLE_AKASH: 'true',
      ENABLE_EXTERNAL_PROVIDERS: 'true',
    },
  });

  // Handle shutdown
  process.on('SIGINT', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    proc.kill('SIGTERM');
    process.exit(0);
  });

  await proc.exited;
}

async function listOfferings(options: { gpu?: boolean; provider?: string }): Promise<void> {
  logger.header('COMPUTE OFFERINGS');

  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;

  try {
    let url = `${bridgeUrl}/offerings`;
    const params = new URLSearchParams();
    if (options.gpu) params.set('gpuCount', '1');
    if (params.toString()) url += `?${params}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      offerings: Array<{
        id: string;
        provider: string;
        hardware: { cpuCores: number; memoryGb: number; gpuCount: number };
        pricing: { pricePerHour: string };
        availability: { available: boolean; slots: number; region: string };
        features: { ssh: boolean; docker: boolean; tee: boolean };
      }>;
      count: number;
    };

    let offerings = data.offerings;
    if (options.provider) {
      offerings = offerings.filter((o) => o.provider === options.provider);
    }

    if (offerings.length === 0) {
      logger.info('No offerings available');
      return;
    }

    logger.info(`Found ${offerings.length} offerings:\n`);

    for (const offering of offerings) {
      const features = [
        offering.features.ssh && 'SSH',
        offering.features.docker && 'Docker',
        offering.features.tee && 'TEE',
      ].filter(Boolean).join(', ');

      console.log(`  ${offering.id}`);
      console.log(`    Provider: ${offering.provider}`);
      console.log(`    Hardware: ${offering.hardware.cpuCores} CPU, ${offering.hardware.memoryGb}GB RAM${offering.hardware.gpuCount > 0 ? `, ${offering.hardware.gpuCount} GPU` : ''}`);
      console.log(`    Price: ${offering.pricing.pricePerHour} ETH/hour`);
      console.log(`    Region: ${offering.availability.region} (${offering.availability.slots} available)`);
      console.log(`    Features: ${features || 'None'}`);
      console.log('');
    }
  } catch (error) {
    logger.error('Failed to fetch offerings. Is the bridge running?');
    logger.info('Start with: jeju compute bridge');
    process.exit(1);
  }
}

async function deployContainer(
  image: string,
  options: {
    hours: string;
    cpu: string;
    memory: string;
    gpu?: boolean;
    sshKey?: string;
    provider: string;
  }
): Promise<void> {
  logger.header('DEPLOY CONTAINER');

  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;

  // Get quote first
  logger.step('Getting quote...');

  const quoteBody = {
    image,
    hardware: {
      cpuCores: parseInt(options.cpu),
      memoryGb: parseInt(options.memory),
      gpuCount: options.gpu ? 1 : 0,
    },
    durationHours: parseInt(options.hours),
    provider: options.provider,
  };

  try {
    const quoteResponse = await fetch(`${bridgeUrl}/quote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(quoteBody),
      signal: AbortSignal.timeout(10000),
    });

    if (!quoteResponse.ok) throw new Error(`HTTP ${quoteResponse.status}`);

    const quote = (await quoteResponse.json()) as {
      bestOffering: { provider: string; pricePerHour: string };
      totalCost: string;
      warnings: string[];
    };

    logger.success('Quote received');
    logger.keyValue('Provider', quote.bestOffering.provider);
    logger.keyValue('Price/hour', `${quote.bestOffering.pricePerHour} ETH`);
    logger.keyValue('Total cost', `${quote.totalCost} ETH`);
    logger.keyValue('Duration', `${options.hours} hours`);

    if (quote.warnings.length > 0) {
      logger.newline();
      for (const warning of quote.warnings) {
        logger.warn(warning);
      }
    }

    // Deploy
    logger.newline();
    logger.step('Deploying...');

    const deployBody = {
      ...quoteBody,
      sshPublicKey: options.sshKey,
      userAddress: process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    };

    const deployResponse = await fetch(`${bridgeUrl}/deploy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(deployBody),
      signal: AbortSignal.timeout(300000), // 5 min timeout for deployment
    });

    if (!deployResponse.ok) {
      const error = await deployResponse.text();
      throw new Error(error);
    }

    const deployment = (await deployResponse.json()) as {
      deploymentId: string;
      status: string;
      provider: string;
      endpoints: { http?: string; ssh?: { host: string; port: number } };
      timing: { expiresAt: string };
    };

    logger.success('Deployed successfully');
    logger.newline();
    logger.keyValue('Deployment ID', deployment.deploymentId);
    logger.keyValue('Provider', deployment.provider);
    logger.keyValue('Status', deployment.status);
    logger.keyValue('Expires', deployment.timing.expiresAt);

    if (deployment.endpoints.http) {
      logger.keyValue('HTTP', deployment.endpoints.http);
    }

    if (deployment.endpoints.ssh) {
      logger.keyValue('SSH', `ssh root@${deployment.endpoints.ssh.host} -p ${deployment.endpoints.ssh.port}`);
    }
  } catch (error) {
    logger.error(`Deployment failed: ${error}`);
    process.exit(1);
  }
}

async function listDeployments(options: { active?: boolean }): Promise<void> {
  logger.header('MY DEPLOYMENTS');

  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;
  const userAddress = process.env.DEPLOYER_ADDRESS || '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';

  try {
    const response = await fetch(`${bridgeUrl}/deployments?user=${userAddress}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as {
      deployments: Array<{
        id: string;
        status: string;
        provider: string;
        image: string;
        createdAt: string;
        expiresAt: string;
      }>;
      count: number;
    };

    let deployments = data.deployments;
    if (options.active) {
      deployments = deployments.filter((d) => d.status === 'active');
    }

    if (deployments.length === 0) {
      logger.info('No deployments found');
      return;
    }

    logger.info(`Found ${deployments.length} deployments:\n`);

    for (const d of deployments) {
      const statusIcon = d.status === 'active' ? '✅' : d.status === 'starting' ? '🔄' : '❌';
      console.log(`  ${statusIcon} ${d.id}`);
      console.log(`     Provider: ${d.provider}`);
      console.log(`     Image: ${d.image}`);
      console.log(`     Created: ${d.createdAt}`);
      console.log(`     Expires: ${d.expiresAt}`);
      console.log('');
    }
  } catch (error) {
    logger.error('Failed to list deployments. Is the bridge running?');
    process.exit(1);
  }
}

async function getDeploymentLogs(deploymentId: string, options: { tail: string }): Promise<void> {
  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;

  try {
    const response = await fetch(`${bridgeUrl}/deployments/${deploymentId}/logs?tail=${options.tail}`, {
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const logs = await response.text();
    console.log(logs);
  } catch (error) {
    logger.error(`Failed to get logs: ${error}`);
    process.exit(1);
  }
}

async function terminateDeployment(deploymentId: string): Promise<void> {
  logger.header('TERMINATE DEPLOYMENT');

  const bridgeUrl = `http://localhost:${BRIDGE_PORT}`;

  try {
    const response = await fetch(`${bridgeUrl}/deployments/${deploymentId}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(30000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    logger.success(`Terminated deployment ${deploymentId}`);
  } catch (error) {
    logger.error(`Failed to terminate: ${error}`);
    process.exit(1);
  }
}

