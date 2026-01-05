#!/usr/bin/env bun

/**
 * TFMM Pool Deployment Script for Testnet
 *
 * Deploys TFMM liquidity pools using existing JEJU and USDC tokens.
 * Will deploy tokens if they don't exist.
 *
 * Usage:
 *   PRIVATE_KEY=0x... bun run scripts/deploy-tfmm-testnet.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, formatEther, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const RPC_URL = 'https://testnet-rpc.jejunetwork.org'
const CHAIN_ID = 420690
const CONTRACTS_DIR = join(import.meta.dirname, '../../../packages/contracts')
const CONFIG_DIR = join(import.meta.dirname, '../../../packages/config')

interface TFMMPoolConfig {
  name: string
  symbol: string
  tokens: string[]
  initialWeights: string[]
  swapFeeBps: number
  initialLiquidity: string[]
}

interface DeployedPool {
  address: string
  name: string
  symbol: string
  tokens: string[]
}

function exec(cmd: string): string {
  const displayCmd = cmd.length > 100 ? `${cmd.slice(0, 97)}...` : cmd
  console.log(`  > ${displayCmd}`)
  return execSync(cmd, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    maxBuffer: 50 * 1024 * 1024,
  }).trim()
}

function deployContract(
  privateKey: string,
  path: string,
  args: string[],
  name: string,
): string {
  console.log(`  Deploying ${name}...`)

  const [contractPath, contractName] = path.split(':')
  const jsonFileName = contractPath.split('/').pop()
  const jsonPath = `${CONTRACTS_DIR}/out/${jsonFileName}/${contractName}.json`

  const artifact = JSON.parse(readFileSync(jsonPath, 'utf-8'))
  let bytecode = artifact.bytecode.object as string

  if (args.length > 0) {
    const ctor = artifact.abi.find(
      (x: { type: string }) => x.type === 'constructor',
    )
    if (ctor) {
      const types = ctor.inputs.map((i: { type: string }) => i.type).join(',')
      const argsStr = args.map((a) => `"${a}"`).join(' ')
      const encoded = exec(`cast abi-encode "constructor(${types})" ${argsStr}`)
      bytecode = bytecode + encoded.slice(2)
    }
  }

  // Use higher gas price to ensure transaction goes through
  const cmd = `cast send --rpc-url ${RPC_URL} --private-key ${privateKey} --gas-price 2000000000 --create "${bytecode}" --json`
  const output = exec(cmd)
  const result = JSON.parse(output)
  const contractAddress = result.contractAddress

  if (!contractAddress) {
    throw new Error(
      `Deployment failed for ${name}. Tx: ${result.transactionHash}`,
    )
  }

  console.log(`    ${name}: ${contractAddress}`)
  return contractAddress
}

function sendTx(
  privateKey: string,
  to: string,
  sig: string,
  args: string[],
  label: string,
): void {
  const argsStr = args.map((a) => `"${a}"`).join(' ')
  const cmd = `cast send ${to} "${sig}" ${argsStr} --rpc-url ${RPC_URL} --private-key ${privateKey}`
  exec(cmd)
  console.log(`    ${label}`)
}

async function getOrDeployToken(
  privateKey: string,
  deployer: string,
  configKey: string,
): Promise<string> {
  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))
  const existing = config.testnet?.tokens?.[configKey]

  if (existing && existing !== '') {
    // Verify token exists on chain
    const code = exec(`cast code ${existing} --rpc-url ${RPC_URL}`)
    if (code && code !== '0x' && code.length > 2) {
      console.log(`  Using existing ${configKey.toUpperCase()}: ${existing}`)
      return existing
    }
  }

  // Deploy new token
  if (configKey === 'jeju') {
    const address = deployContract(
      privateKey,
      'src/tokens/MockJEJU.sol:MockJEJU',
      [deployer],
      'JEJU Token',
    )
    // Update config
    if (!config.testnet) config.testnet = {}
    if (!config.testnet.tokens) config.testnet.tokens = {}
    config.testnet.tokens.jeju = address
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    return address
  }

  if (configKey === 'usdc') {
    const address = deployContract(
      privateKey,
      'src/tokens/NetworkUSDC.sol:NetworkUSDC',
      [deployer, '1000000000000000', 'true'], // 1B USDC, mintable
      'Mock USDC',
    )
    if (!config.testnet) config.testnet = {}
    if (!config.testnet.tokens) config.testnet.tokens = {}
    config.testnet.tokens.usdc = address
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    return address
  }

  throw new Error(`Unknown token: ${configKey}`)
}

async function deployTFMMPools(
  privateKey: string,
  deployer: string,
  tokens: { jeju: string; usdc: string },
): Promise<DeployedPool[]> {
  console.log('\n=== Deploying TFMM Liquidity Pools ===\n')

  const pools: DeployedPool[] = []

  const poolConfigs: TFMMPoolConfig[] = [
    {
      name: 'JEJU-USDC Pool',
      symbol: 'TFMM-JEJU-USDC',
      tokens: [tokens.jeju, tokens.usdc],
      initialWeights: ['500000000000000000', '500000000000000000'], // 50/50
      swapFeeBps: 30,
      initialLiquidity: ['100000000000000000000000', '10000000000'], // 100k JEJU, 10k USDC (6 decimals)
    },
  ]

  for (const poolConfig of poolConfigs) {
    console.log(`  Deploying ${poolConfig.name}...`)

    // Build constructor arguments
    const constructorTypes = 'string,string,address[],uint256[],uint256,address'
    const tokensArray = `[${poolConfig.tokens.map((t) => `"${t}"`).join(',')}]`
    const weightsArray = `[${poolConfig.initialWeights.join(',')}]`
    const constructorValues = `"${poolConfig.name}" "${poolConfig.symbol}" ${tokensArray} ${weightsArray} ${poolConfig.swapFeeBps} ${deployer}`

    // Get bytecode
    const artifactPath = join(CONTRACTS_DIR, 'out/TFMMPool.sol/TFMMPool.json')
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf-8'))
    let bytecode = artifact.bytecode.object as string

    // Encode constructor args
    const encoded = exec(
      `cast abi-encode "constructor(${constructorTypes})" ${constructorValues}`,
    )
    bytecode = bytecode + encoded.slice(2)

    // Deploy with high gas price
    const cmd = `cast send --rpc-url ${RPC_URL} --private-key ${privateKey} --create "${bytecode}" --json`
    const output = exec(cmd)
    const result = JSON.parse(output)
    const poolAddress = result.contractAddress

    if (!poolAddress) {
      console.log(`    Failed to deploy ${poolConfig.name}`)
      continue
    }

    console.log(`    ${poolConfig.name}: ${poolAddress}`)

    // Approve tokens
    console.log('    Approving tokens...')
    for (let i = 0; i < poolConfig.tokens.length; i++) {
      sendTx(
        privateKey,
        poolConfig.tokens[i],
        'approve(address,uint256)',
        [poolAddress, poolConfig.initialLiquidity[i]],
        `    Approved ${i === 0 ? 'JEJU' : 'USDC'}`,
      )
    }

    // Add liquidity
    console.log('    Adding initial liquidity...')
    const amountsArray = `"[${poolConfig.initialLiquidity.join(',')}]"`
    const addLiquidityCmd = `cast send ${poolAddress} "addLiquidity(uint256[],uint256)" ${amountsArray} 0 --rpc-url ${RPC_URL} --private-key ${privateKey}`

    try {
      exec(addLiquidityCmd)
      console.log('    Liquidity added.')
    } catch (_error) {
      console.log(
        '    Warning: Liquidity add failed, pool created without initial liquidity',
      )
    }

    pools.push({
      address: poolAddress,
      name: poolConfig.name,
      symbol: poolConfig.symbol,
      tokens: poolConfig.tokens,
    })
  }

  return pools
}

function saveDeployment(pools: DeployedPool[]): void {
  // Save TFMM deployment file
  const tfmmDeployPath = join(CONTRACTS_DIR, 'deployments/tfmm-testnet.json')
  writeFileSync(
    tfmmDeployPath,
    JSON.stringify(
      {
        pools,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )
  console.log(`\nSaved: ${tfmmDeployPath}`)

  // Update contracts.json
  const configPath = join(CONFIG_DIR, 'contracts.json')
  const config = JSON.parse(readFileSync(configPath, 'utf-8'))

  if (!config.testnet) config.testnet = {}
  if (!config.testnet.amm) config.testnet.amm = {}

  for (const pool of pools) {
    const key = `TFMMPool_${pool.symbol.replace('TFMM-', '').replace('-', '_')}`
    config.testnet.amm[key] = pool.address
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2))
  console.log(`Updated: ${configPath}`)
}

async function main(): Promise<void> {
  console.log('TFMM Testnet Deployment')
  console.log('='.repeat(50))
  console.log(`Network: testnet`)
  console.log(`RPC URL: ${RPC_URL}`)
  console.log(`Chain ID: ${CHAIN_ID}`)

  // Get private key
  const privateKey = process.env.PRIVATE_KEY
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable required')
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const deployer = account.address

  console.log(`\nDeployer: ${deployer}`)

  // Check balance
  const client = createPublicClient({ transport: http(RPC_URL) })
  const balance = await client.getBalance({ address: deployer })
  console.log(`  Balance: ${formatEther(balance)} ETH`)

  if (balance < BigInt(1e17)) {
    throw new Error('Deployer needs at least 0.1 ETH for gas')
  }

  // Ensure contracts are built
  const artifactPath = join(CONTRACTS_DIR, 'out/TFMMPool.sol/TFMMPool.json')
  if (!existsSync(artifactPath)) {
    console.log('\nBuilding contracts...')
    exec(`cd ${CONTRACTS_DIR} && forge build`)
  }
  console.log('Contracts built')

  // Get or deploy tokens
  console.log('\n=== Preparing Tokens ===\n')
  const jeju = await getOrDeployToken(privateKey, deployer, 'jeju')
  const usdc = await getOrDeployToken(privateKey, deployer, 'usdc')

  // Deploy TFMM pools
  const pools = await deployTFMMPools(privateKey, deployer, { jeju, usdc })

  if (pools.length > 0) {
    saveDeployment(pools)
  }

  // Summary
  console.log(`\n${'='.repeat(50)}`)
  console.log('TFMM TESTNET DEPLOYMENT COMPLETE')
  console.log('='.repeat(50))
  console.log('\nTokens:')
  console.log(`  JEJU: ${jeju}`)
  console.log(`  USDC: ${usdc}`)
  console.log('\nTFMM Pools:')
  for (const pool of pools) {
    console.log(`  ${pool.name}: ${pool.address}`)
  }

  if (pools.length === 0) {
    console.log('  No pools deployed')
  }

  console.log('\nNext Steps:')
  console.log('  1. Visit: https://bazaar.testnet.jejunetwork.org/pools')
  console.log('  2. Connect wallet with testnet ETH')
  console.log('\n')
}

main().catch((error) => {
  console.error('\nDeployment failed:', error.message || error)
  process.exit(1)
})
