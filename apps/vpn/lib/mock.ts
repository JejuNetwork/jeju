import { z } from 'zod'
import type { VPNConnection, VPNNode, VPNStatus } from './schemas'

const GetNodesInputSchema = z
  .object({
    countryCode: z.string().length(2).nullable().optional(),
  })
  .strict()

const SelectNodeInputSchema = z
  .object({
    nodeId: z.string().min(1, 'Node ID required'),
  })
  .strict()

const ConnectInputSchema = z
  .object({
    nodeId: z.string().min(1).nullable().optional(),
  })
  .strict()

const SetContributionSettingsInputSchema = z
  .object({
    settings: z
      .object({
        enabled: z.boolean().optional(),
        earning_mode: z.boolean().optional(),
        max_bandwidth_percent: z.number().min(0).max(100).optional(),
        share_cdn: z.boolean().optional(),
        share_vpn_relay: z.boolean().optional(),
        schedule_enabled: z.boolean().optional(),
        schedule_start: z.string().optional(),
        schedule_end: z.string().optional(),
        earning_bandwidth_percent: z.number().min(0).max(100).optional(),
      })
      .strict(),
  })
  .strict()

const UpdateSettingsInputSchema = z
  .object({
    key: z.string().min(1, 'Setting key required'),
    value: z.boolean(),
  })
  .strict()

const SetAdaptiveModeInputSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()

const SetDwsEnabledInputSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()

const LoginInputSchema = z
  .object({
    address: z.string().min(1, 'Address required'),
    signature: z.string().min(1, 'Signature required'),
  })
  .strict()

const SetAutostartInputSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()

interface MockState {
  vpnStatus: VPNStatus['status']
  connection: VPNConnection | null
  selectedNodeId: string | null
  connectedAt: number | null
  bytesUp: number
  bytesDown: number
  contributionEnabled: boolean
  autoContribution: boolean
  earningMode: boolean
  adaptiveMode: boolean
  dwsEnabled: boolean
  autoStart: boolean
}

const mockState: MockState = {
  vpnStatus: 'Disconnected',
  connection: null,
  selectedNodeId: null,
  connectedAt: null,
  bytesUp: 0,
  bytesDown: 0,
  contributionEnabled: false,
  autoContribution: true,
  earningMode: false,
  adaptiveMode: true,
  dwsEnabled: true,
  autoStart: false,
}

const mockResidentialProxyState = {
  status: {
    is_registered: false,
    is_active: false,
    stake_amount: '0',
    total_bytes_shared: '0',
    total_sessions: 0,
    total_earnings: '0',
    pending_rewards: '0',
    current_connections: 0,
    uptime_score: 0,
    success_rate: 0,
    coordinator_connected: false,
  },
  settings: {
    enabled: false,
    node_type: 'residential' as const,
    max_bandwidth_mbps: 100,
    max_concurrent_connections: 50,
    allowed_ports: [80, 443, 8080, 8443],
    blocked_domains: [] as string[],
    schedule_enabled: false,
  },
  stats: {
    bytes_shared_today: '0',
    bytes_shared_week: '0',
    bytes_shared_month: '0',
    sessions_today: 0,
    sessions_week: 0,
    avg_session_duration_ms: 0,
    peak_bandwidth_mbps: 0,
    earnings_today: '0',
    earnings_week: '0',
    earnings_month: '0',
  },
}

const mockNodes: VPNNode[] = [
  {
    node_id: '0x1234567890abcdef1234567890abcdef12345678',
    operator: '0xabcdef1234567890abcdef1234567890abcdef12',
    country_code: 'NL',
    region: 'eu-west-1',
    endpoint: 'nl1.vpn.jejunetwork.org:51820',
    wireguard_pubkey: 'aGVsbG8gd29ybGQgdGhpcyBpcyBhIHRlc3Qga2V5',
    latency_ms: 25,
    load: 30,
    reputation: 95,
    capabilities: {
      supports_wireguard: true,
      supports_socks5: true,
      supports_http: true,
      serves_cdn: true,
      is_vpn_exit: true,
    },
  },
  {
    node_id: '0xabcdef1234567890abcdef1234567890abcdef12',
    operator: '0x1234567890abcdef1234567890abcdef12345678',
    country_code: 'US',
    region: 'us-east-1',
    endpoint: 'us1.vpn.jejunetwork.org:51820',
    wireguard_pubkey: 'YW5vdGhlciB0ZXN0IGtleSBmb3IgdGVzdGluZw==',
    latency_ms: 80,
    load: 45,
    reputation: 90,
    capabilities: {
      supports_wireguard: true,
      supports_socks5: true,
      supports_http: true,
      serves_cdn: true,
      is_vpn_exit: true,
    },
  },
  {
    node_id: '0x9876543210fedcba9876543210fedcba98765432',
    operator: '0xfedcba9876543210fedcba9876543210fedcba98',
    country_code: 'JP',
    region: 'ap-northeast-1',
    endpoint: 'jp1.vpn.jejunetwork.org:51820',
    wireguard_pubkey: 'amFwYW4gdGVzdCBrZXkgZm9yIHRlc3RpbmcgdnBu',
    latency_ms: 150,
    load: 20,
    reputation: 98,
    capabilities: {
      supports_wireguard: true,
      supports_socks5: true,
      supports_http: true,
      serves_cdn: true,
      is_vpn_exit: true,
    },
  },
  {
    node_id: '0x5555555555555555555555555555555555555555',
    operator: '0x6666666666666666666666666666666666666666',
    country_code: 'DE',
    region: 'eu-central-1',
    endpoint: 'de1.vpn.jejunetwork.org:51820',
    wireguard_pubkey: 'Z2VybWFueSB0ZXN0IGtleSBmb3IgdGVzdGluZw==',
    latency_ms: 35,
    load: 55,
    reputation: 92,
    capabilities: {
      supports_wireguard: true,
      supports_socks5: true,
      supports_http: true,
      serves_cdn: true,
      is_vpn_exit: true,
    },
  },
]

let trafficInterval: ReturnType<typeof setInterval> | null = null

function startTrafficSimulation() {
  if (trafficInterval) return
  trafficInterval = setInterval(() => {
    if (mockState.vpnStatus === 'Connected') {
      mockState.bytesUp += Math.floor(Math.random() * 50000) + 10000
      mockState.bytesDown += Math.floor(Math.random() * 200000) + 50000
    }
  }, 1000)
}

function stopTrafficSimulation() {
  if (trafficInterval) {
    clearInterval(trafficInterval)
    trafficInterval = null
  }
}

type HandlerResult =
  | VPNStatus
  | VPNNode[]
  | VPNConnection
  | null
  | boolean
  | string
  | {
      bytes_up: number
      bytes_down: number
      packets_up: number
      packets_down: number
      connected_seconds: number
      latency_ms: number
    }
  | {
      vpn_bytes_used: number
      bytes_contributed: number
      contribution_cap: number
      quota_remaining: number
      is_contributing: boolean
      is_paused: boolean
      cdn_bytes_served: number
      relay_bytes_served: number
      period_start: number
      period_end: number
    }
  | {
      enabled: boolean
      max_bandwidth_percent: number
      share_cdn: boolean
      share_vpn_relay: boolean
      earning_mode: boolean
      earning_bandwidth_percent: number
      schedule_enabled: boolean
      schedule_start: string
      schedule_end: string
    }
  | {
      total_bytes_contributed: number
      total_vpn_bytes_used: number
      contribution_ratio: number
      tokens_earned: number
      tokens_pending: number
      users_helped: number
      cdn_requests_served: number
      uptime_seconds: number
    }
  | Record<string, never>
  | {
      total_bandwidth_mbps: number
      user_usage_mbps: number
      available_mbps: number
      contribution_mbps: number
      contribution_percent: number
      is_user_idle: boolean
      idle_seconds: number
      adaptive_enabled: boolean
    }
  | {
      active: boolean
      cache_used_mb: number
      bytes_served: number
      requests_served: number
      cached_cids: number
      earnings_wei: number
    }
  | { address: string; session_id: string; expires_at: number }

type MockHandler = (args: Record<string, unknown>) => Promise<HandlerResult>

const handlers: Record<string, MockHandler> = {
  get_status: async (): Promise<VPNStatus> => {
    return {
      status: mockState.vpnStatus,
      connection: mockState.connection,
    }
  },

  get_nodes: async (args: Record<string, unknown>): Promise<VPNNode[]> => {
    const validated = GetNodesInputSchema.parse(args)
    if (validated.countryCode) {
      return mockNodes.filter((n) => n.country_code === validated.countryCode)
    }
    return mockNodes
  },

  select_node: async (args: Record<string, unknown>): Promise<null> => {
    const validated = SelectNodeInputSchema.parse(args)
    mockState.selectedNodeId = validated.nodeId
    return null
  },

  connect: async (args: Record<string, unknown>): Promise<VPNConnection> => {
    const validated = ConnectInputSchema.parse(args)
    mockState.vpnStatus = 'Connecting'

    await new Promise((r) => setTimeout(r, 1500))

    const requestedNodeId = validated.nodeId ?? null
    const targetNodeId =
      requestedNodeId ?? mockState.selectedNodeId ?? mockNodes[0].node_id

    if (!targetNodeId) {
      throw new Error('No nodes available')
    }

    const node = mockNodes.find((n) => n.node_id === targetNodeId)
    if (!node) {
      if (requestedNodeId) {
        throw new Error(`Node not found: ${requestedNodeId}`)
      }
      throw new Error('No nodes available')
    }

    mockState.vpnStatus = 'Connected'
    mockState.connectedAt = Date.now()
    mockState.bytesUp = 0
    mockState.bytesDown = 0
    mockState.connection = {
      connection_id: crypto.randomUUID(),
      status: 'Connected',
      node,
      connected_at: Math.floor(Date.now() / 1000),
      local_ip: '10.0.0.2',
      public_ip: '185.234.67.89',
      bytes_up: 0,
      bytes_down: 0,
      latency_ms: node.latency_ms,
    }

    startTrafficSimulation()
    return mockState.connection
  },

  disconnect: async (): Promise<null> => {
    mockState.vpnStatus = 'Disconnected'
    mockState.connection = null
    mockState.connectedAt = null
    stopTrafficSimulation()
    return null
  },

  get_connection_stats: async () => {
    if (!mockState.connection) return null

    return {
      bytes_up: mockState.bytesUp,
      bytes_down: mockState.bytesDown,
      packets_up: Math.floor(mockState.bytesUp / 1500),
      packets_down: Math.floor(mockState.bytesDown / 1500),
      connected_seconds: mockState.connectedAt
        ? Math.floor((Date.now() - mockState.connectedAt) / 1000)
        : 0,
      latency_ms:
        mockState.connection.latency_ms + Math.floor(Math.random() * 10) - 5,
    }
  },

  get_contribution_status: async () => {
    const now = Date.now()
    return {
      vpn_bytes_used: 1024 * 1024 * 1024 * 5,
      bytes_contributed: 1024 * 1024 * 1024 * 10,
      contribution_cap: 1024 * 1024 * 1024 * 15,
      quota_remaining: 1024 * 1024 * 1024 * 5,
      is_contributing: mockState.contributionEnabled,
      is_paused: false,
      cdn_bytes_served: 1024 * 1024 * 1024 * 8,
      relay_bytes_served: 1024 * 1024 * 1024 * 2,
      period_start: now - 7 * 24 * 60 * 60 * 1000,
      period_end: now + 23 * 24 * 60 * 60 * 1000,
    }
  },

  get_contribution_settings: async () => {
    return {
      enabled: mockState.contributionEnabled,
      max_bandwidth_percent: mockState.adaptiveMode ? 40 : 10,
      share_cdn: true,
      share_vpn_relay: true,
      earning_mode: mockState.earningMode,
      earning_bandwidth_percent: 50,
      schedule_enabled: false,
      schedule_start: '00:00',
      schedule_end: '23:59',
    }
  },

  set_contribution_settings: async (
    args: Record<string, unknown>,
  ): Promise<null> => {
    const validated = SetContributionSettingsInputSchema.parse(args)

    if (validated.settings.enabled !== undefined) {
      mockState.contributionEnabled = validated.settings.enabled
    }
    if (validated.settings.earning_mode !== undefined) {
      mockState.earningMode = validated.settings.earning_mode
    }
    return null
  },

  get_contribution_stats: async () => {
    return {
      total_bytes_contributed: 1024 * 1024 * 1024 * 45,
      total_vpn_bytes_used: 1024 * 1024 * 1024 * 15,
      contribution_ratio: 3.0,
      tokens_earned: 12.456,
      tokens_pending: 2.34,
      users_helped: 1234,
      cdn_requests_served: 45123,
      uptime_seconds: 168 * 60 * 60,
    }
  },

  get_settings: async () => {
    return {}
  },

  update_settings: async (args: Record<string, unknown>): Promise<null> => {
    UpdateSettingsInputSchema.parse(args)
    return null
  },

  get_bandwidth_state: async () => {
    return {
      total_bandwidth_mbps: 100,
      user_usage_mbps: mockState.adaptiveMode ? 60 : 90,
      available_mbps: mockState.adaptiveMode ? 40 : 10,
      contribution_mbps: mockState.adaptiveMode ? 40 : 10,
      contribution_percent: mockState.adaptiveMode ? 40 : 10,
      is_user_idle: !mockState.adaptiveMode,
      idle_seconds: mockState.adaptiveMode ? 300 : 0,
      adaptive_enabled: mockState.adaptiveMode,
    }
  },

  set_adaptive_mode: async (args: Record<string, unknown>): Promise<null> => {
    const validated = SetAdaptiveModeInputSchema.parse(args)
    mockState.adaptiveMode = validated.enabled
    return null
  },

  get_dws_state: async () => {
    return {
      active: mockState.dwsEnabled,
      cache_used_mb: 2048,
      bytes_served: 1024 * 1024 * 1024 * 8,
      requests_served: 45123,
      cached_cids: 1523,
      earnings_wei: Number(BigInt('12345678900000000000')),
    }
  },

  set_dws_enabled: async (args: Record<string, unknown>): Promise<null> => {
    const validated = SetDwsEnabledInputSchema.parse(args)
    mockState.dwsEnabled = validated.enabled
    return null
  },

  login_with_wallet: async (args: Record<string, unknown>) => {
    const validated = LoginInputSchema.parse(args)
    return {
      address: validated.address,
      session_id: crypto.randomUUID(),
      expires_at: Date.now() + 86400000,
    }
  },

  logout: async (): Promise<null> => {
    return null
  },

  get_session: async (): Promise<null> => {
    return null
  },

  get_autostart_enabled: async (): Promise<boolean> => {
    return mockState.autoStart
  },

  set_autostart_enabled: async (
    args: Record<string, unknown>,
  ): Promise<null> => {
    const validated = SetAutostartInputSchema.parse(args)
    mockState.autoStart = validated.enabled
    return null
  },

  toggle_autostart: async (): Promise<boolean> => {
    mockState.autoStart = !mockState.autoStart
    return mockState.autoStart
  },

  get_public_key: async (): Promise<string> => {
    return 'dGVzdC1wdWJsaWMta2V5LWZvci1kZXZlbG9wbWVudA=='
  },

  get_residential_proxy_status: async () => {
    return mockResidentialProxyState.status
  },

  get_residential_proxy_settings: async () => {
    return mockResidentialProxyState.settings
  },

  get_residential_proxy_stats: async () => {
    return mockResidentialProxyState.stats
  },

  set_residential_proxy_settings: async (
    args: Record<string, unknown>,
  ): Promise<null> => {
    const settings = args.settings as Partial<
      typeof mockResidentialProxyState.settings
    >
    mockResidentialProxyState.settings = {
      ...mockResidentialProxyState.settings,
      ...settings,
    }
    return null
  },

  register_residential_proxy: async (args: Record<string, unknown>) => {
    const stakeAmount = args.stake_amount as string
    mockResidentialProxyState.status = {
      ...mockResidentialProxyState.status,
      is_registered: true,
      stake_amount: stakeAmount,
    }
    return {
      success: true,
      node_address: '0x1234...',
      stake_amount: stakeAmount,
    }
  },

  claim_residential_proxy_rewards: async () => {
    const pending = mockResidentialProxyState.status.pending_rewards
    mockResidentialProxyState.status = {
      ...mockResidentialProxyState.status,
      pending_rewards: '0',
      total_earnings: (
        BigInt(mockResidentialProxyState.status.total_earnings) +
        BigInt(pending)
      ).toString(),
    }
    return { success: true, claimed_amount: pending }
  },
}

export async function mockInvoke<T>(
  cmd: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const handler = handlers[cmd]
  if (!handler) {
    throw new Error(`Unknown command: ${cmd}`)
  }

  await new Promise((r) => setTimeout(r, 50 + Math.random() * 100))

  const result = await handler(args)
  return result as T
}

export function isTauri(): boolean {
  return (
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
  )
}
