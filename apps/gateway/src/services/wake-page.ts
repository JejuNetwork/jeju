import { type Address, namehash } from 'viem';

export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unfunded' | 'unknown';

export interface WakePageData {
  jnsName: string;
  appName: string;
  description: string;
  owner: Address;
  vaultAddress: Address;
  currentBalance: bigint;
  minRequired: bigint;
  fundingNeeded: bigint;
  lastHealthy: number;
  agentId?: bigint;
}

export function generateWakePage(data: WakePageData): string {
  const fundingNeeded = data.minRequired - data.currentBalance;
  const fundingNeededEth = formatWei(fundingNeeded > 0n ? fundingNeeded : 0n);
  const currentBalanceEth = formatWei(data.currentBalance);
  const minRequiredEth = formatWei(data.minRequired);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(data.appName)} - Needs Funding | Jeju Network</title>
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🍊</text></svg>">
  <style>
    :root {
      --jeju-orange: #FF6B35;
      --jeju-orange-light: #FF8C5A;
      --jeju-orange-dark: #E55A2B;
      --jeju-dark: #1A1A2E;
      --jeju-darker: #0F0F1A;
      --jeju-gray: #2D2D44;
      --jeju-light: #F5F5F7;
      --jeju-success: #34C759;
      --jeju-warning: #FF9500;
      --jeju-error: #FF3B30;
    }
    
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: linear-gradient(135deg, var(--jeju-darker) 0%, var(--jeju-dark) 100%);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--jeju-light);
      padding: 20px;
    }
    
    .container {
      max-width: 480px;
      width: 100%;
      text-align: center;
    }
    
    .logo {
      font-size: 64px;
      margin-bottom: 16px;
      filter: drop-shadow(0 4px 8px rgba(255, 107, 53, 0.3));
    }
    
    .brand {
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--jeju-orange);
      margin-bottom: 32px;
    }
    
    .card {
      background: var(--jeju-gray);
      border-radius: 24px;
      padding: 32px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .status-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    
    h1 {
      font-size: 24px;
      font-weight: 700;
      margin-bottom: 8px;
    }
    
    .app-name {
      color: var(--jeju-orange);
    }
    
    .description {
      color: rgba(255, 255, 255, 0.7);
      font-size: 14px;
      margin-bottom: 24px;
    }
    
    .funding-status {
      background: var(--jeju-darker);
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 24px;
    }
    
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      font-size: 14px;
    }
    
    .status-row:not(:last-child) {
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .status-label {
      color: rgba(255, 255, 255, 0.6);
    }
    
    .status-value {
      font-weight: 600;
      font-family: 'SF Mono', Monaco, monospace;
    }
    
    .status-value.needed {
      color: var(--jeju-warning);
    }
    
    .status-value.current {
      color: var(--jeju-error);
    }
    
    .status-value.required {
      color: var(--jeju-light);
    }
    
    .progress-bar {
      height: 8px;
      background: var(--jeju-darker);
      border-radius: 4px;
      overflow: hidden;
      margin: 16px 0;
    }
    
    .progress-fill {
      height: 100%;
      background: linear-gradient(90deg, var(--jeju-orange) 0%, var(--jeju-orange-light) 100%);
      border-radius: 4px;
      transition: width 0.3s ease;
    }
    
    .fund-button {
      display: block;
      width: 100%;
      padding: 16px 24px;
      background: linear-gradient(135deg, var(--jeju-orange) 0%, var(--jeju-orange-dark) 100%);
      color: white;
      font-size: 16px;
      font-weight: 600;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: transform 0.2s, box-shadow 0.2s;
      text-decoration: none;
    }
    
    .fund-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 24px rgba(255, 107, 53, 0.4);
    }
    
    .fund-button:active {
      transform: translateY(0);
    }
    
    .vault-address {
      margin-top: 16px;
      padding: 12px;
      background: var(--jeju-darker);
      border-radius: 8px;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 12px;
      word-break: break-all;
      color: rgba(255, 255, 255, 0.6);
    }
    
    .vault-address span {
      color: var(--jeju-orange);
    }
    
    .info-text {
      margin-top: 24px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      line-height: 1.6;
    }
    
    .info-text a {
      color: var(--jeju-orange);
      text-decoration: none;
    }
    
    .info-text a:hover {
      text-decoration: underline;
    }
    
    .last-healthy {
      margin-top: 16px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.4);
    }
    
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    
    .checking {
      animation: pulse 2s infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🍊</div>
    <div class="brand">Jeju Network</div>
    
    <div class="card">
      <div class="status-icon">💤</div>
      <h1><span class="app-name">${escapeHtml(data.appName)}</span> is Sleeping</h1>
      <p class="description">${escapeHtml(data.description || 'This decentralized app needs funding to wake up.')}</p>
      
      <div class="funding-status">
        <div class="status-row">
          <span class="status-label">Current Balance</span>
          <span class="status-value current">${currentBalanceEth} ETH</span>
        </div>
        <div class="status-row">
          <span class="status-label">Minimum Required</span>
          <span class="status-value required">${minRequiredEth} ETH</span>
        </div>
        <div class="status-row">
          <span class="status-label">Funding Needed</span>
          <span class="status-value needed">${fundingNeededEth} ETH</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" style="width: ${calculateProgress(data.currentBalance, data.minRequired)}%"></div>
        </div>
      </div>
      
      <a href="https://gateway.jeju.network/fund/${data.vaultAddress}" class="fund-button" id="fundButton">
        ⚡ Fund & Wake Up
      </a>
      
      <div class="vault-address">
        <span>Vault:</span> ${data.vaultAddress}
      </div>
      
      <p class="info-text">
        This app runs on the <a href="https://jeju.network" target="_blank">Jeju Network</a> - 
        a decentralized compute platform. Once funded, the app will automatically restart 
        and become available at <strong>${escapeHtml(data.jnsName)}</strong>.
      </p>
      
      ${data.lastHealthy > 0 ? `
      <p class="last-healthy">
        Last healthy: ${formatTimeAgo(data.lastHealthy)}
      </p>
      ` : ''}
    </div>
  </div>
  
  <script>
    // Auto-refresh to check if funded
    let checkCount = 0;
    const maxChecks = 60; // 5 minutes of checking
    
    async function checkFunding() {
      if (checkCount >= maxChecks) return;
      checkCount++;
      
      try {
        const response = await fetch('/api/keepalive/status/${data.jnsName}');
        const data = await response.json();
        
        if (data.funded) {
          // Reload the page to show the app
          window.location.reload();
        }
      } catch (e) {
        console.error('Check failed:', e);
      }
      
      setTimeout(checkFunding, 5000);
    }
    
    // Start checking after initial load
    setTimeout(checkFunding, 5000);
  </script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatWei(wei: bigint): string {
  const eth = Number(wei) / 1e18;
  if (eth < 0.0001) return '< 0.0001';
  if (eth < 0.01) return eth.toFixed(4);
  if (eth < 1) return eth.toFixed(3);
  return eth.toFixed(2);
}

function calculateProgress(current: bigint, required: bigint): number {
  if (required === 0n) return 100;
  const progress = Number((current * 100n) / required);
  return Math.min(100, Math.max(0, progress));
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

export interface WakePageCheck {
  shouldShowWakePage: boolean;
  data?: WakePageData;
}

const KEEPALIVE_ABI = [
  {
    name: 'getStatusByJNS',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'jnsNode', type: 'bytes32' }],
    outputs: [
      { name: 'exists', type: 'bool' },
      { name: 'funded', type: 'bool' },
      { name: 'status', type: 'uint8' },
      { name: 'keepaliveId', type: 'bytes32' },
    ],
  },
  {
    name: 'keepalives',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'keepaliveId', type: 'bytes32' }],
    outputs: [
      { name: 'keepaliveId', type: 'bytes32' },
      { name: 'owner', type: 'address' },
      { name: 'jnsNode', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'vaultAddress', type: 'address' },
      { name: 'globalMinBalance', type: 'uint256' },
      { name: 'checkInterval', type: 'uint256' },
      { name: 'autoFundAmount', type: 'uint256' },
      { name: 'autoFundEnabled', type: 'bool' },
      { name: 'active', type: 'bool' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'lastCheckAt', type: 'uint256' },
      { name: 'lastStatus', type: 'uint8' },
    ],
  },
  {
    name: 'lastHealthCheck',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'keepaliveId', type: 'bytes32' }],
    outputs: [
      { name: 'keepaliveId', type: 'bytes32' },
      { name: 'status', type: 'uint8' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'balance', type: 'uint256' },
      { name: 'healthyResources', type: 'uint8' },
      { name: 'totalResources', type: 'uint8' },
    ],
  },
] as const;

type PublicClient = {
  readContract: (args: {
    address: Address;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }) => Promise<unknown>;
};

export async function checkWakePage(
  jnsName: string,
  keepaliveRegistryAddress: Address,
  publicClient: PublicClient
): Promise<WakePageCheck> {
  try {
    const jnsNode = namehash(jnsName);

    // Fetch status by JNS
    const statusResult = await publicClient.readContract({
      address: keepaliveRegistryAddress,
      abi: KEEPALIVE_ABI,
      functionName: 'getStatusByJNS',
      args: [jnsNode],
    }) as [boolean, boolean, number, `0x${string}`];

    const [exists, funded, , keepaliveId] = statusResult;

    if (!exists || funded) {
      return { shouldShowWakePage: false };
    }

    // Fetch full keepalive config
    const keepalive = await publicClient.readContract({
      address: keepaliveRegistryAddress,
      abi: KEEPALIVE_ABI,
      functionName: 'keepalives',
      args: [keepaliveId],
    }) as [
      `0x${string}`, Address, `0x${string}`, bigint, Address,
      bigint, bigint, bigint, boolean, boolean, bigint, bigint, number
    ];

    const owner = keepalive[1];
    const vaultAddress = keepalive[4];
    const minRequired = keepalive[5];
    const lastCheckAt = keepalive[11];

    // Fetch last health check for current balance
    const healthCheck = await publicClient.readContract({
      address: keepaliveRegistryAddress,
      abi: KEEPALIVE_ABI,
      functionName: 'lastHealthCheck',
      args: [keepaliveId],
    }) as [`0x${string}`, number, bigint, bigint, number, number];

    const currentBalance = healthCheck[3];
    const fundingNeeded = minRequired > currentBalance ? minRequired - currentBalance : 0n;

    return {
      shouldShowWakePage: true,
      data: {
        jnsName,
        appName: jnsName.replace('.jeju', ''),
        description: 'This decentralized app needs funding to resume operation.',
        owner,
        vaultAddress,
        currentBalance,
        minRequired,
        fundingNeeded,
        lastHealthy: Number(lastCheckAt) * 1000,
        agentId: keepalive[3] > 0n ? keepalive[3] : undefined,
      },
    };
  } catch (error) {
    console.error(`[Wake Page] Failed to check keepalive for ${jnsName}:`, error);
    return { shouldShowWakePage: false };
  }
}
