#!/usr/bin/env bun
/**
 * Development server for Node App
 *
 * Provides:
 * 1. Frontend build with hot reload
 * 2. Mock API server for Tauri commands
 * 3. Integration with DWS services
 */

import { watch } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.PORT) || 1420
const API_PORT = PORT + 1

// External packages that should not be bundled for browser
const BROWSER_EXTERNALS = [
  'bun:sqlite',
  'child_process',
  'http2',
  'tls',
  'dgram',
  'fs',
  'net',
  'dns',
  'stream',
  'crypto',
  'node:*',
  '@tauri-apps/api/core',
  '@tauri-apps/plugin-fs',
  '@tauri-apps/plugin-os',
  '@tauri-apps/plugin-process',
  '@tauri-apps/plugin-shell',
  '@tauri-apps/plugin-store',
  'webtorrent',
  'ws',
  'prom-client',
]

// Build the frontend
async function buildFrontend(): Promise<boolean> {
  console.log('📦 Building frontend...')

  const result = await Bun.build({
    entrypoints: ['./web/main.tsx'],
    outdir: './dist/dev',
    target: 'browser',
    minify: false,
    sourcemap: 'inline',
    external: BROWSER_EXTERNALS,
    plugins: [
      {
        name: 'tauri-browser-mock',
        setup(build) {
          // Mock Tauri invoke for browser builds
          build.onResolve({ filter: /@tauri-apps\/api\/core/ }, () => ({
            path: 'tauri-browser-mock',
            namespace: 'tauri-browser-mock',
          }))
          build.onLoad(
            { filter: /.*/, namespace: 'tauri-browser-mock' },
            () => ({
              contents: `
              // Browser mock for Tauri invoke
              const API_URL = 'http://localhost:1421';

              export async function invoke(cmd, args = {}) {
                const response = await fetch(\`\${API_URL}/invoke/\${cmd}\`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(args),
                });
                if (!response.ok) {
                  const error = await response.text();
                  throw new Error(error);
                }
                return response.json();
              }
            `,
              loader: 'js',
            }),
          )
        },
      },
    ],
    define: {
      'process.env.NODE_ENV': JSON.stringify('development'),
      'process.env': JSON.stringify({ NODE_ENV: 'development' }),
      'process': JSON.stringify({ env: { NODE_ENV: 'development' } }),
    },
  })

  if (!result.success) {
    console.error('❌ Frontend build failed:')
    for (const log of result.logs) {
      console.error(log)
    }
    return false
  }

  // Copy CSS
  const css = await Bun.file('./web/globals.css').text()
  await Bun.write('./dist/dev/globals.css', css)

  console.log('✅ Frontend built')
  return true
}

// Create the transformed index.html
async function createIndexHtml(): Promise<string> {
  const template = await Bun.file('./index.html').text()

  return template.replace('/web/main.tsx', '/main.js').replace(
    '</head>',
    `
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        darkMode: 'class',
        theme: {
          extend: {
            fontFamily: {
              sans: ['DM Sans', 'system-ui', 'sans-serif'],
              mono: ['JetBrains Mono', 'monospace'],
            },
            colors: {
              'volcanic': {
                50: '#f6f6f7',
                100: '#e2e2e5',
                200: '#c5c5cb',
                300: '#a0a0aa',
                400: '#7c7c88',
                500: '#61616d',
                600: '#4d4d57',
                700: '#3f3f47',
                800: '#35353b',
                900: '#2e2e33',
                950: '#1a1a1e',
              },
              'jeju': {
                50: '#ecfdf5',
                100: '#d1fae5',
                200: '#a7f3d0',
                300: '#6ee7b7',
                400: '#34d399',
                500: '#10b981',
                600: '#059669',
                700: '#047857',
                800: '#065f46',
                900: '#064e3b',
                950: '#022c22',
              },
            },
          },
        },
      };
    </script>
  </head>`,
  )
}

// Import mock data handlers
import { convertHardwareToSnakeCase, detectHardware } from '../api/lib/hardware'

// Mock wallet state
let mockWallet: { address: string; wallet_type: string; agent_id: number | null; is_registered: boolean } | null = null

// Track enabled services
const enabledServices: Set<string> = new Set()

// Mock data for development
function getMockHardware() {
  const rawHardware = detectHardware()
  return convertHardwareToSnakeCase(rawHardware)
}

function getMockWallet() {
  return mockWallet
}

// Fetch real balance from L2 RPC
const JEJU_TOKEN_ADDRESS = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

async function getRealBalance(): Promise<{ eth: string; jeju: string; staked: string; pending_rewards: string }> {
  if (!mockWallet?.address) {
    return { eth: '0', jeju: '0', staked: '0', pending_rewards: '0' }
  }

  try {
    // Fetch ETH balance
    const ethResponse = await fetch('http://localhost:6546', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [mockWallet.address, 'latest'],
        id: 1,
      }),
    })
    const ethData = await ethResponse.json() as { result?: string }
    const ethBalanceWei = ethData.result ? BigInt(ethData.result) : BigInt(0)

    // Fetch JEJU token balance (balanceOf call)
    // Function selector for balanceOf(address) is 0x70a08231
    const balanceOfData = '0x70a08231000000000000000000000000' + mockWallet.address.slice(2).toLowerCase()
    const jejuResponse = await fetch('http://localhost:6546', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [{ to: JEJU_TOKEN_ADDRESS, data: balanceOfData }, 'latest'],
        id: 2,
      }),
    })
    const jejuData = await jejuResponse.json() as { result?: string }
    const jejuBalanceWei = jejuData.result ? BigInt(jejuData.result) : BigInt(0)

    // Return wei as string - frontend handles formatting
    return {
      eth: ethBalanceWei.toString(),
      jeju: jejuBalanceWei.toString(),
      staked: '0',
      pending_rewards: '0',
    }
  } catch (error) {
    console.error('Failed to fetch balance:', error)
    return { eth: '0', jeju: '0', staked: '0', pending_rewards: '0' }
  }
}

function getMockBalance() {
  return {
    eth: '0',
    jeju: '0',
    staked: '0',
    pending_rewards: '0',
  }
}

function getMockServices() {
  const computeRunning = enabledServices.has('compute')
  const proxyRunning = enabledServices.has('proxy')
  const storageRunning = enabledServices.has('storage')
  const cronRunning = enabledServices.has('cron')
  const oracleRunning = enabledServices.has('oracle')

  return [
    {
      metadata: {
        id: 'compute',
        name: 'Compute',
        description:
          'Share CPU/GPU power to earn rewards by running AI inference and compute tasks',
        min_stake_eth: 0.1,
        estimated_earnings_per_hour_usd: 0.5,
        requirements: {
          min_cpu_cores: 2,
          min_memory_mb: 4096,
          min_storage_gb: 50,
          requires_gpu: false,
          min_gpu_memory_mb: null,
          requires_tee: false,
          min_bandwidth_mbps: null,
        },
        warnings: [],
        is_advanced: false,
      },
      status: {
        running: computeRunning,
        uptime_seconds: computeRunning ? Math.floor(Date.now() / 1000) % 3600 : 0,
        requests_served: computeRunning ? Math.floor(Math.random() * 100) : 0,
        earnings_wei: computeRunning ? '1000000000000000' : '0',
        last_error: null,
        health: computeRunning ? 'healthy' : 'stopped',
      },
      meets_requirements: true,
      requirement_issues: [],
    },
    {
      metadata: {
        id: 'proxy',
        name: 'Residential Proxy',
        description:
          'Share your bandwidth as a residential proxy and earn rewards',
        min_stake_eth: 0.05,
        estimated_earnings_per_hour_usd: 0.2,
        requirements: {
          min_cpu_cores: 1,
          min_memory_mb: 1024,
          min_storage_gb: 10,
          requires_gpu: false,
          min_gpu_memory_mb: null,
          requires_tee: false,
          min_bandwidth_mbps: 10,
        },
        warnings: ['May impact your internet speed during high demand'],
        is_advanced: false,
      },
      status: {
        running: proxyRunning,
        uptime_seconds: proxyRunning ? Math.floor(Date.now() / 1000) % 3600 : 0,
        requests_served: proxyRunning ? Math.floor(Math.random() * 50) : 0,
        earnings_wei: proxyRunning ? '500000000000000' : '0',
        last_error: null,
        health: proxyRunning ? 'healthy' : 'stopped',
      },
      meets_requirements: true,
      requirement_issues: [],
    },
    {
      metadata: {
        id: 'storage',
        name: 'Storage',
        description: 'Provide decentralized storage and earn rewards',
        min_stake_eth: 0.2,
        estimated_earnings_per_hour_usd: 0.3,
        requirements: {
          min_cpu_cores: 2,
          min_memory_mb: 4096,
          min_storage_gb: 500,
          requires_gpu: false,
          min_gpu_memory_mb: null,
          requires_tee: false,
          min_bandwidth_mbps: 50,
        },
        warnings: ['Requires significant disk space'],
        is_advanced: false,
      },
      status: {
        running: storageRunning,
        uptime_seconds: storageRunning ? Math.floor(Date.now() / 1000) % 3600 : 0,
        requests_served: storageRunning ? Math.floor(Math.random() * 20) : 0,
        earnings_wei: storageRunning ? '300000000000000' : '0',
        last_error: null,
        health: storageRunning ? 'healthy' : 'stopped',
      },
      meets_requirements: false,
      requirement_issues: ['Insufficient storage space (need 500GB)'],
    },
    {
      metadata: {
        id: 'cron',
        name: 'Cron Executor',
        description:
          'Execute scheduled jobs for other users and earn execution fees',
        min_stake_eth: 0.05,
        estimated_earnings_per_hour_usd: 0.1,
        requirements: {
          min_cpu_cores: 1,
          min_memory_mb: 1024,
          min_storage_gb: 10,
          requires_gpu: false,
          min_gpu_memory_mb: null,
          requires_tee: false,
          min_bandwidth_mbps: null,
        },
        warnings: [],
        is_advanced: false,
      },
      status: {
        running: cronRunning,
        uptime_seconds: cronRunning ? Math.floor(Date.now() / 1000) % 3600 : 0,
        requests_served: cronRunning ? Math.floor(Math.random() * 30) : 0,
        earnings_wei: cronRunning ? '100000000000000' : '0',
        last_error: null,
        health: cronRunning ? 'healthy' : 'stopped',
      },
      meets_requirements: true,
      requirement_issues: [],
    },
    {
      metadata: {
        id: 'oracle',
        name: 'Oracle',
        description:
          'Provide price feeds and other oracle data to earn rewards',
        min_stake_eth: 1.0,
        estimated_earnings_per_hour_usd: 1.0,
        requirements: {
          min_cpu_cores: 2,
          min_memory_mb: 4096,
          min_storage_gb: 50,
          requires_gpu: false,
          min_gpu_memory_mb: null,
          requires_tee: true,
          min_bandwidth_mbps: null,
        },
        warnings: ['Requires TEE for secure attestation'],
        is_advanced: true,
      },
      status: {
        running: oracleRunning,
        uptime_seconds: oracleRunning ? Math.floor(Date.now() / 1000) % 3600 : 0,
        requests_served: oracleRunning ? Math.floor(Math.random() * 10) : 0,
        earnings_wei: oracleRunning ? '1000000000000000' : '0',
        last_error: null,
        health: oracleRunning ? 'healthy' : 'stopped',
      },
      meets_requirements: false,
      requirement_issues: ['TEE not available'],
    },
  ]
}

function getMockBots() {
  return [
    {
      metadata: {
        id: 'dex_arb',
        name: 'DEX Arbitrage',
        description:
          'Automated arbitrage between DEXes. Profits split 50/50 with treasury.',
        min_capital_eth: 0.5,
        treasury_split_percent: 50,
        risk_level: 'Medium',
        warnings: [
          'Capital at risk',
          'Gas costs can exceed profits in volatile markets',
        ],
      },
      status: {
        id: 'dex_arb',
        running: false,
        uptime_seconds: 0,
        opportunities_detected: 0,
        opportunities_executed: 0,
        opportunities_failed: 0,
        gross_profit_wei: '0',
        treasury_share_wei: '0',
        net_profit_wei: '0',
        last_opportunity: null,
        health: 'stopped',
      },
      config: {
        enabled: false,
        auto_start: false,
        min_profit_bps: 50,
        max_gas_gwei: 100,
        max_slippage_bps: 100,
        capital_allocation_wei: '0',
      },
    },
    {
      metadata: {
        id: 'liquidation',
        name: 'Liquidation Bot',
        description:
          'Monitor lending protocols for liquidation opportunities. Profits split 50/50.',
        min_capital_eth: 1.0,
        treasury_split_percent: 50,
        risk_level: 'High',
        warnings: [
          'High capital requirements',
          'Competitive market with MEV searchers',
        ],
      },
      status: {
        id: 'liquidation',
        running: false,
        uptime_seconds: 0,
        opportunities_detected: 0,
        opportunities_executed: 0,
        opportunities_failed: 0,
        gross_profit_wei: '0',
        treasury_share_wei: '0',
        net_profit_wei: '0',
        last_opportunity: null,
        health: 'stopped',
      },
      config: {
        enabled: false,
        auto_start: false,
        min_profit_bps: 100,
        max_gas_gwei: 200,
        max_slippage_bps: 200,
        capital_allocation_wei: '0',
      },
    },
  ]
}

function getMockProjectedEarnings() {
  return {
    hourly_usd: 0.8,
    daily_usd: 19.2,
    weekly_usd: 134.4,
    monthly_usd: 576,
    yearly_usd: 7008,
    breakdown: [
      {
        service_id: 'compute',
        service_name: 'Compute',
        enabled: false,
        hourly_usd: 0.5,
        monthly_usd: 360,
        factors: ['Based on 4 CPU cores', '50% average utilization assumed'],
      },
      {
        service_id: 'proxy',
        service_name: 'Residential Proxy',
        enabled: false,
        hourly_usd: 0.2,
        monthly_usd: 144,
        factors: ['Based on 100Mbps connection', 'Demand varies by region'],
      },
      {
        service_id: 'cron',
        service_name: 'Cron Executor',
        enabled: false,
        hourly_usd: 0.1,
        monthly_usd: 72,
        factors: ['Depends on network activity'],
      },
    ],
    assumptions: [
      'Estimates based on current network conditions',
      'Actual earnings may vary based on demand',
      '24/7 uptime assumed',
    ],
  }
}

// Mutable state for mock
let currentNetwork = {
  network: 'localnet',
  chain_id: 31337,
  rpc_url: 'http://localhost:6546',
  ws_url: 'ws://localhost:6547',
  explorer_url: 'http://localhost:4000',
}

const NETWORKS: Record<string, typeof currentNetwork> = {
  localnet: {
    network: 'localnet',
    chain_id: 31337,
    rpc_url: 'http://localhost:6546',
    ws_url: 'ws://localhost:6547',
    explorer_url: 'http://localhost:4000',
  },
  testnet: {
    network: 'testnet',
    chain_id: 420691,
    rpc_url: 'https://testnet-rpc.jejunetwork.org',
    ws_url: 'wss://testnet-ws.jejunetwork.org',
    explorer_url: 'https://testnet.jejuscan.io',
  },
  mainnet: {
    network: 'mainnet',
    chain_id: 420690,
    rpc_url: 'https://rpc.jejunetwork.org',
    ws_url: 'wss://ws.jejunetwork.org',
    explorer_url: 'https://jejuscan.io',
  },
}

function getMockConfig() {
  return {
    version: '1.0.0',
    network: currentNetwork,
    wallet: {
      wallet_type: 'embedded',
      address: null,
      agent_id: null,
    },
    earnings: {
      auto_claim: true,
      auto_claim_threshold_wei: '1000000000000000000',
      auto_claim_interval_hours: 24,
      auto_compound: false,
      auto_stake_earnings: false,
    },
    services: {},
    bots: {},
    start_minimized: false,
    start_on_boot: false,
    notifications_enabled: true,
  }
}

function getMockBanStatus() {
  return {
    is_banned: false,
    is_on_notice: false,
    is_permanently_banned: false,
    reason: null,
    appeal_deadline: null,
    appeal_status: null,
  }
}

function getMockStaking() {
  return {
    total_staked_wei: '0',
    total_staked_usd: 0,
    staked_by_service: [],
    pending_rewards_wei: '0',
    pending_rewards_usd: 0,
    can_unstake: false,
    unstake_cooldown_seconds: 0,
    auto_claim_enabled: true,
    next_auto_claim_timestamp: null,
  }
}

function getMockEarnings() {
  return {
    total_earnings_wei: '0',
    total_earnings_usd: 0,
    earnings_today_wei: '0',
    earnings_today_usd: 0,
    earnings_this_week_wei: '0',
    earnings_this_week_usd: 0,
    earnings_this_month_wei: '0',
    earnings_this_month_usd: 0,
    earnings_by_service: [],
    earnings_by_bot: [],
    avg_hourly_rate_usd: 0,
    projected_monthly_usd: 0,
  }
}

import type { JsonRecord, JsonValue } from '@jejunetwork/types'
import { isPlainObject } from '@jejunetwork/types'

/** Type guard for JSON records - delegates to shared implementation */
const isJsonRecord = (value: unknown): value is JsonRecord =>
  isPlainObject(value)

// Handle Tauri invoke calls
function handleInvoke(cmd: string, _args: JsonRecord): Promise<JsonValue> {
  switch (cmd) {
    case 'detect_hardware':
      return Promise.resolve(getMockHardware())
    case 'get_wallet_info':
      return Promise.resolve(getMockWallet())
    case 'get_balance':
      return getRealBalance()
    case 'get_agent_info':
      return Promise.resolve(null)
    case 'check_ban_status':
      return Promise.resolve(getMockBanStatus())
    case 'get_available_services':
      return Promise.resolve(getMockServices())
    case 'get_available_bots':
      return Promise.resolve(getMockBots())
    case 'get_earnings_summary':
      return Promise.resolve(getMockEarnings())
    case 'get_projected_earnings':
      return Promise.resolve(getMockProjectedEarnings())
    case 'get_staking_info':
      return Promise.resolve(getMockStaking())
    case 'get_config':
      return Promise.resolve(getMockConfig())
    case 'set_network': {
      const network = (_args as { network?: string }).network
      if (network && NETWORKS[network]) {
        currentNetwork = NETWORKS[network]
        console.log(`Mock: Switched to network ${network}`)
        return Promise.resolve(currentNetwork)
      }
      return Promise.reject(`Unknown network: ${network}`)
    }
    case 'import_wallet': {
      // Frontend sends { request: { private_key, mnemonic, password } }
      const request = (_args as { request?: { mnemonic?: string; private_key?: string } }).request
      const mnemonic = request?.mnemonic
      const privateKey = request?.private_key
      console.log(`Mock: import_wallet called with ${mnemonic ? 'mnemonic' : 'private_key'}: ${privateKey || mnemonic}`)
      // Set mock wallet state and return - include all required fields
      mockWallet = {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        wallet_type: 'embedded',
        agent_id: null,
        is_registered: false,
      }
      return Promise.resolve(mockWallet)
    }
    case 'start_service': {
      // Frontend sends { request: { service_id, stake_amount? } } or { service_id }
      const request = (_args as { request?: { service_id?: string } }).request
      const serviceId = request?.service_id || (_args as { service_id?: string }).service_id
      if (serviceId) {
        enabledServices.add(serviceId)
        console.log(`Mock: Started service ${serviceId}`)
        // Return success response
        return Promise.resolve({ success: true, service_id: serviceId, status: 'running' })
      }
      return Promise.resolve({ success: false, error: 'No service_id provided' })
    }
    case 'stop_service': {
      // Frontend sends { request: { service_id } } or { service_id }
      const request = (_args as { request?: { service_id?: string } }).request
      const serviceId = request?.service_id || (_args as { service_id?: string }).service_id
      if (serviceId) {
        enabledServices.delete(serviceId)
        console.log(`Mock: Stopped service ${serviceId}`)
        return Promise.resolve({ success: true, service_id: serviceId, status: 'stopped' })
      }
      return Promise.resolve({ success: false, error: 'No service_id provided' })
    }
    case 'create_wallet': {
      // Frontend sends { request: { password } }
      console.log('Mock: create_wallet called')
      mockWallet = {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        wallet_type: 'embedded',
        agent_id: null,
        is_registered: false,
      }
      return Promise.resolve(mockWallet)
    }
    case 'disconnect_wallet': {
      console.log('Mock: disconnect_wallet called')
      mockWallet = null
      return Promise.resolve({ success: true })
    }
    case 'stake': {
      const request = (_args as { request?: { service_id?: string; amount?: string } }).request
      console.log(`Mock: stake called for service=${request?.service_id} amount=${request?.amount}`)
      return Promise.resolve({ success: true, tx_hash: '0x' + '1'.repeat(64) })
    }
    case 'start_bot':
    case 'stop_bot':
    case 'unstake':
    case 'claim_rewards':
    case 'update_config':
      console.log(`Mock: ${cmd} called with args:`, JSON.stringify(_args))
      return Promise.resolve({ success: true })
    default:
      console.warn(`Unknown Tauri command: ${cmd}`)
      return Promise.resolve(null)
  }
}

// CORS headers for all responses
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
}

// Start API server for mock Tauri commands
function startApiServer(): void {
  Bun.serve({
    port: API_PORT,
    async fetch(req) {
      const url = new URL(req.url)

      // Handle preflight (OPTIONS) requests for all paths
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: CORS_HEADERS,
        })
      }

      // Handle invoke calls
      if (url.pathname.startsWith('/invoke/')) {
        const cmd = url.pathname.replace('/invoke/', '')
        let args: JsonRecord = {}

        if (req.method === 'POST') {
          const body = await req.text()
          if (body) {
            const parsed: unknown = JSON.parse(body)
            args = isJsonRecord(parsed) ? parsed : {}
          }
        }

        const result = await handleInvoke(cmd, args)

        return new Response(JSON.stringify(result), {
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        })
      }

      // Health check
      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
          },
        })
      }

      return new Response('Not Found', { status: 404, headers: CORS_HEADERS })
    },
  })

  console.log(`🔌 Mock API server running at `)
}

// Start frontend dev server
async function startDevServer(): Promise<void> {
  const indexHtml = await createIndexHtml()

  Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url)
      const path = url.pathname

      // Serve index.html for root and SPA routes
      if (path === '/' || (!path.includes('.') && !path.startsWith('/api'))) {
        return new Response(indexHtml, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      // Serve built files from dist/dev
      const distPath = join(process.cwd(), 'dist/dev', path)
      const distFile = Bun.file(distPath)
      if (await distFile.exists()) {
        const contentType = path.endsWith('.js')
          ? 'text/javascript'
          : path.endsWith('.css')
            ? 'text/css'
            : 'application/octet-stream'
        return new Response(distFile, {
          headers: { 'Content-Type': contentType },
        })
      }

      // Serve static files from current directory
      const staticPath = join(process.cwd(), path)
      const staticFile = Bun.file(staticPath)
      if (await staticFile.exists()) {
        return new Response(staticFile)
      }

      // Serve public assets
      const publicPath = join(process.cwd(), 'public', path)
      const publicFile = Bun.file(publicPath)
      if (await publicFile.exists()) {
        return new Response(publicFile)
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  console.log(`🌐 Frontend running at http://localhost:${PORT}`)
}

// Watch for file changes
function watchFiles(): void {
  const watchDirs = ['./web', './lib']

  for (const dir of watchDirs) {
    watch(dir, { recursive: true }, async (_event, filename) => {
      if (filename && (filename.endsWith('.tsx') || filename.endsWith('.ts'))) {
        console.log(`\n📝 ${filename} changed, rebuilding...`)
        await buildFrontend()
      }
    })
  }
}

// Main
async function main(): Promise<void> {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   Network Node - Dev Mode                  ║
║                                                           ║
║  This is development mode with mock Tauri APIs.           ║
║  For full Tauri desktop app: bun run dev:app              ║
╚═══════════════════════════════════════════════════════════╝
`)

  // Initial build
  if (!(await buildFrontend())) {
    console.error('Build failed, exiting.')
    process.exit(1)
  }

  // Start servers
  startApiServer()
  await startDevServer()

  // Watch for changes
  watchFiles()

  console.log(`
✅ Development server ready.

   Frontend: http://localhost:${PORT}
   Mock API: 

   Press Ctrl+C to stop.
`)
}

main()
