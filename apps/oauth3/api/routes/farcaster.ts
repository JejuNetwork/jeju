/**
 * Farcaster authentication routes
 */

import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, verifyMessage } from 'viem'
import type { AuthConfig } from '../../lib/types'
import { authCodeState, sessionState } from '../services/state'

const InitQuerySchema = t.Object({
  client_id: t.String(),
  redirect_uri: t.String(),
  state: t.String(),
})

const VerifyBodySchema = t.Object({
  nonce: t.String(),
  message: t.String(),
  signature: t.String({ pattern: '^0x[a-fA-F0-9]+$' }),
  fid: t.Number(),
  custody: t.String({ pattern: '^0x[a-fA-F0-9]{40}$' }),
})

// Farcaster auth state (short-lived, in-memory is OK)
const farcasterChallenges = new Map<
  string,
  {
    nonce: string
    domain: string
    clientId: string
    redirectUri: string
    state: string
    expiresAt: number
  }
>()

// Clean up expired challenges periodically
setInterval(() => {
  const now = Date.now()
  for (const [key, challenge] of farcasterChallenges) {
    if (challenge.expiresAt < now) {
      farcasterChallenges.delete(key)
    }
  }
}, 60 * 1000)

export function createFarcasterRouter(_config: AuthConfig) {
  return new Elysia({ name: 'farcaster', prefix: '/farcaster' })
    .get(
      '/init',
      async ({ query }) => {
        const { client_id: clientId, redirect_uri: redirectUri, state } = query

        const nonce = crypto.randomUUID()
        const domain = 'auth.jejunetwork.org'

        farcasterChallenges.set(nonce, {
          nonce,
          domain,
          clientId,
          redirectUri,
          state,
          expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
        })

        // Generate QR code data URL for Warpcast deep link
        const warpcastUri = `https://warpcast.com/~/sign-in-with-farcaster?nonce=${nonce}&domain=${domain}`
        const qrDataUrl = await generateQRDataUrl(warpcastUri)

        // Return Farcaster auth page
        return new Response(
          `<!DOCTYPE html>
<html>
<head>
  <title>Farcaster Sign In - Jeju Network</title>
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
      border: 1px solid rgba(138, 99, 210, 0.3);
      border-radius: 16px;
      padding: 48px;
      max-width: 420px;
      width: 90%;
      text-align: center;
    }
    .logo { font-size: 48px; margin-bottom: 16px; }
    .title { font-size: 24px; font-weight: 600; margin-bottom: 8px; color: #fff; }
    .subtitle { color: #888; font-size: 14px; margin-bottom: 32px; }
    .qr-container {
      width: 200px;
      height: 200px;
      margin: 0 auto 24px;
      background: #fff;
      border-radius: 12px;
      padding: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .qr-container img { width: 100%; height: 100%; }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 14px 28px;
      border: none;
      border-radius: 12px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      text-decoration: none;
      background: linear-gradient(135deg, #8a63d2 0%, #6944ba 100%);
      color: #fff;
    }
    .btn:hover { opacity: 0.9; transform: translateY(-1px); }
    .or { margin: 24px 0; color: #666; font-size: 12px; }
    .manual-input { display: none; margin-top: 24px; }
    .manual-input.show { display: block; }
    .input-group { margin-bottom: 16px; }
    .input-group label {
      display: block;
      text-align: left;
      font-size: 12px;
      color: #888;
      margin-bottom: 4px;
    }
    .input-group input {
      width: 100%;
      padding: 12px;
      border: 1px solid rgba(138, 99, 210, 0.3);
      border-radius: 8px;
      background: rgba(0, 0, 0, 0.3);
      color: #fff;
      font-family: inherit;
      font-size: 14px;
    }
    .input-group input:focus { outline: none; border-color: #8a63d2; }
    .status { margin-top: 16px; font-size: 14px; color: #888; }
    .status.error { color: #ff6b6b; }
    .status.success { color: #64ffda; }
  </style>
</head>
<body>
  <div class="container">
    <div class="logo">🟣</div>
    <div class="title">Sign in with Farcaster</div>
    <div class="subtitle">Scan the QR code with Warpcast or sign manually</div>
    
    <div class="qr-container">
      <img src="${qrDataUrl}" alt="Scan with Warpcast">
    </div>
    
    <a href="${warpcastUri}" target="_blank" class="btn">
      Open Warpcast
    </a>
    
    <div class="or">or sign manually</div>
    
    <button id="showManual" style="background: transparent; border: 1px solid rgba(138, 99, 210, 0.3); color: #888; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 12px;">
      Manual Sign-In
    </button>
    
    <div id="manualInput" class="manual-input">
      <div class="input-group">
        <label>FID (Farcaster ID)</label>
        <input type="number" id="fid" placeholder="e.g. 1234">
      </div>
      <div class="input-group">
        <label>Custody Address</label>
        <input type="text" id="custody" placeholder="0x...">
      </div>
      <button id="signBtn" class="btn" style="width: 100%; margin-top: 8px;">
        Sign Message
      </button>
    </div>
    
    <div id="status" class="status"></div>
  </div>

  <script>
    const nonce = '${nonce}';
    const domain = '${domain}';
    
    document.getElementById('showManual').addEventListener('click', () => {
      document.getElementById('manualInput').classList.toggle('show');
    });
    
    document.getElementById('signBtn').addEventListener('click', async () => {
      const status = document.getElementById('status');
      const fid = document.getElementById('fid').value;
      const custody = document.getElementById('custody').value;
      
      if (!fid || !custody) {
        status.textContent = 'Please enter FID and custody address';
        status.className = 'status error';
        return;
      }
      
      if (!window.ethereum) {
        status.textContent = 'No wallet detected';
        status.className = 'status error';
        return;
      }
      
      try {
        status.textContent = 'Signing...';
        status.className = 'status';
        
        const message = \`${domain} wants you to sign in with your Ethereum account:
\${custody}

Sign in with Farcaster

URI: https://${domain}
Version: 1
Chain ID: 10
Nonce: ${nonce}
Issued At: \${new Date().toISOString()}
Resources:
- farcaster://fid/\${fid}\`;
        
        const signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [message, custody]
        });
        
        status.textContent = 'Verifying...';
        
        const response = await fetch('/farcaster/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce: '${nonce}',
            message,
            signature,
            fid: parseInt(fid, 10),
            custody
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
        status.textContent = err.message || 'Sign-in failed';
        status.className = 'status error';
      }
    });
  </script>
</body>
</html>`,
          { headers: { 'Content-Type': 'text/html' } },
        )
      },
      { query: InitQuerySchema },
    )

    .post(
      '/verify',
      async ({ body, set }) => {
        if (!isAddress(body.custody)) {
          set.status = 400
          return { error: 'invalid_custody_address' }
        }
        if (!isHex(body.signature)) {
          set.status = 400
          return { error: 'invalid_signature_format' }
        }

        const custody: Address = body.custody
        const signature: Hex = body.signature

        const challenge = farcasterChallenges.get(body.nonce)
        if (!challenge) {
          set.status = 400
          return { error: 'invalid_nonce' }
        }

        if (challenge.expiresAt < Date.now()) {
          farcasterChallenges.delete(body.nonce)
          set.status = 400
          return { error: 'expired_challenge' }
        }

        // Verify signature
        const valid = await verifyMessage({
          address: custody,
          message: body.message,
          signature: signature,
        })

        if (!valid) {
          set.status = 400
          return { error: 'invalid_signature' }
        }

        // Create authorization code
        const code = crypto.randomUUID()
        const userId = `farcaster:${body.fid}`

        await authCodeState.save(code, {
          clientId: challenge.clientId,
          redirectUri: challenge.redirectUri,
          userId,
          scope: ['openid', 'profile', 'farcaster'],
          expiresAt: Date.now() + 5 * 60 * 1000,
        })

        // Create session
        const sessionId = crypto.randomUUID()
        await sessionState.save({
          sessionId,
          userId,
          provider: 'farcaster',
          fid: body.fid,
          address: custody,
          createdAt: Date.now(),
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          metadata: {},
        })

        // Clean up challenge
        farcasterChallenges.delete(body.nonce)

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
}

/**
 * Generate a QR code as a data URL using a simple SVG-based approach
 * For production, you'd want to use a proper QR library
 */
async function generateQRDataUrl(data: string): Promise<string> {
  // Simple placeholder - in production use a QR library like 'qrcode'
  // For now, encode the URL so users can at least click the link
  const _encodedData = encodeURIComponent(data)

  // Create a simple SVG QR placeholder with the link
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="200" height="200">
      <rect width="200" height="200" fill="white"/>
      <rect x="20" y="20" width="40" height="40" fill="black"/>
      <rect x="140" y="20" width="40" height="40" fill="black"/>
      <rect x="20" y="140" width="40" height="40" fill="black"/>
      <rect x="30" y="30" width="20" height="20" fill="white"/>
      <rect x="35" y="35" width="10" height="10" fill="black"/>
      <rect x="150" y="30" width="20" height="20" fill="white"/>
      <rect x="155" y="35" width="10" height="10" fill="black"/>
      <rect x="30" y="150" width="20" height="20" fill="white"/>
      <rect x="35" y="155" width="10" height="10" fill="black"/>
      <!-- QR pattern approximation -->
      <rect x="80" y="20" width="10" height="10" fill="black"/>
      <rect x="100" y="20" width="10" height="10" fill="black"/>
      <rect x="80" y="40" width="10" height="10" fill="black"/>
      <rect x="100" y="40" width="10" height="10" fill="black"/>
      <rect x="90" y="30" width="10" height="10" fill="black"/>
      <rect x="20" y="80" width="10" height="10" fill="black"/>
      <rect x="40" y="80" width="10" height="10" fill="black"/>
      <rect x="20" y="100" width="10" height="10" fill="black"/>
      <rect x="40" y="100" width="10" height="10" fill="black"/>
      <rect x="160" y="80" width="10" height="10" fill="black"/>
      <rect x="160" y="100" width="10" height="10" fill="black"/>
      <rect x="80" y="80" width="40" height="40" fill="black"/>
      <rect x="90" y="90" width="20" height="20" fill="white"/>
      <rect x="95" y="95" width="10" height="10" fill="black"/>
      <rect x="80" y="140" width="10" height="10" fill="black"/>
      <rect x="100" y="140" width="10" height="10" fill="black"/>
      <rect x="80" y="160" width="10" height="10" fill="black"/>
      <rect x="100" y="160" width="10" height="10" fill="black"/>
      <rect x="140" y="140" width="40" height="40" fill="black"/>
      <rect x="150" y="150" width="20" height="20" fill="white"/>
      <rect x="155" y="155" width="10" height="10" fill="black"/>
    </svg>
  `

  // Convert SVG to data URL
  const base64 = btoa(svg)
  return `data:image/svg+xml;base64,${base64}`
}
