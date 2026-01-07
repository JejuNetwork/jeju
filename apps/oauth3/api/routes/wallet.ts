import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, verifyMessage } from 'viem'
import type { AuthConfig, WalletAuthChallenge } from '../../lib/types'
import { getEphemeralKey } from '../services/kms'
import { authCodeState, clientState, sessionState } from '../services/state'
import {
  createHtmlPage,
  escapeHtml,
  escapeJsString,
} from '../shared/html-templates'

/**
 * SECURITY: Validate redirect URI against client's registered patterns.
 * Prevents open redirect attacks by:
 * 1. Only allowing http/https schemes
 * 2. Strict pattern matching with proper escaping
 * 3. Not allowing data:, javascript:, or other dangerous schemes
 */
function validateRedirectUri(
  redirectUri: string,
  allowedPatterns: string[],
): boolean {
  // Parse the redirect URI to validate its structure
  let parsed: URL
  try {
    parsed = new URL(redirectUri)
  } catch {
    return false // Invalid URL format
  }

  // SECURITY: Only allow http/https schemes
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return false
  }

  // SECURITY: Block localhost in production patterns (but allow explicit localhost patterns)
  // Check if there's an explicit localhost pattern
  const hasLocalhostPattern = allowedPatterns.some(
    (p) =>
      p.includes('localhost') ||
      p.includes('127.0.0.1') ||
      p.includes('[::1]'),
  )

  // If no localhost pattern but URI is localhost, block it
  if (
    !hasLocalhostPattern &&
    (parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '[::1]')
  ) {
    return false
  }

  for (const pattern of allowedPatterns) {
    // Parse the pattern to extract scheme and host requirements
    const regexPattern = pattern
      // Escape all regex special characters except *
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      // Replace * with a non-greedy match that doesn't cross boundaries
      .replace(/\*/g, '[^/]*')
    const regex = new RegExp(`^${regexPattern}$`)
    if (regex.test(redirectUri)) {
      return true
    }
  }
  return false
}

const ChallengeQuerySchema = t.Object({
  client_id: t.String(),
  redirect_uri: t.String(),
  state: t.String(),
})

const VerifyBodySchema = t.Object({
  challengeId: t.String(),
  address: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
  signature: t.String({ pattern: '^0x[a-fA-F0-9]+$' }),
})

// Challenge store (short-lived, in-memory is OK)
const challenges = new Map<
  string,
  WalletAuthChallenge & { clientId: string; redirectUri: string; state: string }
>()

// SECURITY: Rate limiting to prevent DoS attacks
// Tracks challenge creation per IP/client
const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>()
const RATE_LIMIT_MAX = 10 // Max challenges per window
const RATE_LIMIT_WINDOW = 60 * 1000 // 1 minute window
const MAX_CHALLENGES = 10000 // Max total challenges to prevent memory exhaustion

function checkRateLimit(key: string): boolean {
  const now = Date.now()
  const bucket = rateLimitBuckets.get(key)

  if (!bucket || bucket.resetAt < now) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW })
    return true
  }

  if (bucket.count >= RATE_LIMIT_MAX) {
    return false
  }

  bucket.count++
  return true
}

// Clean up expired challenges and rate limit buckets periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, challenge] of challenges) {
    if (challenge.expiresAt < now) {
      challenges.delete(key)
    }
  }
  for (const [key, bucket] of rateLimitBuckets) {
    if (bucket.resetAt < now) {
      rateLimitBuckets.delete(key)
    }
  }
}, 60 * 1000) // Every minute

/**
 * Generate wallet connect page HTML
 */
function generateWalletConnectPage(
  challengeId: string,
  message: string,
): string {
  const content = `
  <main class="card" role="main">
    <div class="logo">Wallet</div>
    
    <div class="message-box" role="region" aria-label="Message to sign">
      <span aria-hidden="true">${escapeHtml(message)}</span>
      <span class="sr-only">Message: ${escapeHtml(message)}</span>
    </div>
    
    <button id="connectBtn" class="btn" type="button" aria-describedby="wallet-help">
      Connect Wallet
    </button>
    
    <p id="wallet-help" class="sr-only">
      Click to connect your Web3 wallet and sign the authentication message
    </p>
    
    <div id="status" class="status" role="status" aria-live="polite"></div>
    
    <footer class="footer">
      <a href="https://jejunetwork.org">Jeju Network</a>
    </footer>
  </main>
  <style>
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
  </style>`

  const scripts = `
    const challengeId = '${escapeJsString(challengeId)}';
    const message = '${escapeJsString(message)}';
    
    let address = null;
    let selectedProvider = null;
    
    // Detect available wallets
    function detectWallets() {
      const wallets = [];
      
      // Check for MetaMask specifically (has isMetaMask flag)
      if (window.ethereum?.isMetaMask && !window.ethereum?.isPhantom) {
        wallets.push({ name: 'MetaMask', provider: window.ethereum, icon: '🦊' });
      }
      
      // Check for Phantom EVM
      if (window.phantom?.ethereum) {
        wallets.push({ name: 'Phantom', provider: window.phantom.ethereum, icon: '👻' });
      } else if (window.ethereum?.isPhantom) {
        wallets.push({ name: 'Phantom', provider: window.ethereum, icon: '👻' });
      }
      
      // Check for Coinbase Wallet
      if (window.ethereum?.isCoinbaseWallet) {
        wallets.push({ name: 'Coinbase', provider: window.ethereum, icon: '🔵' });
      }
      
      // Check for Rainbow
      if (window.ethereum?.isRainbow) {
        wallets.push({ name: 'Rainbow', provider: window.ethereum, icon: '🌈' });
      }
      
      // Fallback to generic ethereum provider if no specific wallet detected
      if (wallets.length === 0 && window.ethereum) {
        wallets.push({ name: 'Browser Wallet', provider: window.ethereum, icon: '🔐' });
      }
      
      return wallets;
    }
    
    // Show wallet selector if multiple wallets
    function showWalletSelector(wallets) {
      const btn = document.getElementById('connectBtn');
      const status = document.getElementById('status');
      
      if (wallets.length === 0) {
        status.textContent = 'No wallet found. Install MetaMask or another browser wallet.';
        status.className = 'status error';
        btn.disabled = true;
        return;
      }
      
      if (wallets.length === 1) {
        selectedProvider = wallets[0].provider;
        btn.innerHTML = wallets[0].icon + ' Connect with ' + wallets[0].name;
        return;
      }
      
      // Multiple wallets - show selector
      let html = '<div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px;">';
      wallets.forEach((wallet, i) => {
        html += '<button class="wallet-option" data-index="' + i + '" style="display:flex;align-items:center;gap:8px;padding:12px 16px;border:1px solid rgba(99,102,241,0.3);border-radius:8px;background:rgba(99,102,241,0.1);color:#e2e8f0;cursor:pointer;font-size:14px;">';
        html += '<span style="font-size:20px;">' + wallet.icon + '</span>';
        html += '<span>' + wallet.name + '</span>';
        html += '</button>';
      });
      html += '</div>';
      
      status.innerHTML = html;
      status.className = 'status';
      btn.style.display = 'none';
      
      // Add click handlers
      document.querySelectorAll('.wallet-option').forEach(el => {
        el.addEventListener('click', () => {
          const idx = parseInt(el.dataset.index);
          selectedProvider = wallets[idx].provider;
          status.innerHTML = '';
          btn.style.display = 'block';
          btn.innerHTML = wallets[idx].icon + ' Connect with ' + wallets[idx].name;
          connect();
        });
      });
    }
    
    async function connect() {
      const status = document.getElementById('status');
      const btn = document.getElementById('connectBtn');
      
      if (!selectedProvider) {
        status.textContent = 'Please select a wallet';
        return;
      }
      
      try {
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        
        // Request accounts
        const accounts = await selectedProvider.request({ 
          method: 'eth_requestAccounts' 
        });
        address = accounts[0];
        
        btn.textContent = 'Sign Message...';
        status.innerHTML = 'Connected: <span class="address-badge">' + address.slice(0, 6) + '...' + address.slice(-4) + '</span>';
        
        // Request signature
        const signature = await selectedProvider.request({
          method: 'personal_sign',
          params: [message, address]
        });
        
        btn.textContent = 'Verifying...';
        
        // Submit to backend
        const response = await fetch('/wallet/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            challengeId,
            address,
            signature
          })
        });
        
        const result = await response.json();
        
        if (result.redirectUrl) {
          status.textContent = 'Success. Redirecting...';
          status.className = 'status success';
          window.location.href = result.redirectUrl;
        } else {
          throw new Error(result.error || 'Verification failed');
        }
        
      } catch (err) {
        console.error(err);
        status.textContent = err.message || 'Connection failed';
        status.className = 'status error';
        btn.disabled = false;
        btn.textContent = 'Try Again';
      }
    }
    
    // Initialize on load
    const wallets = detectWallets();
    showWalletSelector(wallets);
    
    document.getElementById('connectBtn').addEventListener('click', connect);
  `

  return createHtmlPage({
    title: 'Connect Wallet',
    content,
    scripts,
  })
}

export function createWalletRouter(_config: AuthConfig) {
  return new Elysia({ name: 'wallet', prefix: '/wallet' })
    .get(
      '/challenge',
      async ({ query, set, request }) => {
        const { client_id: clientId, redirect_uri: redirectUri, state } = query

        // SECURITY: Rate limiting per client to prevent DoS
        const rateLimitKey = `wallet:${clientId}`
        if (!checkRateLimit(rateLimitKey)) {
          set.status = 429
          return {
            error: 'rate_limited',
            error_description: 'Too many challenge requests. Try again later.',
          }
        }

        // SECURITY: Prevent memory exhaustion
        if (challenges.size >= MAX_CHALLENGES) {
          set.status = 503
          return {
            error: 'service_unavailable',
            error_description: 'Service temporarily unavailable. Try again later.',
          }
        }

        // Validate client exists and redirect URI is allowed
        const client = await clientState.get(clientId)
        if (!client || !client.active) {
          set.status = 400
          return { error: 'invalid_client' }
        }

        if (!validateRedirectUri(redirectUri, client.redirectUris)) {
          set.status = 400
          return { error: 'invalid_redirect_uri' }
        }

        const challengeId = crypto.randomUUID()
        const nonce = crypto.randomUUID()
        const timestamp = new Date().toISOString()

        // Domain should match the OAuth3 server domain
        const domain = redirectUri.includes('testnet')
          ? 'oauth3.testnet.jejunetwork.org'
          : redirectUri.includes('localhost')
            ? 'localhost'
            : 'oauth3.jejunetwork.org'

        const message = `Jeju Network sign-in request.

Domain: ${domain}
Nonce: ${nonce}
Issued At: ${timestamp}
URI: ${redirectUri}

No transaction will be sent. No gas fees.`

        const challenge: WalletAuthChallenge & {
          clientId: string
          redirectUri: string
          state: string
        } = {
          challengeId,
          message,
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
          clientId,
          redirectUri,
          state,
        }

        challenges.set(challengeId, challenge)
        // SECURITY: Only log non-sensitive metadata
        console.log('[OAuth3/Wallet] Challenge created', {
          clientId,
          challengeCount: challenges.size,
        })

        const html = generateWalletConnectPage(challengeId, message)
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
      },
      { query: ChallengeQuerySchema },
    )

    .post(
      '/verify',
      async ({ body, set }) => {
        if (!isAddress(body.address)) {
          set.status = 400
          return { error: 'invalid_address' }
        }
        if (!isHex(body.signature)) {
          set.status = 400
          return { error: 'invalid_signature_format' }
        }

        const address: Address = body.address
        const signature: Hex = body.signature

        const challenge = challenges.get(body.challengeId)
        if (!challenge) {
          set.status = 400
          return {
            error: 'invalid_challenge',
            error_description: 'Challenge not found or expired',
          }
        }

        if (challenge.expiresAt < Date.now()) {
          challenges.delete(body.challengeId)
          set.status = 400
          return { error: 'expired_challenge' }
        }

        // Verify signature
        const valid = await verifyMessage({
          address: address,
          message: challenge.message,
          signature: signature,
        })

        if (!valid) {
          set.status = 400
          return { error: 'invalid_signature' }
        }

        // Create authorization code
        const code = crypto.randomUUID()
        const userId = `wallet:${address.toLowerCase()}`

        // SECURITY: Only log non-sensitive metadata
        console.log('[OAuth3] Wallet verified, creating auth code')

        await authCodeState.save(code, {
          clientId: challenge.clientId,
          redirectUri: challenge.redirectUri,
          userId,
          scope: ['openid', 'profile'],
          expiresAt: Date.now() + 5 * 60 * 1000,
        })

        // Create session with ephemeral key
        const sessionId = crypto.randomUUID()
        const ephemeralKey = await getEphemeralKey(sessionId)

        await sessionState.save({
          sessionId,
          userId,
          provider: 'wallet',
          address, // Will be encrypted by sessionState.save()
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          metadata: {},
          ephemeralKeyId: ephemeralKey.keyId,
        })

        // Clean up challenge
        challenges.delete(body.challengeId)

        // Build redirect URL
        const redirectUrl = new URL(challenge.redirectUri)
        redirectUrl.searchParams.set('code', code)
        if (challenge.state) {
          redirectUrl.searchParams.set('state', challenge.state)
        }

        return {
          success: true,
          redirectUrl: redirectUrl.toString(),
        }
      },
      { body: VerifyBodySchema },
    )

    .get('/status/:challengeId', async ({ params, set }) => {
      // SECURITY: Don't log challenge IDs or enumerate challenges
      const challenge = challenges.get(params.challengeId)
      if (!challenge) {
        set.status = 404
        return { error: 'not_found' }
      }

      return {
        expiresAt: challenge.expiresAt,
        expired: challenge.expiresAt < Date.now(),
      }
    })
}
