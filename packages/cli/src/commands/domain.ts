/**
 * Domain Management Commands (JNS)
 *
 * Manage JNS (Jeju Name Service) domains:
 * - Register/transfer domains
 * - Set content hashes (IPFS CID)
 * - Link to workers
 * - View domain info
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NetworkType } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import { logger } from '../lib/logger'
import type { AppManifest } from '../types'
import { requireLogin } from './login'

// Helper to get DWS URL
function getDWSUrl(network: string): string {
  switch (network as NetworkType) {
    case 'mainnet':
      return 'https://dws.jejunetwork.org'
    case 'testnet':
      return 'https://dws.testnet.jejunetwork.org'
    default:
      return 'http://127.0.0.1:4030'
  }
}

// Register a new JNS domain
async function registerDomain(
  name: string,
  options: { network: string; years?: string },
): Promise<void> {
  logger.header('REGISTER JNS DOMAIN')
  const credentials = requireLogin()

  const dwsUrl = getDWSUrl(options.network)
  const years = parseInt(options.years ?? '1', 10)

  logger.step(`Registering ${chalk.cyan(name)} for ${years} year(s)...`)

  const response = await fetch(`${dwsUrl}/jns/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.authToken}`,
    },
    body: JSON.stringify({
      name,
      years,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    logger.error(
      `Failed to register domain: ${(error as { error?: string }).error || response.statusText}`,
    )
    process.exit(1)
  }

  const result = await response.json()
  logger.success(`Domain ${chalk.cyan(name)} registered.`)

  if (result.txHash) {
    logger.info(`Transaction: ${result.txHash}`)
  }
}

// Set content hash for a domain (point to IPFS CID)
async function setContent(
  name: string,
  cid: string,
  options: { network: string },
): Promise<void> {
  logger.header('SET DOMAIN CONTENT')
  const credentials = requireLogin()

  const dwsUrl = getDWSUrl(options.network)

  logger.step(`Setting ${chalk.cyan(name)} to point to ${chalk.yellow(cid)}...`)

  const response = await fetch(`${dwsUrl}/jns/set-content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.authToken}`,
    },
    body: JSON.stringify({
      name,
      contentCid: cid,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    logger.error(`Failed to set content: ${(error as { error?: string }).error || response.statusText}`)
    process.exit(1)
  }

  logger.success(
    `Domain ${chalk.cyan(name)} now points to ${chalk.yellow(cid)}`,
  )
}

// Link a domain to a worker
async function linkWorker(
  name: string,
  workerId: string,
  options: { network: string },
): Promise<void> {
  logger.header('LINK DOMAIN TO WORKER')
  const credentials = requireLogin()

  const dwsUrl = getDWSUrl(options.network)

  logger.step(
    `Linking ${chalk.cyan(name)} to worker ${chalk.yellow(workerId)}...`,
  )

  const response = await fetch(`${dwsUrl}/jns/link-worker`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.authToken}`,
    },
    body: JSON.stringify({
      name,
      workerId,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    logger.error(`Failed to link worker: ${(error as { error?: string }).error || response.statusText}`)
    process.exit(1)
  }

  logger.success(
    `Domain ${chalk.cyan(name)} now routes to worker ${chalk.yellow(workerId)}`,
  )
}

// Resolve a domain name
async function resolveDomain(
  name: string,
  options: { network: string },
): Promise<void> {
  logger.header('RESOLVE JNS DOMAIN')

  const dwsUrl = getDWSUrl(options.network)

  logger.step(`Resolving ${chalk.cyan(name)}...`)

  const response = await fetch(
    `${dwsUrl}/registry/apps/${encodeURIComponent(name)}`,
  )

  if (!response.ok) {
    if (response.status === 404) {
      logger.error(`Domain ${name} not found`)
    } else {
      logger.error(`Failed to resolve: ${response.statusText}`)
    }
    process.exit(1)
  }

  const result = await response.json()

  if (!result.resolved) {
    logger.error(`Domain ${name} not found`)
    process.exit(1)
  }

  console.log()
  console.log(chalk.bold('Domain Info:'))
  console.log(`  Name:       ${chalk.cyan(name)}`)

  if (result.contentCid) {
    console.log(`  Content:    ${chalk.yellow(result.contentCid)}`)
  }
  if (result.workerId) {
    console.log(`  Worker:     ${chalk.yellow(result.workerId)}`)
  }
  if (result.owner) {
    console.log(`  Owner:      ${chalk.dim(result.owner)}`)
  }
  if (result.ttl) {
    console.log(`  TTL:        ${result.ttl}s`)
  }
  if (result.expiry) {
    const expiryDate = new Date(result.expiry * 1000)
    console.log(`  Expires:    ${expiryDate.toLocaleDateString()}`)
  }
  console.log()
}

// List domains owned by the current user
async function listDomains(options: { network: string }): Promise<void> {
  logger.header('MY JNS DOMAINS')
  const credentials = requireLogin()

  const dwsUrl = getDWSUrl(options.network)

  const response = await fetch(`${dwsUrl}/jns/list`, {
    headers: {
      Authorization: `Bearer ${credentials.authToken}`,
    },
  })

  if (!response.ok) {
    logger.error(`Failed to list domains: ${response.statusText}`)
    process.exit(1)
  }

  const result = await response.json()
  const domains = result.domains || []

  if (domains.length === 0) {
    logger.info('You have no registered domains.')
    console.log()
    console.log(
      `Register one with: ${chalk.cyan('jeju domain register my-app.jeju')}`,
    )
    return
  }

  console.log()
  console.log(chalk.bold('Your Domains:'))
  console.log()

  for (const domain of domains) {
    const status =
      domain.contentCid || domain.workerId
        ? chalk.green('●')
        : chalk.yellow('○')
    console.log(`  ${status} ${chalk.cyan(domain.name)}`)
    if (domain.contentCid) {
      console.log(`    └─ Content: ${chalk.dim(domain.contentCid)}`)
    }
    if (domain.workerId) {
      console.log(`    └─ Worker:  ${chalk.dim(domain.workerId)}`)
    }
  }
  console.log()
}

// Transfer a domain to another address
async function transferDomain(
  name: string,
  toAddress: string,
  options: { network: string },
): Promise<void> {
  logger.header('TRANSFER JNS DOMAIN')
  const credentials = requireLogin()

  const dwsUrl = getDWSUrl(options.network)

  logger.step(
    `Transferring ${chalk.cyan(name)} to ${chalk.yellow(toAddress)}...`,
  )

  const response = await fetch(`${dwsUrl}/jns/transfer`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${credentials.authToken}`,
    },
    body: JSON.stringify({
      name,
      toAddress,
    }),
  })

  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    logger.error(`Failed to transfer: ${(error as { error?: string }).error || response.statusText}`)
    process.exit(1)
  }

  logger.success(
    `Domain ${chalk.cyan(name)} transferred to ${chalk.yellow(toAddress)}`,
  )
}

// Check domain availability
async function checkAvailability(
  name: string,
  options: { network: string },
): Promise<void> {
  const dwsUrl = getDWSUrl(options.network)

  const response = await fetch(
    `${dwsUrl}/registry/apps/${encodeURIComponent(name)}`,
  )

  if (response.status === 404) {
    console.log(
      `${chalk.green('✓')} ${chalk.cyan(name)} is ${chalk.green('available')}`,
    )
    console.log()
    console.log(`Register with: ${chalk.cyan(`jeju domain register ${name}`)}`)
  } else if (response.ok) {
    const result = await response.json()
    console.log(
      `${chalk.red('✗')} ${chalk.cyan(name)} is ${chalk.red('taken')}`,
    )
    if (result.owner) {
      console.log(`  Owner: ${chalk.dim(result.owner)}`)
    }
  }
}

// Link domain from current project's manifest
async function linkFromManifest(options: { network: string }): Promise<void> {
  logger.header('LINK DOMAIN FROM MANIFEST')

  const manifestPath = join(process.cwd(), 'jeju-manifest.json')
  if (!existsSync(manifestPath)) {
    logger.error('No jeju-manifest.json found in current directory')
    process.exit(1)
  }

  const manifest = JSON.parse(
    readFileSync(manifestPath, 'utf-8'),
  ) as AppManifest
  const jnsName = manifest.jns?.name

  if (!jnsName) {
    logger.error('No JNS name configured in manifest')
    logger.info('Add jns.name to your jeju-manifest.json')
    process.exit(1)
  }

  logger.info(`Using JNS name from manifest: ${chalk.cyan(jnsName)}`)

  // Check if we have a deployed worker
  const credentials = requireLogin()

  const dwsUrl = getDWSUrl(options.network)

  // Try to find deployed worker
  const workersResponse = await fetch(`${dwsUrl}/workers/list`, {
    headers: {
      Authorization: `Bearer ${credentials.authToken}`,
    },
  })

  if (workersResponse.ok) {
    const workersResult = await workersResponse.json()
    const matchingWorker = workersResult.workers?.find(
      (w: { name: string }) => w.name === manifest.name,
    )

    if (matchingWorker) {
      await linkWorker(jnsName, matchingWorker.workerId, options)
      return
    }
  }

  logger.info('No deployed worker found. Deploy first with:')
  console.log(`  ${chalk.cyan('jeju publish')}`)
}

export const domainCommand = new Command('domain')
  .description('Manage JNS (Jeju Name Service) domains')
  .option('-n, --network <network>', 'Target network', 'localnet')
  .addHelpText(
    'after',
    `
Examples:
  ${chalk.cyan('jeju domain register my-app.jeju')}    Register a domain
  ${chalk.cyan('jeju domain set my-app.jeju Qm...')}   Set content hash
  ${chalk.cyan('jeju domain link my-app.jeju wkr_...')} Link to worker
  ${chalk.cyan('jeju domain resolve my-app.jeju')}    Look up domain info
  ${chalk.cyan('jeju domain list')}                   List your domains
  ${chalk.cyan('jeju domain check cool-name.jeju')}   Check availability
`,
  )

// Subcommands
domainCommand
  .command('register <name>')
  .description('Register a new JNS domain')
  .option('--years <years>', 'Registration period in years', '1')
  .action(async (name, cmdOptions) => {
    const parentOpts = domainCommand.opts()
    await registerDomain(name, { ...cmdOptions, network: parentOpts.network })
  })

domainCommand
  .command('set <name> <cid>')
  .description('Set content hash (IPFS CID) for domain')
  .action(async (name, cid) => {
    const opts = domainCommand.opts()
    await setContent(name, cid, { network: opts.network })
  })

domainCommand
  .command('link <name> <worker-id>')
  .description('Link domain to a deployed worker')
  .action(async (name, workerId) => {
    const opts = domainCommand.opts()
    await linkWorker(name, workerId, { network: opts.network })
  })

domainCommand
  .command('resolve <name>')
  .description('Look up domain information')
  .action(async (name) => {
    const opts = domainCommand.opts()
    await resolveDomain(name, { network: opts.network })
  })

domainCommand
  .command('list')
  .description('List your registered domains')
  .action(async () => {
    const opts = domainCommand.opts()
    await listDomains({ network: opts.network })
  })

domainCommand
  .command('transfer <name> <to-address>')
  .description('Transfer domain to another address')
  .action(async (name, toAddress) => {
    const opts = domainCommand.opts()
    await transferDomain(name, toAddress, { network: opts.network })
  })

domainCommand
  .command('check <name>')
  .description('Check if a domain is available')
  .action(async (name) => {
    const opts = domainCommand.opts()
    await checkAvailability(name, { network: opts.network })
  })

domainCommand
  .command('auto')
  .description('Link domain from current project manifest')
  .action(async () => {
    const opts = domainCommand.opts()
    await linkFromManifest({ network: opts.network })
  })
