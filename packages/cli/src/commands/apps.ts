/**
 * jeju apps - List and manage apps
 */

import { Command } from 'commander';
import { discoverAllApps, displayAppsSummary } from '../../../../scripts/shared/discover-apps';
import { logger } from '../lib/logger';

export const appsCommand = new Command('apps')
  .description('List and manage apps')
  .action(async () => {
    logger.header('APPS');
    
    displayAppsSummary();
    
    const apps = discoverAllApps();
    
    if (apps.length === 0) {
      logger.info('No apps found.');
      logger.newline();
      logger.info('To add a vendor app:');
      logger.info('  1. git submodule add <repo-url> vendor/<app-name>');
      logger.info('  2. Create vendor/<app-name>/jeju-manifest.json');
      logger.info('  3. git submodule update --init --recursive');
      logger.newline();
      logger.info('To add a core app:');
      logger.info('  1. Create apps/<app-name>');
      logger.info('  2. Create apps/<app-name>/jeju-manifest.json');
      logger.info('  3. Add "type": "core" to the manifest');
      return;
    }
    
    logger.subheader('Details');
    
    for (const app of apps) {
      logger.separator();
      logger.info(`${app.manifest.displayName || app.name} [${app.type.toUpperCase()}]`);
      logger.keyValue('Name', app.name);
      logger.keyValue('Version', app.manifest.version);
      logger.keyValue('Path', app.path);
      logger.keyValue('Status', app.exists ? 'Installed ✅' : 'Not initialized ⚠️');
      logger.keyValue('Auto-start', app.manifest.autoStart !== false ? 'Yes ✅' : 'No ⏭️');
      
      if (app.manifest.commands) {
        logger.newline();
        logger.info('Available Commands:');
        for (const [cmd, script] of Object.entries(app.manifest.commands)) {
          if (script) {
            logger.info(`  • ${cmd}: ${script}`);
          }
        }
      }
      
      if (app.manifest.ports) {
        logger.newline();
        logger.info('Ports:');
        for (const [name, port] of Object.entries(app.manifest.ports)) {
          logger.info(`  • ${name}: ${port}`);
        }
      }
      
      if (app.manifest.dependencies && app.manifest.dependencies.length > 0) {
        logger.keyValue('Dependencies', app.manifest.dependencies.join(', '));
      }
      
      if (app.manifest.tags && app.manifest.tags.length > 0) {
        logger.keyValue('Tags', app.manifest.tags.join(', '));
      }
      
      logger.newline();
    }
    
    logger.separator();
    logger.newline();
    logger.info('Start all apps: jeju dev');
    logger.info('Start only vendor apps: bun run dev:vendor');
  });

