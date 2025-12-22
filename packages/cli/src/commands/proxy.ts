/**
 * jeju proxy - Local development proxy and hosts management
 *
 * Manages the reverse proxy for clean local development URLs:
 * - gateway.local.jejunetwork.org -> localhost:4001
 * - bazaar.local.jejunetwork.org -> localhost:4006
 * - etc.
 */

import { join } from 'node:path'
import { Command } from 'commander'
import { logger } from '../lib/logger'

// Import from packages/deployment/scripts/shared (relative path from cli package)
const SCRIPTS_SHARED = join(
  process.cwd(),
  'scripts',
  'shared',
  'local-proxy.ts',
)

interface ProxyModule {
  hasJejuHostsBlock: () => boolean
  getHostsBlockStatus: () => {
    exists: boolean
    current: string
    expected: string
  }
  ensureHostsFile: () => Promise<boolean>
  removeHostsBlock: () => Promise<boolean>
  isCaddyInstalled: () => Promise<boolean>
  installCaddy: () => Promise<boolean>
  generateCaddyfile: () => string
  startProxy: () => Promise<boolean>
  stopProxy: () => Promise<void>
  getLocalUrls: () => Record<string, string>
}

async function loadProxyModule(): Promise<ProxyModule> {
  return await import(SCRIPTS_SHARED)
}

export const proxyCommand = new Command('proxy')
  .description('Manage local development proxy and hosts file')
  .action(async () => {
    // Default action: show status
    const proxy = await loadProxyModule()

    logger.header('LOCAL DEVELOPMENT PROXY')

    // Check hosts file
    logger.subheader('Hosts File')
    const status = proxy.getHostsBlockStatus()
    if (status.exists) {
      logger.success('Jeju block configured in hosts file')
    } else {
      logger.warn('Jeju block not found in hosts file')
      logger.info('Run: jeju proxy hosts:add')
    }
    logger.newline()

    // Check Caddy
    logger.subheader('Caddy Reverse Proxy')
    const caddyInstalled = await proxy.isCaddyInstalled()
    if (caddyInstalled) {
      logger.success('Caddy is installed')
    } else {
      logger.warn('Caddy is not installed')
      logger.info('Run: jeju proxy start (will auto-install)')
    }
    logger.newline()

    // Show URLs
    logger.subheader('Available URLs')
    const urls = proxy.getLocalUrls()
    for (const [name, url] of Object.entries(urls)) {
      logger.info(`  ${name.padEnd(12)} ${url}`)
    }
    logger.newline()

    logger.separator()
    logger.info('Commands:')
    logger.info('  jeju proxy start       Start the reverse proxy')
    logger.info('  jeju proxy stop        Stop the reverse proxy')
    logger.info('  jeju proxy hosts       Check hosts file status')
    logger.info('  jeju proxy hosts:add   Add entries to hosts file')
    logger.info('  jeju proxy hosts:remove Remove entries from hosts file')
    logger.info('  jeju proxy urls        Show all available URLs')
    logger.newline()
  })

// Subcommand: start
proxyCommand
  .command('start')
  .description('Start the local reverse proxy (Caddy)')
  .action(async () => {
    const proxy = await loadProxyModule()
    await proxy.startProxy()
  })

// Subcommand: stop
proxyCommand
  .command('stop')
  .description('Stop the local reverse proxy')
  .action(async () => {
    const proxy = await loadProxyModule()
    await proxy.stopProxy()
    logger.success('Proxy stopped')
  })

// Subcommand: urls
proxyCommand
  .command('urls')
  .description('Show all available local development URLs')
  .action(async () => {
    const proxy = await loadProxyModule()

    logger.header('LOCAL DEVELOPMENT URLS')

    const urls = proxy.getLocalUrls()
    for (const [name, url] of Object.entries(urls)) {
      console.log(`  ${name.padEnd(12)} ${url}`)
    }
    logger.newline()
  })

// Subcommand: hosts (status)
proxyCommand
  .command('hosts')
  .description('Check hosts file status')
  .action(async () => {
    const proxy = await loadProxyModule()
    const status = proxy.getHostsBlockStatus()

    if (status.exists) {
      logger.success('Jeju hosts block found:\n')
      console.log(status.current)
    } else {
      logger.error('Jeju hosts block not found')
      logger.newline()
      logger.info('Expected block:\n')
      console.log(status.expected)
      logger.newline()
      logger.info('Run: jeju proxy hosts:add')
    }
  })

// Subcommand: hosts:add
proxyCommand
  .command('hosts:add')
  .description('Add Jeju entries to hosts file (requires sudo)')
  .action(async () => {
    const proxy = await loadProxyModule()

    logger.header('HOSTS FILE SETUP')
    logger.info('Adding Jeju block to hosts file...\n')

    await proxy.ensureHostsFile()
  })

// Subcommand: hosts:remove
proxyCommand
  .command('hosts:remove')
  .description('Remove Jeju entries from hosts file (requires sudo)')
  .action(async () => {
    const proxy = await loadProxyModule()

    logger.header('HOSTS FILE CLEANUP')
    logger.info('Removing Jeju block from hosts file...\n')

    await proxy.removeHostsBlock()
  })

// Subcommand: caddyfile
proxyCommand
  .command('caddyfile')
  .description('Print the generated Caddyfile')
  .action(async () => {
    const proxy = await loadProxyModule()
    console.log(proxy.generateCaddyfile())
  })
