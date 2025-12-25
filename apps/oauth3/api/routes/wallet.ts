/**
 * Wallet authentication routes
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, verifyMessage } from 'viem'
import type { AuthConfig, WalletAuthChallenge } from '../../lib/types'
import { authorizationCodes, sessions } from './oauth'

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

// Challenge store
const challenges = new Map<
  string,
  WalletAuthChallenge & { clientId: string; redirectUri: string; state: string }
>()

export function createWalletRouter(_config: AuthConfig) {
  return new Elysia({ name: 'wallet', prefix: '/wallet' })
    .get(
      '/challenge',
      async ({ query }) => {
        const { client_id: clientId, redirect_uri: redirectUri, state } = query

        const challengeId = crypto.randomUUID()
        const nonce = crypto.randomUUID()
        const timestamp = new Date().toISOString()

        const message = `Sign this message to authenticate with Jeju Network.

Domain: auth.jejunetwork.org
Nonce: ${nonce}
Issued At: ${timestamp}
URI: ${redirectUri}

This signature will not trigger any blockchain transaction or cost any gas fees.`

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

        // Return HTML page with wallet connection
        return new Response(
          `<!DOCTYPE html>
<html>
<head>
  <title>Connect Wallet - Jeju Network</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'JetBrains Mono', 'SF Mono', monospace;
      background: linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #e0e0e0;
    }
    .container {
      background: rgba(20, 20, 30, 0.9);
      border: 1px solid rgba(100, 255, 218, 0.2);
      border-radius: 16px;
      padding: 48px;
      max-width: 480px;
      width: 90%;
    }
    .logo {
      font-size: 32px;
      font-weight: 700;
      background: linear-gradient(135deg, #64ffda 0%, #00bcd4 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      text-align: center;
      margin-bottom: 32px;
    }
    .message-box {
      background: rgba(0, 0, 0, 0.3);
      border: 1px solid rgba(100, 255, 218, 0.1);
      border-radius: 8px;
      padding: 16px;
      font-size: 13px;
      white-space: pre-wrap;
      margin-bottom: 24px;
      color: #aaa;
    }
    .btn {
      width: 100%;
      padding: 16px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-primary {
      background: linear-gradient(135deg, #64ffda 0%, #00bcd4 100%);
      color: #0a0a0a;
    }
    .btn-primary:hover { opacity: 0.9; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .status {
      text-align: center;
      margin-top: 16px;
      font-size: 14px;
      color: #888;
    }
    .status.error { color: #ff6b6b; }
    .status.success { color: #64ffda; }
    .address {
      font-family: monospace;
      background: rgba(100, 255, 218, 0.1);
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🔐 Connect Wallet</div>
    
    <div class="message-box">${message}</div>
    
    <button id="connectBtn" class="btn btn-primary">Connect Wallet</button>
    
    <div id="status" class="status"></div>
  </div>

  <script>
    const challengeId = '${challengeId}';
    const message = \`${message.replace(/`/g, '\\`')}\`;
    
    let provider = null;
    let address = null;
    
    async function connect() {
      const status = document.getElementById('status');
      const btn = document.getElementById('connectBtn');
      
      if (!window.ethereum) {
        status.textContent = 'No wallet detected. Please install MetaMask or another Web3 wallet.';
        status.className = 'status error';
        return;
      }
      
      try {
        btn.disabled = true;
        btn.textContent = 'Connecting...';
        status.textContent = '';
        
        // Request accounts
        const accounts = await window.ethereum.request({ 
          method: 'eth_requestAccounts' 
        });
        address = accounts[0];
        
        btn.textContent = 'Sign Message...';
        status.innerHTML = 'Connected: <span class="address">' + address.slice(0, 6) + '...' + address.slice(-4) + '</span>';
        
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
          throw new Error(result.error ?? 'Verification failed');
        }
        
      } catch (err) {
        console.error(err);
        status.textContent = err.message ?? 'Connection failed';
        status.className = 'status error';
        btn.disabled = false;
        btn.textContent = 'Try Again';
      }
    }
    
    document.getElementById('connectBtn').addEventListener('click', connect);
  </script>
</body>
</html>`,
          {
            headers: { 'Content-Type': 'text/html' },
          },
        )
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

        authorizationCodes.set(code, {
          clientId: challenge.clientId,
          redirectUri: challenge.redirectUri,
          userId,
          scope: ['openid', 'profile'],
          expiresAt: Date.now() + 5 * 60 * 1000,
        })

        // Create session
        const sessionId = crypto.randomUUID()
        sessions.set(sessionId, {
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
