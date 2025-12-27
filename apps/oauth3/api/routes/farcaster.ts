/**
 * Farcaster authentication routes
 */

import { Elysia, t } from 'elysia'
import QRCode from 'qrcode'
import type { Address, Hex } from 'viem'
import { isAddress, isHex, verifyMessage } from 'viem'
import type { AuthConfig } from '../../lib/types'
import { createHtmlPage, escapeJsString } from '../shared/html-templates'
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

/**
 * Generate Farcaster sign-in page HTML
 */
function generateFarcasterPage(
  nonce: string,
  domain: string,
  qrDataUrl: string,
  warpcastUri: string,
): string {
  const content = `
  <main class="card" role="main">
    <div class="icon-large" aria-hidden="true">🟣</div>
    <div class="title">Farcaster Sign-In</div>
    <div class="subtitle">Scan with Warpcast or enter your FID below</div>
    
    <div class="qr-container">
      <img src="${qrDataUrl}" alt="Scan with Warpcast app to sign in" role="img">
    </div>
    
    <a href="${warpcastUri}" target="_blank" rel="noopener noreferrer" class="provider-btn farcaster" role="button">
      <span class="icon" aria-hidden="true">📱</span>
      Open Warpcast
    </a>
    
    <div class="divider" role="separator"><span>or sign manually</span></div>
    
    <button id="showManual" class="manual-toggle" type="button" aria-expanded="false" aria-controls="manualInput">
      Enter Details Manually
    </button>
    
    <div id="manualInput" class="manual-input" aria-hidden="true">
      <div class="input-group">
        <label for="fid">FID (Farcaster ID)</label>
        <input type="number" id="fid" placeholder="e.g. 1234" inputmode="numeric" autocomplete="off">
      </div>
      <div class="input-group">
        <label for="custody">Custody Address</label>
        <input type="text" id="custody" placeholder="0x..." autocomplete="off">
      </div>
      <button id="signBtn" class="btn" type="button">
        Sign Message
      </button>
    </div>
    
    <div id="status" class="status" role="status" aria-live="polite"></div>
    
    <footer class="footer">
      <a href="https://jejunetwork.org">Jeju Network</a>
    </footer>
  </main>
  <style>
    .icon-large { display: block; }
  </style>`

  const scripts = `
    const nonce = '${escapeJsString(nonce)}';
    const domain = '${escapeJsString(domain)}';
    
    const showManualBtn = document.getElementById('showManual');
    const manualInput = document.getElementById('manualInput');
    
    showManualBtn.addEventListener('click', () => {
      const isExpanded = showManualBtn.getAttribute('aria-expanded') === 'true';
      showManualBtn.setAttribute('aria-expanded', !isExpanded);
      manualInput.classList.toggle('show');
      manualInput.setAttribute('aria-hidden', isExpanded);
      if (!isExpanded) {
        document.getElementById('fid').focus();
      }
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
        status.textContent = 'No wallet found. Install MetaMask to sign manually.';
        status.className = 'status error';
        return;
      }
      
      try {
        status.textContent = 'Signing...';
        status.className = 'status';
        
        const message = domain + ' wants you to sign in with your Ethereum account:\\n' +
          custody + '\\n\\n' +
          'Sign in with Farcaster\\n\\n' +
          'URI: https://' + domain + '\\n' +
          'Version: 1\\n' +
          'Chain ID: 10\\n' +
          'Nonce: ' + nonce + '\\n' +
          'Issued At: ' + new Date().toISOString() + '\\n' +
          'Resources:\\n' +
          '- farcaster://fid/' + fid;
        
        const signature = await window.ethereum.request({
          method: 'personal_sign',
          params: [message, custody]
        });
        
        status.textContent = 'Verifying...';
        
        const response = await fetch('/farcaster/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nonce,
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
  `

  return createHtmlPage({
    title: 'Farcaster Sign In',
    content,
    scripts,
  })
}

export function createFarcasterRouter(_config: AuthConfig) {
  return new Elysia({ name: 'farcaster', prefix: '/farcaster' })
    .get(
      '/init',
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

        const html = generateFarcasterPage(nonce, domain, qrDataUrl, warpcastUri)
        return new Response(html, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        })
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

        // Validate message content matches expected values
        const messageValidation = validateFarcasterMessage(
          body.message,
          challenge.domain,
          custody,
          body.nonce,
          body.fid,
        )
        if (!messageValidation.valid) {
          set.status = 400
          return {
            error: 'invalid_message',
            error_description: messageValidation.error,
          }
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
 * Validate the Farcaster SIWE message contains expected values.
 * This prevents attackers from using signed messages with wrong domain/nonce/fid.
 */
function validateFarcasterMessage(
  message: string,
  expectedDomain: string,
  expectedAddress: Address,
  expectedNonce: string,
  expectedFid: number,
): { valid: boolean; error?: string } {
  // Check domain
  if (
    !message.startsWith(
      `${expectedDomain} wants you to sign in with your Ethereum account:`,
    )
  ) {
    return { valid: false, error: 'invalid_domain' }
  }

  // Check address is in message
  if (!message.includes(expectedAddress)) {
    return { valid: false, error: 'invalid_address' }
  }

  // Check nonce
  if (!message.includes(`Nonce: ${expectedNonce}`)) {
    return { valid: false, error: 'invalid_nonce' }
  }

  // Check FID resource
  if (!message.includes(`farcaster://fid/${expectedFid}`)) {
    return { valid: false, error: 'invalid_fid' }
  }

  // Check issued at is recent (within 10 minutes)
  const issuedAtMatch = message.match(
    /Issued At: (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z?)/,
  )
  if (!issuedAtMatch) {
    return { valid: false, error: 'missing_issued_at' }
  }

  const issuedAt = new Date(issuedAtMatch[1]).getTime()
  if (
    Number.isNaN(issuedAt) ||
    Math.abs(Date.now() - issuedAt) > 10 * 60 * 1000
  ) {
    return { valid: false, error: 'message_too_old' }
  }

  return { valid: true }
}

/**
 * Generate a QR code as a data URL
 */
async function generateQRDataUrl(data: string): Promise<string> {
  return QRCode.toDataURL(data, {
    width: 200,
    margin: 2,
    color: {
      dark: '#1e293b',
      light: '#ffffff',
    },
  })
}
