/**
 * jeju ports - Check port configuration
 */

import { Command } from 'commander';
import { 
  CORE_PORTS, 
  VENDOR_PORTS, 
  INFRA_PORTS,
  checkPortConflicts,
  printPortAllocation,
  getAllCorePorts,
  getAllVendorPorts
} from '@jejunetwork/config';
import { logger } from '../lib/logger';

export const portsCommand = new Command('ports')
  .description('Check port configuration and conflicts')
  .action(() => {
    logger.header('PORT CONFIGURATION');
    
    printPortAllocation();
    
    logger.subheader('Checking for conflicts');
    
    const { hasConflicts, conflicts } = checkPortConflicts();
    
    if (hasConflicts) {
      logger.error('Port conflicts detected!');
      conflicts.forEach(conflict => {
        logger.error(`  ⚠️  ${conflict}`);
      });
      logger.newline();
      process.exit(1);
    } else {
      logger.success('No port conflicts detected');
      logger.newline();
    }
    
    logger.subheader('Validating port ranges');
    
    let rangeValid = true;
    
    const corePorts = getAllCorePorts();
    for (const [name, port] of Object.entries(corePorts)) {
      if (port < 4000 || port >= 5000) {
        if (name !== 'INDEXER_DATABASE') {
          logger.warn(`${name}: ${port} is outside core app range (4000-4999)`);
          rangeValid = false;
        }
      }
    }
    
    const vendorPorts = getAllVendorPorts();
    for (const [name, port] of Object.entries(vendorPorts)) {
      if (port < 5000 || port >= 6000) {
        logger.warn(`${name}: ${port} is outside vendor app range (5000-5999)`);
        rangeValid = false;
      }
    }
    
    if (rangeValid) {
      logger.success('All ports within correct ranges');
      logger.newline();
    }
    
    logger.subheader('Environment variable overrides');
    
    const envOverrides: string[] = [];
    
    Object.values(CORE_PORTS).forEach(config => {
      if (process.env[config.ENV_VAR]) {
        envOverrides.push(`  ${config.ENV_VAR}=${process.env[config.ENV_VAR]}`);
      }
    });
    
    Object.values(VENDOR_PORTS).forEach(config => {
      if (process.env[config.ENV_VAR]) {
        envOverrides.push(`  ${config.ENV_VAR}=${process.env[config.ENV_VAR]}`);
      }
    });
    
    Object.values(INFRA_PORTS).forEach(config => {
      if (process.env[config.ENV_VAR]) {
        envOverrides.push(`  ${config.ENV_VAR}=${process.env[config.ENV_VAR]}`);
      }
    });
    
    if (envOverrides.length > 0) {
      logger.info(`Found ${envOverrides.length} environment variable override(s):`);
      envOverrides.forEach(override => logger.info(override));
      logger.newline();
    } else {
      logger.success('No environment variable overrides (using defaults)');
      logger.newline();
    }
    
    logger.separator();
    logger.success('Port configuration is valid');
    logger.separator();
    logger.newline();
    logger.info('To override ports, set environment variables before running services:');
    logger.info('  Example: NODE_EXPLORER_API_PORT=5002 jeju dev');
    logger.newline();
  });

