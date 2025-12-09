/**
 * CONTRACT VERIFICATION TESTS
 * 
 * Verifies that deployed contracts on localnet are callable and return expected values.
 * These tests interact with REAL deployed contracts.
 */

import { describe, test, expect, beforeAll } from 'bun:test'
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  parseAbi,
  type Address,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { rawDeployments } from '@jejunetwork/contracts'

// =============================================================================
// CONFIGURATION
// =============================================================================

const RPC_URL = process.env.L2_RPC_URL || 'http://localhost:9545'
const CHAIN_ID = 420691 // Jeju localnet chain ID
const DEPLOYER_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' as `0x${string}`
const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as Address

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

function isDeployed(address: string | undefined): address is Address {
  return !!address && address !== ZERO_ADDRESS
}

const localnet = {
  id: CHAIN_ID,
  name: 'Anvil',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
}

// =============================================================================
// ABIs
// =============================================================================

const MOCK_SWAP_ROUTER_ABI = parseAbi([
  'function poolManager() view returns (address)',
  'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minAmountOut, address recipient) returns (uint256 amountOut)',
])

const MOCK_POSITION_MANAGER_ABI = parseAbi([
  'function poolManager() view returns (address)',
  'function addLiquidity(address token0, address token1, uint256 amount0, uint256 amount1, address recipient) returns (uint256 liquidity)',
])

const MOCK_QUOTER_ABI = parseAbi([
  'function poolManager() view returns (address)',
  'function quoteExactInput(address tokenIn, address tokenOut, uint256 amountIn) view returns (uint256 amountOut)',
])

const MOCK_STATE_VIEW_ABI = parseAbi([
  'function poolManager() view returns (address)',
  'function getPoolState(address token0, address token1) view returns (uint160 sqrtPriceX96, int24 tick, uint128 liquidity)',
])

const BAZAAR_MARKETPLACE_ABI = parseAbi([
  'function version() view returns (string)',
  'function platformFeeBps() view returns (uint256)',
  'function feeRecipient() view returns (address)',
])

const TOKEN_FACTORY_ABI = parseAbi([
  'function tokenCount() view returns (uint256)',
  'function getAllTokens(uint256 offset, uint256 limit) view returns (address[])',
  'function getCreatorTokens(address creator) view returns (address[])',
  'function createToken(string name, string symbol, uint8 decimals, uint256 initialSupply) returns (address)',
])

const ERC20_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address account) view returns (uint256)',
])

// =============================================================================
// SETUP
// =============================================================================

interface Deployments {
  v4: {
    swapRouter?: Address
    positionManager?: Address
    quoterV4?: Address
    stateView?: Address
  }
  marketplace: {
    at?: Address
    marketplace?: Address
  }
  factory: {
    at?: Address
  }
}

let publicClient: PublicClient
let walletClient: WalletClient
let deployments: Deployments
let skipTests = false

function loadDeployment(filename: string): Record<string, string> {
  const deploymentMap: Record<string, Record<string, string>> = {
    'uniswap-v4-1337.json': rawDeployments.uniswapV4_1337 as Record<string, string>,
    'bazaar-marketplace-1337.json': rawDeployments.bazaarMarketplace1337 as Record<string, string>,
    'erc20-factory-1337.json': rawDeployments.erc20Factory1337 as Record<string, string>,
    'multi-token-system-1337.json': rawDeployments.multiTokenSystem1337 as Record<string, string>,
  }
  return deploymentMap[filename] || {}
}

beforeAll(async () => {
  publicClient = createPublicClient({
    chain: localnet,
    transport: http(RPC_URL),
  })

  const account = privateKeyToAccount(DEPLOYER_KEY)
  walletClient = createWalletClient({
    account,
    chain: localnet,
    transport: http(RPC_URL),
  })

  try {
    await publicClient.getBlockNumber()
    console.log(`\n✅ Connected to localnet at ${RPC_URL}`)
  } catch {
    console.error(`\n❌ Cannot connect to localnet`)
    skipTests = true
    return
  }

  deployments = {
    v4: loadDeployment('uniswap-v4-1337.json'),
    marketplace: loadDeployment('bazaar-marketplace-1337.json'),
    factory: loadDeployment('erc20-factory-1337.json'),
  }
})

// =============================================================================
// TESTS: V4 PERIPHERY CONTRACTS
// =============================================================================

describe('V4 Periphery Contracts', () => {
  test('SwapRouter should be callable', async () => {
    if (skipTests) return
    const swapRouter = deployments.v4.swapRouter as Address
    if (!isDeployed(swapRouter)) {
      console.log('   ⚠️ SwapRouter not deployed')
      return
    }

    // Verify contract exists
    const code = await publicClient.getCode({ address: swapRouter })
    expect(code).not.toBe('0x')
    
    // Call poolManager() to verify contract works
    const poolManager = await publicClient.readContract({
      address: swapRouter,
      abi: MOCK_SWAP_ROUTER_ABI,
      functionName: 'poolManager',
    })
    
    expect(poolManager).toMatch(/^0x[a-fA-F0-9]{40}$/)
    console.log(`   SwapRouter: ${swapRouter}`)
    console.log(`   PoolManager: ${poolManager}`)
    console.log(`   ✅ SwapRouter is callable`)
  })

  test('PositionManager should be callable', async () => {
    if (skipTests) return
    const positionManager = deployments.v4.positionManager as Address
    if (!isDeployed(positionManager)) {
      console.log('   ⚠️ PositionManager not deployed')
      return
    }

    const code = await publicClient.getCode({ address: positionManager })
    expect(code).not.toBe('0x')
    
    const poolManager = await publicClient.readContract({
      address: positionManager,
      abi: MOCK_POSITION_MANAGER_ABI,
      functionName: 'poolManager',
    })
    
    expect(poolManager).toMatch(/^0x[a-fA-F0-9]{40}$/)
    console.log(`   PositionManager: ${positionManager}`)
    console.log(`   ✅ PositionManager is callable`)
  })

  test('Quoter should be callable', async () => {
    if (skipTests) return
    const quoter = deployments.v4.quoterV4 as Address
    if (!isDeployed(quoter)) {
      console.log('   ⚠️ Quoter not deployed')
      return
    }

    const code = await publicClient.getCode({ address: quoter })
    expect(code).not.toBe('0x')
    
    const poolManager = await publicClient.readContract({
      address: quoter,
      abi: MOCK_QUOTER_ABI,
      functionName: 'poolManager',
    })
    
    expect(poolManager).toMatch(/^0x[a-fA-F0-9]{40}$/)
    console.log(`   Quoter: ${quoter}`)
    console.log(`   ✅ Quoter is callable`)
  })

  test('StateView should be callable', async () => {
    if (skipTests) return
    const stateView = deployments.v4.stateView as Address
    if (!isDeployed(stateView)) {
      console.log('   ⚠️ StateView not deployed')
      return
    }

    const code = await publicClient.getCode({ address: stateView })
    expect(code).not.toBe('0x')
    
    const poolManager = await publicClient.readContract({
      address: stateView,
      abi: MOCK_STATE_VIEW_ABI,
      functionName: 'poolManager',
    })
    
    expect(poolManager).toMatch(/^0x[a-fA-F0-9]{40}$/)
    console.log(`   StateView: ${stateView}`)
    console.log(`   ✅ StateView is callable`)
  })
})

// =============================================================================
// TESTS: BAZAAR MARKETPLACE
// =============================================================================

describe('Bazaar Marketplace Contract', () => {
  test('should read marketplace version', async () => {
    if (skipTests) return
    const marketplace = (deployments.marketplace.at || deployments.marketplace.marketplace) as Address
    if (!isDeployed(marketplace)) {
      console.log('   ⚠️ Marketplace not deployed')
      return
    }

    const version = await publicClient.readContract({
      address: marketplace,
      abi: BAZAAR_MARKETPLACE_ABI,
      functionName: 'version',
    })
    
    expect(version).toBe('1.0.0')
    console.log(`   Marketplace: ${marketplace}`)
    console.log(`   Version: ${version}`)
    console.log(`   ✅ Marketplace version verified`)
  })

  test('should read platform fee', async () => {
    if (skipTests) return
    const marketplace = (deployments.marketplace.at || deployments.marketplace.marketplace) as Address
    if (!isDeployed(marketplace)) {
      console.log('   ⚠️ Marketplace not deployed')
      return
    }

    const feeBps = await publicClient.readContract({
      address: marketplace,
      abi: BAZAAR_MARKETPLACE_ABI,
      functionName: 'platformFeeBps',
    })
    
    // Fee should be between 0 and 1000 (0% to 10%)
    expect(Number(feeBps)).toBeGreaterThanOrEqual(0)
    expect(Number(feeBps)).toBeLessThanOrEqual(1000)
    
    console.log(`   Platform fee: ${Number(feeBps) / 100}%`)
    console.log(`   ✅ Platform fee is valid`)
  })

  test('should read fee recipient', async () => {
    if (skipTests) return
    const marketplace = (deployments.marketplace.at || deployments.marketplace.marketplace) as Address
    if (!isDeployed(marketplace)) {
      console.log('   ⚠️ Marketplace not deployed')
      return
    }

    const feeRecipient = await publicClient.readContract({
      address: marketplace,
      abi: BAZAAR_MARKETPLACE_ABI,
      functionName: 'feeRecipient',
    })
    
    expect(feeRecipient).toMatch(/^0x[a-fA-F0-9]{40}$/)
    console.log(`   Fee recipient: ${feeRecipient}`)
    console.log(`   ✅ Fee recipient is set`)
  })
})

// =============================================================================
// TESTS: TOKEN FACTORY
// =============================================================================

describe('Token Factory Contract', () => {
  test('should read token count', async () => {
    if (skipTests) return
    const factory = deployments.factory.at as Address
    if (!isDeployed(factory)) {
      console.log('   ⚠️ Factory not deployed')
      return
    }

    const count = await publicClient.readContract({
      address: factory,
      abi: TOKEN_FACTORY_ABI,
      functionName: 'tokenCount',
    })
    
    console.log(`   Factory: ${factory}`)
    console.log(`   Token count: ${count}`)
    console.log(`   ✅ Token count readable`)
  })

  test('should create a new token', async () => {
    if (skipTests) return
    const factory = deployments.factory.at as Address
    if (!isDeployed(factory)) {
      console.log('   ⚠️ Factory not deployed')
      return
    }

    // Get initial count
    const initialCount = await publicClient.readContract({
      address: factory,
      abi: TOKEN_FACTORY_ABI,
      functionName: 'tokenCount',
    })

    // Create a new token
    const tokenName = `TestToken${Date.now()}`
    const tokenSymbol = `TT${Date.now().toString().slice(-4)}`
    
    const hash = await walletClient.writeContract({
      address: factory,
      abi: TOKEN_FACTORY_ABI,
      functionName: 'createToken',
      args: [tokenName, tokenSymbol, 18, parseEther('1000000')],
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')

    // Verify count increased
    const newCount = await publicClient.readContract({
      address: factory,
      abi: TOKEN_FACTORY_ABI,
      functionName: 'tokenCount',
    })

    expect(newCount).toBe(initialCount + 1n)
    console.log(`   Created token: ${tokenName} (${tokenSymbol})`)
    console.log(`   Token count: ${initialCount} → ${newCount}`)
    console.log(`   ✅ Token creation works`)
  })

  test('should list creator tokens', async () => {
    if (skipTests) return
    const factory = deployments.factory.at as Address
    if (!isDeployed(factory)) {
      console.log('   ⚠️ Factory not deployed')
      return
    }

    const tokens = await publicClient.readContract({
      address: factory,
      abi: TOKEN_FACTORY_ABI,
      functionName: 'getCreatorTokens',
      args: [DEPLOYER_ADDRESS],
    })

    console.log(`   Creator: ${DEPLOYER_ADDRESS}`)
    console.log(`   Tokens created: ${tokens.length}`)
    
    // Verify each token is a valid ERC20
    for (const token of tokens.slice(0, 3)) {
      const name = await publicClient.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'name',
      })
      console.log(`     - ${name}: ${token}`)
    }
    
    if (tokens.length > 3) {
      console.log(`     ... and ${tokens.length - 3} more`)
    }
    
    console.log(`   ✅ Creator tokens listed`)
  })
})

// =============================================================================
// TESTS: TOKEN VERIFICATION
// =============================================================================

describe('Created Token Verification', () => {
  test('should verify created token is valid ERC20', async () => {
    if (skipTests) return
    const factory = deployments.factory.at as Address
    if (!isDeployed(factory)) {
      console.log('   ⚠️ Factory not deployed')
      return
    }

    // Get first token from creator
    const tokens = await publicClient.readContract({
      address: factory,
      abi: TOKEN_FACTORY_ABI,
      functionName: 'getCreatorTokens',
      args: [DEPLOYER_ADDRESS],
    })

    if (tokens.length === 0) {
      console.log('   ⚠️ No tokens created yet')
      return
    }

    const tokenAddress = tokens[0]

    // Verify ERC20 interface
    const name = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'name',
    })

    const symbol = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'symbol',
    })

    const decimals = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'decimals',
    })

    const totalSupply = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'totalSupply',
    })

    const balance = await publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [DEPLOYER_ADDRESS],
    })

    console.log(`   Token: ${name} (${symbol})`)
    console.log(`   Address: ${tokenAddress}`)
    console.log(`   Decimals: ${decimals}`)
    console.log(`   Total supply: ${formatEther(totalSupply)}`)
    console.log(`   Creator balance: ${formatEther(balance)}`)
    
    expect(decimals).toBe(18)
    expect(totalSupply).toBeGreaterThan(0n)
    expect(balance).toBe(totalSupply) // Creator gets all initial supply
    
    console.log(`   ✅ Token is valid ERC20`)
  })
})

// =============================================================================
// SUMMARY
// =============================================================================

describe('Contract Verification Summary', () => {
  test('print summary', async () => {
    if (skipTests || !deployments) {
      console.log('   ⚠️ Skipped: Localnet not running')
      return
    }
    
    console.log('')
    console.log('═══════════════════════════════════════════════════════')
    console.log('       CONTRACT VERIFICATION SUMMARY')
    console.log('═══════════════════════════════════════════════════════')
    console.log('')
    console.log('V4 Periphery:')
    console.log(`  ${isDeployed(deployments.v4?.swapRouter) ? '✅' : '❌'} SwapRouter`)
    console.log(`  ${isDeployed(deployments.v4?.positionManager) ? '✅' : '❌'} PositionManager`)
    console.log(`  ${isDeployed(deployments.v4?.quoterV4) ? '✅' : '❌'} Quoter`)
    console.log(`  ${isDeployed(deployments.v4?.stateView) ? '✅' : '❌'} StateView`)
    console.log('')
    console.log('Marketplace:')
    console.log(`  ${isDeployed(deployments.marketplace?.at || deployments.marketplace?.marketplace) ? '✅' : '❌'} Bazaar Marketplace`)
    console.log('')
    console.log('Token Factory:')
    console.log(`  ${isDeployed(deployments.factory?.at) ? '✅' : '❌'} ERC20 Factory`)
    console.log('')
    console.log('═══════════════════════════════════════════════════════')
    console.log('')
    console.log('⚠️  NOTE: V4 periphery contracts are MOCK implementations')
    console.log('         For production, deploy official Uniswap V4 contracts')
    console.log('')
    console.log('═══════════════════════════════════════════════════════')
  })
})

