/**
 * OAuth3 Demo Server
 *
 * A complete demo server showing OAuth3 authentication in action.
 * Demonstrates wallet login, Farcaster login, and credential issuance.
 */

import { cors } from '@elysiajs/cors'
import { AddressSchema } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { type Address, keccak256, toBytes } from 'viem'
import { generatePrivateKey } from 'viem/accounts'
import { z } from 'zod'
import { createMultiTenantCouncilManager } from '../council/multi-tenant.js'
import { VerifiableCredentialIssuer } from '../credentials/verifiable-credentials.js'
import { FROSTCoordinator } from '../mpc/frost-signing.js'
import { AuthProvider } from '../types.js'
import { generateCallbackHtml } from './callback-handler.js'

// Request validation schemas
const WalletAuthSchema = z.object({
  address: AddressSchema,
  signature: z.string(),
  message: z.string(),
})

const CredentialIssueSchema = z.object({
  provider: z.string(),
  providerId: z.string(),
  providerHandle: z.string(),
  walletAddress: AddressSchema,
})

const MPCSignSchema = z.object({
  message: z.string(),
})

const CHAIN_ID = 420691

const issuerPrivateKey = generatePrivateKey()
const credentialIssuer = new VerifiableCredentialIssuer(
  issuerPrivateKey,
  'OAuth3 Demo Issuer',
  CHAIN_ID,
)

let councilManager: Awaited<ReturnType<typeof createMultiTenantCouncilManager>>
let frostCoordinator: FROSTCoordinator

async function initDemo() {
  councilManager = await createMultiTenantCouncilManager(
    '0x0000000000000000000000000000000000000001' as Address,
    '0x0000000000000000000000000000000000000002' as Address,
    CHAIN_ID,
  )

  frostCoordinator = new FROSTCoordinator('demo-cluster', 2, 3)
  await frostCoordinator.initializeCluster()
}

// SECURITY: Define allowed callback origins for demo server
// NOTE: Port 4060 is the OAuth3 API port per @jejunetwork/config
const DEMO_ALLOWED_ORIGINS = [
  'http://localhost:4060',
  'http://127.0.0.1:4060',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
]

const app = new Elysia()
  .use(
    cors({
      origin: (request) => {
        const origin = request.headers.get('origin')
        if (!origin) return false
        // Only allow localhost for demo
        if (origin.includes('localhost') || origin.includes('127.0.0.1')) {
          return true
        }
        return false
      },
      credentials: true,
    }),
  )
  .get('/', () => {
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>OAuth3 Demo</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0f0f1a;
          color: white;
          min-height: 100vh;
          padding: 2rem;
        }
        .container { max-width: 800px; margin: 0 auto; }
        h1 {
          font-size: 2.5rem;
          margin-bottom: 0.5rem;
          background: linear-gradient(135deg, #667eea, #764ba2);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .subtitle { color: #888; margin-bottom: 2rem; }
        .card {
          background: #1a1a2e;
          border-radius: 1rem;
          padding: 2rem;
          margin-bottom: 1.5rem;
          border: 1px solid #333;
        }
        .card h2 { margin-bottom: 1rem; font-size: 1.25rem; }
        .button {
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          border-radius: 0.5rem;
          font-weight: 500;
          cursor: pointer;
          border: none;
          font-size: 1rem;
          transition: transform 0.1s, box-shadow 0.1s;
        }
        .button:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.3); }
        .button:active { transform: translateY(0); }
        .button-wallet { background: #f7931a; color: white; }
        .button-farcaster { background: #8B5CF6; color: white; }
        .button-google { background: #4285f4; color: white; }
        .buttons { display: flex; gap: 1rem; flex-wrap: wrap; }
        .status {
          background: #2a2a4e;
          padding: 1rem;
          border-radius: 0.5rem;
          margin-top: 1rem;
          font-family: monospace;
          font-size: 0.875rem;
          white-space: pre-wrap;
          word-break: break-all;
        }
        .features {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 1rem;
          margin-top: 2rem;
        }
        .feature {
          background: #1a1a2e;
          padding: 1.5rem;
          border-radius: 0.75rem;
          border: 1px solid #333;
        }
        .feature h3 { font-size: 1rem; margin-bottom: 0.5rem; color: #667eea; }
        .feature p { color: #888; font-size: 0.875rem; }
        .footer { text-align: center; color: #666; margin-top: 3rem; font-size: 0.875rem; }
        .footer a { color: #667eea; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>OAuth3 Demo</h1>
        <p class="subtitle">Decentralized authentication with TEE-backed key management</p>

        <div class="card">
          <h2>🔐 Login Options</h2>
          <div class="buttons">
            <button class="button button-wallet" onclick="loginWallet()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M21 18v1c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V5c0-1.1.9-2 2-2h14c1.1 0 2 .9 2 2v1h-9c-1.1 0-2 .9-2 2v8c0 1.1.9 2 2 2h9zm-9-2h10V8H12v8zm4-2.5c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
              </svg>
              Connect Wallet
            </button>
            <button class="button button-farcaster" onclick="loginFarcaster()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
              Farcaster
            </button>
            <button class="button button-google" onclick="loginGoogle()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.545,10.239v3.821h5.445c-0.712,2.315-2.647,3.972-5.445,3.972c-3.332,0-6.033-2.701-6.033-6.032s2.701-6.032,6.033-6.032c1.498,0,2.866,0.549,3.921,1.453l2.814-2.814C17.503,2.988,15.139,2,12.545,2C7.021,2,2.543,6.477,2.543,12s4.478,10,10.002,10c8.396,0,10.249-7.85,9.426-11.748L12.545,10.239z"/>
              </svg>
              Google
            </button>
          </div>
          <div id="login-status" class="status" style="display: none;"></div>
        </div>

        <div class="card">
          <h2>📜 Verifiable Credentials</h2>
          <p style="color: #888; margin-bottom: 1rem;">Issue and verify W3C Verifiable Credentials</p>
          <button class="button" style="background: #22c55e; color: white;" onclick="issueCredential()">
            Issue Test Credential
          </button>
          <div id="credential-status" class="status" style="display: none;"></div>
        </div>

        <div class="card">
          <h2>🔑 MPC Signing (FROST)</h2>
          <p style="color: #888; margin-bottom: 1rem;">Threshold signing with 2-of-3 key shares</p>
          <button class="button" style="background: #667eea; color: white;" onclick="testMpcSign()">
            Sign Message
          </button>
          <div id="mpc-status" class="status" style="display: none;"></div>
        </div>

        <div class="features">
          <div class="feature">
            <h3>🛡️ TEE Secured</h3>
            <p>All sensitive operations run in Intel TDX enclaves via dstack</p>
          </div>
          <div class="feature">
            <h3>🔐 Self-Custodial</h3>
            <p>Keys never leave the secure enclave, you maintain full control</p>
          </div>
          <div class="feature">
            <h3>⛓️ Cross-Chain</h3>
            <p>One identity works across all EVM chains via Open Intents</p>
          </div>
          <div class="feature">
            <h3>🏛️ DAO Governed</h3>
            <p>Multi-tenant OAuth apps managed by councils</p>
          </div>
        </div>

        <div class="footer">
          <p>Built on <a href="https://jejunetwork.org">Jeju Network</a> · OAuth3 v0.1.0</p>
        </div>
      </div>

      <script>
        const API_URL = '';

        async function loginWallet() {
          const status = document.getElementById('login-status');
          status.style.display = 'block';
          status.textContent = 'Connecting wallet...';

          try {
            if (!window.ethereum) {
              throw new Error('No Ethereum wallet found. Please install MetaMask.');
            }

            const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
            const address = accounts[0];

            const nonce = crypto.randomUUID();
            const message = \`Sign in to OAuth3 Demo\\n\\nAddress: \${address}\\nNonce: \${nonce}\\nTimestamp: \${new Date().toISOString()}\`;

            status.textContent = 'Signing message...';
            const signature = await window.ethereum.request({
              method: 'personal_sign',
              params: [message, address]
            });

            status.textContent = 'Verifying with OAuth3...';
            const response = await fetch(API_URL + '/api/auth/wallet', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ address, signature, message })
            });

            const result = await response.json();
            status.textContent = JSON.stringify(result, null, 2);
          } catch (error) {
            status.textContent = 'Error: ' + error.message;
          }
        }

        async function loginFarcaster() {
          const status = document.getElementById('login-status');
          status.style.display = 'block';
          status.textContent = 'Farcaster login requires a Farcaster client.\\nIn production, this would open Warpcast or similar.';
        }

        async function loginGoogle() {
          const status = document.getElementById('login-status');
          status.style.display = 'block';
          status.textContent = 'Google OAuth requires client credentials.\\nIn production, this would redirect to Google.';
        }

        async function issueCredential() {
          const status = document.getElementById('credential-status');
          status.style.display = 'block';
          status.textContent = 'Issuing credential...';

          try {
            const response = await fetch(API_URL + '/api/credential/issue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: 'wallet',
                providerId: '0x' + crypto.randomUUID().replace(/-/g, ''),
                providerHandle: '0xDemo...',
                walletAddress: '0x' + '1234'.repeat(10)
              })
            });

            const result = await response.json();
            status.textContent = JSON.stringify(result, null, 2);
          } catch (error) {
            status.textContent = 'Error: ' + error.message;
          }
        }

        async function testMpcSign() {
          const status = document.getElementById('mpc-status');
          status.style.display = 'block';
          status.textContent = 'Generating FROST signature...';

          try {
            const response = await fetch(API_URL + '/api/mpc/sign', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: 'Hello from OAuth3 Demo!'
              })
            });

            const result = await response.json();
            status.textContent = JSON.stringify(result, null, 2);
          } catch (error) {
            status.textContent = 'Error: ' + error.message;
          }
        }
      </script>
    </body>
    </html>`
  })
  .get('/callback', ({ query }) => {
    const requestedOrigin = query.origin as string | undefined
    // SECURITY: Validate origin against allowlist
    const origin =
      requestedOrigin && DEMO_ALLOWED_ORIGINS.includes(requestedOrigin)
        ? requestedOrigin
        : DEMO_ALLOWED_ORIGINS[0]
    return generateCallbackHtml(origin)
  })
  .post('/api/auth/wallet', ({ body, set }) => {
    const parseResult = WalletAuthSchema.safeParse(body)
    if (!parseResult.success) {
      set.status = 400
      return { error: 'Invalid request' }
    }

    const { address } = parseResult.data

    const sessionId = keccak256(toBytes(`session:${address}:${Date.now()}`))
    const identityId = keccak256(
      toBytes(`identity:wallet:${address.toLowerCase()}`),
    )

    return {
      success: true,
      session: {
        sessionId,
        identityId,
        address,
        expiresAt: Date.now() + 86400000,
      },
      attestation: {
        provider: 'simulated',
        verified: false,
        timestamp: Date.now(),
      },
    }
  })
  .post('/api/credential/issue', async ({ body, set }) => {
    const parseResult = CredentialIssueSchema.safeParse(body)
    if (!parseResult.success) {
      set.status = 400
      return { error: 'Invalid request' }
    }

    const { provider, providerId, providerHandle, walletAddress } =
      parseResult.data

    const authProvider =
      AuthProvider[provider.toUpperCase() as keyof typeof AuthProvider] ||
      AuthProvider.WALLET
    const credential = await credentialIssuer.issueProviderCredential(
      authProvider,
      providerId,
      providerHandle,
      walletAddress,
    )

    return {
      success: true,
      credential,
    }
  })
  .post('/api/mpc/sign', async ({ body, set }) => {
    const parseResult = MPCSignSchema.safeParse(body)
    if (!parseResult.success) {
      set.status = 400
      return { error: 'Invalid request' }
    }

    const { message } = parseResult.data

    const messageHash = keccak256(toBytes(message))
    const signature = await frostCoordinator.sign(messageHash, [1, 2])

    return {
      success: true,
      message,
      messageHash,
      signature: {
        r: signature.r,
        s: signature.s,
        v: signature.v,
      },
      cluster: {
        address: frostCoordinator.getAddress(),
        threshold: 2,
        parties: 3,
      },
    }
  })
  .get('/api/councils', () => {
    const councils = councilManager.getAllCouncils()
    return {
      councils: councils.map((council) => ({
        type: council.councilType,
        name: council.config.name,
        ceo: council.ceo.name,
        agents: council.agents.length,
        appId: council.oauth3App.appId,
      })),
    }
  })
  .get('/health', () => ({
    status: 'healthy',
    version: '0.1.0',
    issuer: credentialIssuer.getIssuerDid(),
    mpcCluster: frostCoordinator.getAddress(),
  }))

// Use OAuth3 API port from config (4060) - don't conflict with CQL (4661)
const PORT = parseInt(process.env.DEMO_PORT || '4060', 10)

initDemo().then(() => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                  OAuth3 Demo Server                         ║
╠════════════════════════════════════════════════════════════╣
║  URL:           http://localhost:${String(PORT).padEnd(24)}║
║  Issuer DID:    ${credentialIssuer.getIssuerDid().slice(0, 38).padEnd(38)}║
║  MPC Address:   ${frostCoordinator.getAddress().padEnd(38)}║
╚════════════════════════════════════════════════════════════╝
`)

  app.listen(PORT)
})

export { app }
