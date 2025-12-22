/**
 * HTML Response Utilities
 * Shared HTML generation for UI pages
 */

/**
 * Escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const htmlChars: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }
  return text.replace(/[&<>"']/g, (char) => htmlChars[char] ?? char)
}

/**
 * Escape string for use in JavaScript (JSON-safe encoding)
 */
function escapeJs(text: string): string {
  return JSON.stringify(text).slice(1, -1)
}

/**
 * Generate error HTML page
 */
export function createErrorHtml(title: string, message: string): string {
  return `
    <html>
      <body style="font-family: system-ui; padding: 2rem; text-align: center; background: #1a1a2e; color: #fff;">
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(message)}</p>
      </body>
    </html>
  `
}

/**
 * Generate success HTML page for wallet connection
 */
export function createWalletConnectedHtml(
  address: string,
  platform: string,
): string {
  // Validate address format (0x followed by 40 hex chars)
  if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
    throw new Error('Invalid address format')
  }

  const safePlatform = escapeHtml(platform)
  const jsAddress = escapeJs(address)

  return `
    <html>
      <body style="font-family: system-ui; padding: 2rem; text-align: center; background: #1a1a2e; color: #fff;">
        <h1>✅ Wallet Connected</h1>
        <p>Your wallet has been connected to Otto.</p>
        <p>You can now close this window and return to ${safePlatform}.</p>
        <script>
          // Try to close window or redirect
          // Post message only to same origin to prevent XSS/wallet hijacking
          if (window.opener) {
            window.opener.postMessage({ type: 'wallet_connected', address: '${jsAddress}' }, window.location.origin);
          }
          setTimeout(() => window.close(), 2000);
        </script>
      </body>
    </html>
  `
}
