/**
 * Static HTML page for smoke testing
 *
 * This page is served locally by the CLI during E2E smoke tests.
 * It provides a minimal test surface to verify:
 * 1. Browser automation works
 * 2. Wallet connection works
 * 3. Screenshot capture works
 * 4. AI visual verification works
 */

export const SMOKE_TEST_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Jeju E2E Smoke Test</title>
  <style>
    :root {
      --bg-primary: #0a0a0f;
      --bg-secondary: #12121a;
      --bg-tertiary: #1a1a25;
      --text-primary: #ffffff;
      --text-secondary: #a0a0b0;
      --accent-primary: #6366f1;
      --accent-secondary: #8b5cf6;
      --success: #10b981;
      --warning: #f59e0b;
      --error: #ef4444;
      --border: #2a2a3a;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg-primary);
      color: var(--text-primary);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }

    .container {
      max-width: 600px;
      width: 100%;
      background: var(--bg-secondary);
      border-radius: 16px;
      border: 1px solid var(--border);
      padding: 2.5rem;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
    }

    .header {
      text-align: center;
      margin-bottom: 2rem;
    }

    .logo {
      font-size: 2.5rem;
      font-weight: 800;
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 0.5rem;
    }

    .subtitle {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .status-card {
      background: var(--bg-tertiary);
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }

    .status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--border);
    }

    .status-row:last-child {
      border-bottom: none;
    }

    .status-label {
      color: var(--text-secondary);
      font-size: 0.9rem;
    }

    .status-value {
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
    }

    .status-indicator.success { background: var(--success); }
    .status-indicator.warning { background: var(--warning); }
    .status-indicator.error { background: var(--error); }
    .status-indicator.pending { background: var(--text-secondary); animation: pulse 1.5s infinite; }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }

    .connect-button {
      width: 100%;
      padding: 1rem 2rem;
      font-size: 1.1rem;
      font-weight: 600;
      border: none;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
    }

    .connect-button.disconnected {
      background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
      color: white;
    }

    .connect-button.disconnected:hover {
      transform: translateY(-2px);
      box-shadow: 0 10px 30px rgba(99, 102, 241, 0.3);
    }

    .connect-button.connected {
      background: var(--bg-tertiary);
      color: var(--success);
      border: 2px solid var(--success);
    }

    .connect-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
      transform: none;
    }

    .wallet-icon {
      width: 24px;
      height: 24px;
    }

    .address-display {
      margin-top: 1.5rem;
      padding: 1rem;
      background: var(--bg-tertiary);
      border-radius: 8px;
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.85rem;
      text-align: center;
      color: var(--accent-primary);
      display: none;
    }

    .address-display.visible {
      display: block;
    }

    .test-results {
      margin-top: 1.5rem;
      padding: 1rem;
      background: var(--bg-tertiary);
      border-radius: 8px;
    }

    .test-result {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.5rem 0;
      font-size: 0.9rem;
    }

    .test-result .icon {
      font-size: 1rem;
    }

    .footer {
      margin-top: 2rem;
      text-align: center;
      color: var(--text-secondary);
      font-size: 0.8rem;
    }

    #error-message {
      margin-top: 1rem;
      padding: 1rem;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid var(--error);
      border-radius: 8px;
      color: var(--error);
      font-size: 0.9rem;
      display: none;
    }

    #error-message.visible {
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">Jeju Network</div>
      <div class="subtitle">E2E Smoke Test</div>
    </div>

    <div class="status-card">
      <div class="status-row">
        <span class="status-label">Browser</span>
        <span class="status-value">
          <span class="status-indicator success"></span>
          Ready
        </span>
      </div>
      <div class="status-row">
        <span class="status-label">MetaMask</span>
        <span class="status-value" id="metamask-status">
          <span class="status-indicator pending"></span>
          Checking...
        </span>
      </div>
      <div class="status-row">
        <span class="status-label">Wallet</span>
        <span class="status-value" id="wallet-status">
          <span class="status-indicator pending"></span>
          Not connected
        </span>
      </div>
      <div class="status-row">
        <span class="status-label">Network</span>
        <span class="status-value" id="network-status">
          <span class="status-indicator pending"></span>
          Unknown
        </span>
      </div>
    </div>

    <button id="connect-button" class="connect-button disconnected" data-testid="connect-wallet">
      <svg class="wallet-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/>
        <path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/>
        <circle cx="18" cy="15" r="2"/>
      </svg>
      <span id="button-text">Connect Wallet</span>
    </button>

    <div id="wallet-address" class="address-display" data-testid="wallet-address"></div>

    <div id="error-message"></div>

    <div class="test-results" id="test-results" style="display: none;">
      <div class="test-result" id="test-browser">
        <span class="icon">⏳</span>
        <span>Browser automation</span>
      </div>
      <div class="test-result" id="test-wallet">
        <span class="icon">⏳</span>
        <span>Wallet connection</span>
      </div>
      <div class="test-result" id="test-network">
        <span class="icon">⏳</span>
        <span>Network detection</span>
      </div>
    </div>

    <div class="footer">
      Jeju Network E2E Testing Infrastructure
    </div>
  </div>

  <script>
    // State
    let connected = false;
    let walletAddress = null;
    let chainId = null;

    // Elements
    const connectButton = document.getElementById('connect-button');
    const buttonText = document.getElementById('button-text');
    const walletAddressDiv = document.getElementById('wallet-address');
    const metamaskStatus = document.getElementById('metamask-status');
    const walletStatus = document.getElementById('wallet-status');
    const networkStatus = document.getElementById('network-status');
    const errorMessage = document.getElementById('error-message');

    // Check for MetaMask
    function checkMetaMask() {
      if (typeof window.ethereum !== 'undefined') {
        metamaskStatus.innerHTML = '<span class="status-indicator success"></span>Detected';
        return true;
      } else {
        metamaskStatus.innerHTML = '<span class="status-indicator error"></span>Not installed';
        return false;
      }
    }

    // Update network status
    function updateNetworkStatus(chainIdHex) {
      chainId = parseInt(chainIdHex, 16);
      const networks = {
        1: 'Ethereum Mainnet',
        5: 'Goerli Testnet',
        11155111: 'Sepolia Testnet',
        31337: 'Jeju Localnet',
        137: 'Polygon',
        42161: 'Arbitrum',
      };
      const networkName = networks[chainId] || 'Chain ' + chainId;
      const isLocal = chainId === 31337;
      networkStatus.innerHTML = \`<span class="status-indicator \${isLocal ? 'success' : 'warning'}"></span>\${networkName}\`;
    }

    // Connect wallet
    async function connectWallet() {
      if (!checkMetaMask()) {
        showError('MetaMask is not installed. Please install MetaMask to continue.');
        return;
      }

      try {
        connectButton.disabled = true;
        buttonText.textContent = 'Connecting...';

        // Request accounts
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });

        if (accounts.length > 0) {
          walletAddress = accounts[0];
          connected = true;

          // Update UI
          connectButton.classList.remove('disconnected');
          connectButton.classList.add('connected');
          buttonText.textContent = 'Connected';
          walletAddressDiv.textContent = walletAddress;
          walletAddressDiv.classList.add('visible');

          // Update wallet status
          const truncated = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
          walletStatus.innerHTML = \`<span class="status-indicator success"></span>\${truncated}\`;

          // Get network
          const chainIdHex = await window.ethereum.request({ method: 'eth_chainId' });
          updateNetworkStatus(chainIdHex);

          hideError();
        }
      } catch (error) {
        showError('Failed to connect: ' + (error.message || error));
        connectButton.disabled = false;
        buttonText.textContent = 'Connect Wallet';
      }
    }

    // Disconnect (reset UI)
    function disconnect() {
      connected = false;
      walletAddress = null;
      connectButton.classList.remove('connected');
      connectButton.classList.add('disconnected');
      buttonText.textContent = 'Connect Wallet';
      walletAddressDiv.classList.remove('visible');
      walletStatus.innerHTML = '<span class="status-indicator pending"></span>Not connected';
    }

    // Error handling
    function showError(message) {
      errorMessage.textContent = message;
      errorMessage.classList.add('visible');
    }

    function hideError() {
      errorMessage.classList.remove('visible');
    }

    // Event listeners
    connectButton.addEventListener('click', async () => {
      if (connected) {
        disconnect();
      } else {
        await connectWallet();
      }
    });

    // Listen for account changes
    if (window.ethereum) {
      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length === 0) {
          disconnect();
        } else {
          walletAddress = accounts[0];
          const truncated = walletAddress.slice(0, 6) + '...' + walletAddress.slice(-4);
          walletStatus.innerHTML = \`<span class="status-indicator success"></span>\${truncated}\`;
          walletAddressDiv.textContent = walletAddress;
        }
      });

      window.ethereum.on('chainChanged', (chainIdHex) => {
        updateNetworkStatus(chainIdHex);
      });
    }

    // Initialize
    checkMetaMask();
  </script>
</body>
</html>`

export const SMOKE_TEST_PORT = 19999

/**
 * Start the smoke test server
 */
export async function startSmokeTestServer(): Promise<{
  stop: () => void
  url: string
  port: number
}> {
  const server = Bun.serve({
    port: SMOKE_TEST_PORT,
    fetch(request) {
      const url = new URL(request.url)

      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(SMOKE_TEST_HTML, {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      if (url.pathname === '/health') {
        return new Response(JSON.stringify({ status: 'ok' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return new Response('Not Found', { status: 404 })
    },
  })

  return {
    stop: () => server.stop(),
    url: `http://localhost:${SMOKE_TEST_PORT}`,
    port: SMOKE_TEST_PORT,
  }
}
