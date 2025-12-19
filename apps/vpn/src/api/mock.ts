/**
 * Mock Tauri API for web development without Rust backend
 */

interface VPNNode {
  node_id: string;
  operator: string;
  country_code: string;
  region: string;
  endpoint: string;
  wireguard_pubkey: string;
  latency_ms: number;
  load: number;
  reputation: number;
  capabilities: {
    supports_wireguard: boolean;
    supports_socks5: boolean;
    supports_http: boolean;
    serves_cdn: boolean;
    is_vpn_exit: boolean;
  };
}

interface VPNConnection {
  connection_id: string;
  status: string;
  node: VPNNode;
  connected_at: number | null;
  local_ip: string | null;
  public_ip: string | null;
  bytes_up: number;
  bytes_down: number;
  latency_ms: number;
}

interface VPNStatus {
  status: 'Disconnected' | 'Connecting' | 'Connected' | 'Reconnecting' | 'Error';
  connection: VPNConnection | null;
}

interface ContributionStatus {
  enabled: boolean;
  auto_contribution: boolean;
  earning_mode: boolean;
  bandwidth_share: number;
  sessions_hosted: number;
  bytes_served: number;
  tokens_earned: string;
}

interface ContributionStats {
  uptime_hours: number;
  total_bytes_served: number;
  total_tokens_earned: string;
  current_rank: number;
  sessions_today: number;
  bytes_today: number;
}

interface ConnectionStats {
  bytes_up: number;
  bytes_down: number;
  packets_up: number;
  packets_down: number;
  connected_seconds: number;
  latency_ms: number;
}

interface Settings {
  kill_switch: boolean;
  auto_connect: boolean;
  auto_start: boolean;
  minimize_to_tray: boolean;
  protocol: string;
  dns: string[];
}

interface BandwidthState {
  adaptive_enabled: boolean;
  current_share: number;
  user_active: boolean;
  idle_seconds: number;
}

interface DWSState {
  enabled: boolean;
  cache_size_bytes: number;
  items_cached: number;
  bytes_served: number;
  requests_served: number;
}

// Mock state
let mockState = {
  vpnStatus: 'Disconnected' as VPNStatus['status'],
  connection: null as VPNConnection | null,
  selectedNodeId: null as string | null,
  connectedAt: null as number | null,
  bytesUp: 0,
  bytesDown: 0,
  contributionEnabled: false,
  autoContribution: true,
  earningMode: false,
  adaptiveMode: true,
  dwsEnabled: true,
  autoStart: false,
};

// Mock nodes
const mockNodes: VPNNode[] = [
  {
    node_id: '0x1234567890abcdef1234567890abcdef12345678',
    operator: '0xabcdef1234567890abcdef1234567890abcdef12',
    country_code: 'NL',
    region: 'eu-west-1',
    endpoint: 'nl1.vpn.jeju.network:51820',
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
    endpoint: 'us1.vpn.jeju.network:51820',
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
    endpoint: 'jp1.vpn.jeju.network:51820',
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
    endpoint: 'de1.vpn.jeju.network:51820',
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
];

// Simulate traffic when connected
let trafficInterval: ReturnType<typeof setInterval> | null = null;

function startTrafficSimulation() {
  if (trafficInterval) return;
  trafficInterval = setInterval(() => {
    if (mockState.vpnStatus === 'Connected') {
      mockState.bytesUp += Math.floor(Math.random() * 50000) + 10000;
      mockState.bytesDown += Math.floor(Math.random() * 200000) + 50000;
    }
  }, 1000);
}

function stopTrafficSimulation() {
  if (trafficInterval) {
    clearInterval(trafficInterval);
    trafficInterval = null;
  }
}

// Mock command handlers
const handlers: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
  get_status: async () => {
    const status: VPNStatus = {
      status: mockState.vpnStatus,
      connection: mockState.connection,
    };
    return status;
  },

  get_nodes: async (args: { countryCode?: string | null }) => {
    if (args.countryCode) {
      return mockNodes.filter(n => n.country_code === args.countryCode);
    }
    return mockNodes;
  },

  select_node: async (args: { nodeId: string }) => {
    mockState.selectedNodeId = args.nodeId;
    return null;
  },

  connect: async (args: { nodeId?: string | null }) => {
    mockState.vpnStatus = 'Connecting';
    
    await new Promise(r => setTimeout(r, 1500));
    
    const nodeId = args.nodeId ?? mockState.selectedNodeId ?? mockNodes[0].node_id;
    const node = mockNodes.find(n => n.node_id === nodeId) ?? mockNodes[0];
    
    mockState.vpnStatus = 'Connected';
    mockState.connectedAt = Date.now();
    mockState.bytesUp = 0;
    mockState.bytesDown = 0;
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
    };
    
    startTrafficSimulation();
    return mockState.connection;
  },

  disconnect: async () => {
    mockState.vpnStatus = 'Disconnected';
    mockState.connection = null;
    mockState.connectedAt = null;
    stopTrafficSimulation();
    return null;
  },

  get_connection_stats: async () => {
    if (!mockState.connection) return null;
    
    const stats: ConnectionStats = {
      bytes_up: mockState.bytesUp,
      bytes_down: mockState.bytesDown,
      packets_up: Math.floor(mockState.bytesUp / 1500),
      packets_down: Math.floor(mockState.bytesDown / 1500),
      connected_seconds: mockState.connectedAt 
        ? Math.floor((Date.now() - mockState.connectedAt) / 1000)
        : 0,
      latency_ms: mockState.connection.latency_ms + Math.floor(Math.random() * 10) - 5,
    };
    return stats;
  },

  get_contribution_status: async () => {
    const status: ContributionStatus = {
      enabled: mockState.contributionEnabled,
      auto_contribution: mockState.autoContribution,
      earning_mode: mockState.earningMode,
      bandwidth_share: mockState.adaptiveMode ? 40 : 10,
      sessions_hosted: 12,
      bytes_served: 1024 * 1024 * 1024 * 2.5,
      tokens_earned: '0.0523',
    };
    return status;
  },

  set_contribution_settings: async (args: {
    enabled?: boolean;
    auto_contribution?: boolean;
    earning_mode?: boolean;
  }) => {
    if (args.enabled !== undefined) mockState.contributionEnabled = args.enabled;
    if (args.auto_contribution !== undefined) mockState.autoContribution = args.auto_contribution;
    if (args.earning_mode !== undefined) mockState.earningMode = args.earning_mode;
    return null;
  },

  get_contribution_stats: async () => {
    const stats: ContributionStats = {
      uptime_hours: 168,
      total_bytes_served: 1024 * 1024 * 1024 * 45,
      total_tokens_earned: '12.456',
      current_rank: 1234,
      sessions_today: 5,
      bytes_today: 1024 * 1024 * 512,
    };
    return stats;
  },

  get_settings: async () => {
    const settings: Settings = {
      kill_switch: true,
      auto_connect: false,
      auto_start: mockState.autoStart,
      minimize_to_tray: true,
      protocol: 'wireguard',
      dns: ['1.1.1.1', '8.8.8.8'],
    };
    return settings;
  },

  update_settings: async (args: { key: string; value: boolean }) => {
    console.log('Settings update:', args.key, args.value);
    return null;
  },

  get_bandwidth_state: async () => {
    const state: BandwidthState = {
      adaptive_enabled: mockState.adaptiveMode,
      current_share: mockState.adaptiveMode ? 40 : 10,
      user_active: true,
      idle_seconds: 120,
    };
    return state;
  },

  set_adaptive_mode: async (args: { enabled: boolean }) => {
    mockState.adaptiveMode = args.enabled;
    return null;
  },

  get_dws_state: async () => {
    const state: DWSState = {
      enabled: mockState.dwsEnabled,
      cache_size_bytes: 1024 * 1024 * 1024 * 2,
      items_cached: 1523,
      bytes_served: 1024 * 1024 * 1024 * 8,
      requests_served: 45123,
    };
    return state;
  },

  set_dws_enabled: async (args: { enabled: boolean }) => {
    mockState.dwsEnabled = args.enabled;
    return null;
  },

  login_with_wallet: async (args: { address: string; signature: string }) => {
    return {
      address: args.address,
      session_id: crypto.randomUUID(),
      expires_at: Date.now() + 86400000,
    };
  },

  logout: async () => {
    return null;
  },

  get_session: async () => {
    return null;
  },

  get_autostart_enabled: async () => {
    return mockState.autoStart;
  },

  set_autostart_enabled: async (args: { enabled: boolean }) => {
    mockState.autoStart = args.enabled;
    return null;
  },

  toggle_autostart: async () => {
    mockState.autoStart = !mockState.autoStart;
    return mockState.autoStart;
  },
};

/**
 * Mock invoke function for web development
 */
export async function mockInvoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const handler = handlers[cmd];
  if (!handler) {
    console.warn(`Mock: Unknown command "${cmd}"`);
    throw new Error(`Unknown command: ${cmd}`);
  }
  
  // Simulate network delay
  await new Promise(r => setTimeout(r, 50 + Math.random() * 100));
  
  return handler(args) as Promise<T>;
}

/**
 * Check if running in Tauri
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI__' in window;
}

