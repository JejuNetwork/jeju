#!/usr/bin/env bun
/**
 * Deploy Jeju ICO Launchpad for localnet/testnet
 * 
 * Deploys:
 * 1. JejuPresale contract with official tokenomics
 * 2. Example NFT collection for testing
 * 3. JEJU/ETH AMM liquidity pool
 * 
 * Usage:
 *   bun run scripts/deploy-jeju-launchpad.ts --network localnet
 *   bun run scripts/deploy-jeju-launchpad.ts --network testnet
 */

import { execSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { parseArgs } from 'util'

const { values: args } = parseArgs({
  options: {
    network: { type: 'string', default: 'localnet' },
    help: { type: 'boolean', default: false },
  },
})

if (args.help) {
  console.log(`
Deploy Jeju ICO Launchpad

Usage:
  bun run scripts/deploy-jeju-launchpad.ts [options]

Options:
  --network <name>  Network to deploy to (localnet|testnet) [default: localnet]
  --help            Show this help message
`)
  process.exit(0)
}

const network = args.network as 'localnet' | 'testnet'
const ROOT_DIR = process.cwd()
const CONTRACTS_DIR = join(ROOT_DIR, 'packages/contracts')

// Network configurations
const NETWORKS = {
  localnet: {
    rpcUrl: 'http://127.0.0.1:9545',
    chainId: 1337,
    privateKey: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  },
  testnet: {
    rpcUrl: process.env.TESTNET_RPC_URL || 'https://sepolia.base.org',
    chainId: 84532,
    privateKey: process.env.PRIVATE_KEY,
  },
} as const

// Jeju ICO Configuration
const JEJU_ICO_CONFIG = {
  // Presale config
  softCap: 10n * 10n ** 18n, // 10 ETH for testing (1000 ETH in prod)
  hardCap: 50n * 10n ** 18n, // 50 ETH for testing (3000 ETH in prod)
  minContribution: 1n * 10n ** 16n, // 0.01 ETH
  maxContribution: 10n * 10n ** 18n, // 10 ETH for testing
  tokenPrice: 3n * 10n ** 12n, // 0.000003 ETH per JEJU
  
  // Timing (relative to now)
  whitelistDuration: 60, // 1 min for testing (7 days in prod)
  publicDuration: 60 * 5, // 5 min for testing (7 days in prod)
  tgeDelay: 60, // 1 min after presale ends (immediate in prod)
  
  // Vesting
  tgePercent: 2000, // 20% at TGE
  cliffDuration: 0, // No cliff
  vestingDuration: 60 * 10, // 10 min for testing (180 days in prod)
}

interface DeploymentResult {
  network: string
  chainId: number
  contracts: {
    jejuToken: string
    jejuPresale: string
    exampleNFT: string
    xlpV2Factory: string
    xlpV2Router: string
    jejuEthPair: string
  }
  deployedAt: string
}

class JejuLaunchpadDeployer {
  private rpcUrl: string
  private chainId: number
  private privateKey: string
  private deployerAddress: string

  constructor() {
    const config = NETWORKS[network]
    if (!config.privateKey) {
      throw new Error('PRIVATE_KEY environment variable required for testnet')
    }
    this.rpcUrl = config.rpcUrl
    this.chainId = config.chainId
    this.privateKey = config.privateKey
    this.deployerAddress = this.getAddress(this.privateKey)
  }

  async deploy(): Promise<DeploymentResult> {
    console.log('🏝️  Jeju ICO Launchpad Deployment')
    console.log('='.repeat(60))
    console.log(`Network: ${network} (chainId: ${this.chainId})`)
    console.log(`Deployer: ${this.deployerAddress}`)
    console.log('')

    await this.checkPrerequisites()

    const result: DeploymentResult = {
      network,
      chainId: this.chainId,
      contracts: {} as DeploymentResult['contracts'],
      deployedAt: new Date().toISOString(),
    }

    // Step 1: Load existing contracts or deploy new ones
    console.log('📦 STEP 1: Loading existing contracts')
    console.log('-'.repeat(60))
    const existing = await this.loadExistingContracts()
    result.contracts.jejuToken = existing.jejuToken
    result.contracts.xlpV2Factory = existing.xlpV2Factory
    result.contracts.xlpV2Router = existing.xlpV2Router || ''
    console.log('')

    // Step 2: Deploy JejuPresale
    console.log('🎟️  STEP 2: Deploying JejuPresale')
    console.log('-'.repeat(60))
    result.contracts.jejuPresale = await this.deployJejuPresale(result.contracts.jejuToken)
    console.log('')

    // Step 3: Configure Presale
    console.log('⚙️  STEP 3: Configuring JejuPresale')
    console.log('-'.repeat(60))
    await this.configurePresale(result.contracts.jejuPresale)
    console.log('')

    // Step 4: Fund Presale with Tokens
    console.log('💰 STEP 4: Funding Presale with JEJU tokens')
    console.log('-'.repeat(60))
    await this.fundPresale(result.contracts.jejuToken, result.contracts.jejuPresale)
    console.log('')

    // Step 5: Deploy Example NFT
    console.log('🖼️  STEP 5: Deploying Example NFT Collection')
    console.log('-'.repeat(60))
    result.contracts.exampleNFT = await this.deployExampleNFT()
    console.log('')

    // Step 6: Create JEJU/ETH Liquidity Pool
    console.log('💧 STEP 6: Creating JEJU/ETH Liquidity Pool')
    console.log('-'.repeat(60))
    result.contracts.jejuEthPair = await this.createJejuEthPool(
      result.contracts.jejuToken,
      result.contracts.xlpV2Factory,
    )
    console.log('')

    // Save deployment result
    this.saveDeployment(result)

    // Print summary
    this.printSummary(result)

    return result
  }

  private async checkPrerequisites(): Promise<void> {
    console.log('Checking prerequisites...')
    
    if (network === 'localnet') {
      const blockNumber = execSync(`cast block-number --rpc-url ${this.rpcUrl}`, { encoding: 'utf-8' }).trim()
      console.log(`✅ Localnet running (block ${blockNumber})`)
    }

    const balance = execSync(`cast balance ${this.deployerAddress} --rpc-url ${this.rpcUrl}`, { encoding: 'utf-8' }).trim()
    const balanceEth = Number(BigInt(balance) / 10n ** 18n)
    console.log(`✅ Deployer balance: ${balanceEth} ETH`)

    if (balanceEth < 1) {
      throw new Error('Deployer needs at least 1 ETH')
    }
    console.log('')
  }

  private async loadExistingContracts(): Promise<{
    jejuToken: string
    xlpV2Factory: string
    xlpV2Router?: string
  }> {
    // Try to load from existing deployment files
    const localnetPath = join(CONTRACTS_DIR, 'deployments/localnet-complete.json')
    const addressesPath = join(CONTRACTS_DIR, 'deployments/localnet-addresses.json')
    
    let jejuToken = ''
    let xlpV2Factory = ''
    let xlpV2Router = ''

    if (existsSync(localnetPath)) {
      const data = JSON.parse(readFileSync(localnetPath, 'utf-8'))
      jejuToken = data.contracts?.jeju || ''
      console.log(`  ✅ JEJU Token: ${jejuToken || 'Not found'}`)
    }

    if (existsSync(addressesPath)) {
      const data = JSON.parse(readFileSync(addressesPath, 'utf-8'))
      xlpV2Factory = data.xlpV2Factory || ''
      xlpV2Router = data.xlpV2Router || ''
      console.log(`  ✅ XLP V2 Factory: ${xlpV2Factory || 'Not found'}`)
    }

    // If not found, deploy
    if (!jejuToken) {
      console.log('  ⚠️  JEJU Token not found, deploying...')
      jejuToken = this.deployContract(
        'src/tokens/JejuToken.sol:JejuToken',
        [this.deployerAddress, this.deployerAddress, 'true'], // owner, banManager, enableFaucet
        'JejuToken'
      )
    }

    if (!xlpV2Factory) {
      console.log('  ⚠️  XLP V2 Factory not found, deploying...')
      xlpV2Factory = this.deployContract(
        'src/amm/v2/XLPV2Factory.sol:XLPV2Factory',
        [this.deployerAddress], // feeToSetter
        'XLPV2Factory'
      )
    }

    return { jejuToken, xlpV2Factory, xlpV2Router }
  }

  private async deployJejuPresale(jejuToken: string): Promise<string> {
    return this.deployContract(
      'src/tokens/JejuPresale.sol:JejuPresale',
      [jejuToken, this.deployerAddress, this.deployerAddress], // token, treasury, owner
      'JejuPresale'
    )
  }

  private async configurePresale(presaleAddress: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    const whitelistStart = now + 30 // Start in 30 seconds
    const publicStart = whitelistStart + JEJU_ICO_CONFIG.whitelistDuration
    const presaleEnd = publicStart + JEJU_ICO_CONFIG.publicDuration
    const tgeTimestamp = presaleEnd + JEJU_ICO_CONFIG.tgeDelay

    // Configure presale
    this.sendTx(
      presaleAddress,
      `configure(uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256) ${JEJU_ICO_CONFIG.softCap} ${JEJU_ICO_CONFIG.hardCap} ${JEJU_ICO_CONFIG.minContribution} ${JEJU_ICO_CONFIG.maxContribution} ${JEJU_ICO_CONFIG.tokenPrice} ${whitelistStart} ${publicStart} ${presaleEnd} ${tgeTimestamp}`,
      'configure'
    )

    // Set vesting
    this.sendTx(
      presaleAddress,
      `setVesting(uint256,uint256,uint256) ${JEJU_ICO_CONFIG.tgePercent} ${JEJU_ICO_CONFIG.cliffDuration} ${JEJU_ICO_CONFIG.vestingDuration}`,
      'setVesting'
    )

    console.log(`  ✅ Presale configured:`)
    console.log(`     Whitelist starts: ${new Date(whitelistStart * 1000).toLocaleTimeString()}`)
    console.log(`     Public starts: ${new Date(publicStart * 1000).toLocaleTimeString()}`)
    console.log(`     Presale ends: ${new Date(presaleEnd * 1000).toLocaleTimeString()}`)
    console.log(`     TGE: ${new Date(tgeTimestamp * 1000).toLocaleTimeString()}`)
  }

  private async fundPresale(jejuToken: string, presaleAddress: string): Promise<void> {
    // Transfer 100M JEJU for presale (10% of initial supply)
    const presaleAmount = 100_000_000n * 10n ** 18n

    this.sendTx(
      jejuToken,
      `transfer(address,uint256) ${presaleAddress} ${presaleAmount}`,
      'Fund presale with 100M JEJU'
    )

    console.log(`  ✅ Transferred 100,000,000 JEJU to presale contract`)
  }

  private async deployExampleNFT(): Promise<string> {
    return this.deployContract(
      'src/marketplace/MockERC721.sol:MockERC721',
      ['"Jeju Test NFT"', '"JNFT"'], // name, symbol
      'Example NFT (MockERC721)'
    )
  }

  private async createJejuEthPool(jejuToken: string, xlpV2Factory: string): Promise<string> {
    // Get WETH address (OP Stack standard)
    const weth = '0x4200000000000000000000000000000000000006'
    
    // Check if pair exists
    const pairCheck = execSync(
      `cast call ${xlpV2Factory} "getPair(address,address)(address)" ${jejuToken} ${weth} --rpc-url ${this.rpcUrl}`,
      { encoding: 'utf-8' }
    ).trim()

    let pairAddress = pairCheck
    
    if (pairAddress === '0x0000000000000000000000000000000000000000') {
      // Create pair
      this.sendTx(
        xlpV2Factory,
        `createPair(address,address) ${jejuToken} ${weth}`,
        'Create JEJU/WETH pair'
      )

      // Get pair address
      pairAddress = execSync(
        `cast call ${xlpV2Factory} "getPair(address,address)(address)" ${jejuToken} ${weth} --rpc-url ${this.rpcUrl}`,
        { encoding: 'utf-8' }
      ).trim()
    }

    console.log(`  ✅ JEJU/ETH Pair: ${pairAddress}`)

    // Add initial liquidity (10M JEJU + 10 ETH for testing)
    const jejuAmount = 10_000_000n * 10n ** 18n
    const ethAmount = 10n * 10n ** 18n

    // Approve tokens to pair
    this.sendTx(jejuToken, `approve(address,uint256) ${pairAddress} ${jejuAmount}`, 'Approve JEJU')

    // Transfer tokens directly to pair
    this.sendTx(jejuToken, `transfer(address,uint256) ${pairAddress} ${jejuAmount}`, 'Transfer JEJU to pair')

    // Wrap ETH and transfer to pair
    execSync(
      `cast send ${weth} "deposit()" --value ${ethAmount} --rpc-url ${this.rpcUrl} --private-key ${this.privateKey}`,
      { stdio: 'pipe' }
    )
    this.sendTx(weth, `transfer(address,uint256) ${pairAddress} ${ethAmount}`, 'Transfer WETH to pair')

    // Mint LP tokens
    this.sendTx(pairAddress, `mint(address) ${this.deployerAddress}`, 'Mint initial LP')

    console.log(`  ✅ Added initial liquidity: 10M JEJU + 10 ETH`)

    return pairAddress
  }

  private deployContract(path: string, args: string[], name: string): string {
    const argsStr = args.join(' ')
    const cmd = `cd packages/contracts && forge create ${path} \
      --rpc-url ${this.rpcUrl} \
      --private-key ${this.privateKey} \
      ${args.length > 0 ? `--constructor-args ${argsStr}` : ''} \
      --json`

    const output = execSync(cmd, { encoding: 'utf-8', maxBuffer: 50 * 1024 * 1024 })
    const result = JSON.parse(output)
    
    console.log(`  ✅ ${name}: ${result.deployedTo}`)
    return result.deployedTo
  }

  private sendTx(to: string, signature: string, label: string): void {
    const cmd = `cast send ${to} "${signature}" --rpc-url ${this.rpcUrl} --private-key ${this.privateKey}`
    execSync(cmd, { stdio: 'pipe' })
    console.log(`     ${label}`)
  }

  private getAddress(privateKey: string): string {
    return execSync(`cast wallet address ${privateKey}`, { encoding: 'utf-8' }).trim()
  }

  private saveDeployment(result: DeploymentResult): void {
    const deploymentDir = join(CONTRACTS_DIR, `deployments/${network}`)
    if (!existsSync(deploymentDir)) {
      mkdirSync(deploymentDir, { recursive: true })
    }

    const path = join(deploymentDir, 'jeju-launchpad.json')
    writeFileSync(path, JSON.stringify(result, null, 2))
    console.log(`💾 Saved: ${path}`)

    // Update Bazaar config
    const bazaarConfigPath = join(ROOT_DIR, 'apps/bazaar/config/jeju-tokenomics.ts')
    if (existsSync(bazaarConfigPath)) {
      let content = readFileSync(bazaarConfigPath, 'utf-8')
      
      // Update contract addresses
      const addressRegex = new RegExp(`${network}: \\{[^}]+\\}`, 'g')
      const newAddresses = `${network}: {
    token: '${result.contracts.jejuToken}' as const,
    presale: '${result.contracts.jejuPresale}' as const,
  }`
      
      if (content.includes(`${network}: {`)) {
        content = content.replace(addressRegex, newAddresses)
      }
      
      writeFileSync(bazaarConfigPath, content)
      console.log(`💾 Updated: ${bazaarConfigPath}`)
    }
  }

  private printSummary(result: DeploymentResult): void {
    console.log('')
    console.log('='.repeat(60))
    console.log('✅ Jeju ICO Launchpad Deployed')
    console.log('='.repeat(60))
    console.log('')
    console.log('📋 Contracts:')
    console.log(`   JEJU Token:    ${result.contracts.jejuToken}`)
    console.log(`   JEJU Presale:  ${result.contracts.jejuPresale}`)
    console.log(`   Example NFT:   ${result.contracts.exampleNFT}`)
    console.log(`   XLP V2 Factory: ${result.contracts.xlpV2Factory}`)
    console.log(`   JEJU/ETH Pair: ${result.contracts.jejuEthPair}`)
    console.log('')
    console.log('🎯 What to do next:')
    console.log('   1. Start Bazaar: cd apps/bazaar && bun run dev')
    console.log('   2. Visit: http://localhost:3000/coins/jeju-ico')
    console.log('   3. Connect wallet and contribute to presale')
    console.log('')
    console.log('💧 Test Commands:')
    console.log(`   # Claim JEJU from faucet:`)
    console.log(`   cast send ${result.contracts.jejuToken} "faucet()" --rpc-url ${this.rpcUrl}`)
    console.log('')
    console.log(`   # Contribute to presale:`)
    console.log(`   cast send ${result.contracts.jejuPresale} "contribute()" --value 0.1ether --rpc-url ${this.rpcUrl}`)
    console.log('')
    console.log(`   # Check presale stats:`)
    console.log(`   cast call ${result.contracts.jejuPresale} "getPresaleStats()" --rpc-url ${this.rpcUrl}`)
    console.log('')
  }
}

// Run
const deployer = new JejuLaunchpadDeployer()
deployer.deploy().catch((error) => {
  console.error('❌ Deployment failed:', error)
  process.exit(1)
})
