/** Local development proxy and hosts management */

import { Command } from 'commander'
import * as proxyModule from '../lib/local-proxy'
import { logger } from '../lib/logger'

interface ProxyModule {
  hasJejuHostsBlock: () => boolean
  getHostsBlockStatus: () => {
    exists: boolean
    current: string
    expected: string
    missingDomains: string[]
  }
  ensureHostsFile: (
    config?: Record<string, unknown>,
    options?: { force?: boolean },
  ) => Promise<boolean>
  removeHostsBlock: () => Promise<boolean>
  isCaddyInstalled: () => Promise<boolean>
  installCaddy: () => Promise<boolean>
  generateCaddyfile: () => string
  ensureSudoAccess: () => Promise<boolean>
  installPortForwarding: () => Promise<boolean>
  uninstallPortForwarding: () => Promise<boolean>
  startProxy: () => Promise<boolean>
  stopProxy: () => Promise<void>
  getLocalUrls: () => Record<string, string>
}

function loadProxyModule(): ProxyModule {
  return proxyModule as ProxyModule
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

proxyCommand
  .command('start')
  .description('Start the local reverse proxy (Caddy)')
  .action(async () => {
    const proxy = await loadProxyModule()
    await proxy.ensureSudoAccess()
    await proxy.startProxy()
  })

proxyCommand
  .command('stop')
  .description('Stop the local reverse proxy')
  .action(async () => {
    const proxy = await loadProxyModule()
    await proxy.stopProxy()
    logger.success('Proxy stopped')
  })

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

proxyCommand
  .command('hosts')
  .description('Check hosts file status')
  .action(async () => {
    const proxy = await loadProxyModule()
    const status = proxy.getHostsBlockStatus()

    if (status.exists) {
      if (status.missingDomains.length === 0) {
        logger.success('Jeju hosts block found and complete:\n')
      } else {
        logger.warn(
          `Jeju hosts block found but missing ${status.missingDomains.length} domain(s):\n`,
        )
        for (const domain of status.missingDomains) {
          logger.info(`  - ${domain}`)
        }
        logger.newline()
        logger.info('Run: jeju proxy hosts:add to update')
        logger.newline()
      }
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

proxyCommand
  .command('hosts:add')
  .description('Add Jeju entries to hosts file (requires sudo)')
  .action(async () => {
    const proxy = await loadProxyModule()

    logger.header('HOSTS FILE SETUP')
    logger.info('Adding Jeju block to hosts file...\n')

    await proxy.ensureHostsFile({}, { force: true })
  })

proxyCommand
  .command('hosts:remove')
  .description('Remove Jeju entries from hosts file (requires sudo)')
  .action(async () => {
    const proxy = await loadProxyModule()

    logger.header('HOSTS FILE CLEANUP')
    logger.info('Removing Jeju block from hosts file...\n')

    await proxy.removeHostsBlock()
  })

proxyCommand
  .command('caddyfile')
  .description('Print the generated Caddyfile')
  .action(async () => {
    const proxy = await loadProxyModule()
    console.log(proxy.generateCaddyfile())
  })

proxyCommand
  .command('install')
  .description(
    'Install persistent port forwarding (80 → 8080) - run once with sudo',
  )
  .action(async () => {
    const proxy = await loadProxyModule()

    logger.header('PORT FORWARDING SETUP')
    logger.info('This enables clean URLs without :8080\n')

    const success = await proxy.installPortForwarding()
    if (success) {
      logger.newline()
      logger.success('Port forwarding installed.')
      logger.info('Now run "bun run dev" - port 80 will work automatically.')
    } else {
      logger.error('Failed to install port forwarding')
      logger.info('Try running with sudo: sudo jeju proxy install')
    }
  })

proxyCommand
  .command('uninstall')
  .description('Remove persistent port forwarding rules')
  .action(async () => {
    const proxy = await loadProxyModule()

    logger.header('REMOVING PORT FORWARDING')

    const success = await proxy.uninstallPortForwarding()
    if (success) {
      logger.success('Port forwarding removed.')
    } else {
      logger.error('Failed to remove port forwarding')
    }
  })
