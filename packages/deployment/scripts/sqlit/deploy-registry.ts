/**
 * Deploy SQLitIdentityRegistry to Jeju L2
 *
 * This script deploys the on-chain identity registry for SQLit nodes.
 * The registry enforces cryptographic identity verification and staking.
 *
 * Usage:
 *   pnpm run deploy:sqlit-registry
 *
 * Environment:
 *   - DEPLOYER_PRIVATE_KEY: Deployer's private key
 *   - JEJU_RPC_URL: Jeju L2 RPC endpoint
 *   - JEJU_TOKEN_ADDRESS: JEJU token contract address
 */

import { execSync } from 'node:child_process'
import * as path from 'node:path'
import * as dotenv from 'dotenv'

dotenv.config()

const CONTRACTS_DIR = path.resolve(__dirname, '../../../contracts')

async function main() {
  console.log('='.repeat(60))
  console.log('Deploying SQLitIdentityRegistry to Jeju L2')
  console.log('='.repeat(60))

  // Validate environment
  const requiredEnvVars = [
    'DEPLOYER_PRIVATE_KEY',
    'JEJU_RPC_URL',
    'JEJU_TOKEN_ADDRESS',
  ]

  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      throw new Error(`Missing required environment variable: ${envVar}`)
    }
  }

  const rpcUrl = process.env.JEJU_RPC_URL
  const stakingToken = process.env.JEJU_TOKEN_ADDRESS
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY
  const registryOwner = process.env.REGISTRY_OWNER ?? ''

  if (!rpcUrl || !stakingToken || !deployerKey) {
    throw new Error('Missing required environment variables after validation')
  }

  console.log('RPC URL:', rpcUrl)
  console.log('Staking Token:', stakingToken)
  console.log('')

  // Build the forge command
  const forgeCmd = [
    'forge script',
    'script/DeploySQLitRegistry.s.sol:DeploySQLitRegistry',
    `--rpc-url "${rpcUrl}"`,
    `--private-key "${deployerKey}"`,
    '--broadcast',
    '-vvv',
  ].join(' ')

  // Set environment for forge
  const env = {
    ...process.env,
    STAKING_TOKEN_ADDRESS: stakingToken,
    ...(registryOwner && { REGISTRY_OWNER: registryOwner }),
  }

  console.log('Running forge deploy...')
  console.log('')

  try {
    execSync(forgeCmd, {
      cwd: CONTRACTS_DIR,
      env,
      stdio: 'inherit',
    })

    console.log('')
    console.log('='.repeat(60))
    console.log('Deployment successful!')
    console.log('='.repeat(60))
    console.log('')
    console.log('Next steps:')
    console.log('1. Copy the registry address from the output above')
    console.log('2. Update SQLIT_REGISTRY_ADDRESS in your environment')
    console.log('3. Run register-nodes.ts to register block producers')
  } catch (error) {
    console.error('Deployment failed:', error)
    process.exit(1)
  }
}

main().catch(console.error)
