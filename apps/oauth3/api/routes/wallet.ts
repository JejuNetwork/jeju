/**
 * Wallet authentication routes
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, verifyMessage } from 'viem'
import type { AuthConfig, WalletAuthChallenge } from '../../lib/types'
import {
  createHtmlPage,
  escapeHtml,
  escapeJsString,
} from '../shared/html-templates'
import { authCodeState, clientState, sessionState } from '../services/state'

/**
 * Validate redirect URI against client's registered patterns.
 */
function validateRedirectUri(
  redirectUri: string,
  allowedPatterns: string[],
): boolean {
  for (const pattern of allowedPatterns) {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '.*')
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

// Clean up expired challenges periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, challenge] of challenges) {
    if (challenge.expiresAt < now) {
      challenges.delete(key)
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
    <div class="logo">Wallet Sign-In</div>
    <div class="subtitle">Sign once to prove it's you</div>
    
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
    
    async function connect() {
      const status = document.getElementById('status');
      const btn = document.getElementById('connectBtn');
      
      if (!window.ethereum) {
        status.textContent = 'No wallet found. Install MetaMask or another browser wallet.';
        status.className = 'status error';
        return;
      }
      
      try {
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        status.textContent = '';
        status.className = 'status';
        
        // Request accounts
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        });
        address = accounts[0];
        
        btn.textContent = 'Sign Message...';
        status.innerHTML = 'Connected: <span class="address-badge">' + address.slice(0, 6) + '...' + address.slice(-4) + '</span>';
        
        // Request signature
        const signature = await window.ethereum.request({
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
      async ({ query, set }) => {
        const { client_id: clientId, redirect_uri: redirectUri, state } = query

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

        const message = `Jeju Network sign-in request.

Domain: auth.jejunetwork.org
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

        await authCodeState.save(code, {
          clientId: challenge.clientId,
          redirectUri: challenge.redirectUri,
          userId,
          scope: ['openid', 'profile'],
          expiresAt: Date.now() + 5 * 60 * 1000,
        })

        // Create session
        const sessionId = crypto.randomUUID()
        await sessionState.save({
          sessionId,
          userId,
          provider: 'wallet',
          address: address,
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          metadata: {},
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
      const challenge = challenges.get(params.challengeId)
      if (!challenge) {
        set.status = 404
        return { error: 'not_found' }
      }

      return {
        challengeId: challenge.challengeId,
        expiresAt: challenge.expiresAt,
        expired: challenge.expiresAt < Date.now(),
      }
    })
}
