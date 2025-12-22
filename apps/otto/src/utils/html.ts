/**
 * HTML Response Utilities
 * Shared HTML generation for UI pages
 */

/**
 * Generate error HTML page
 */
export function createErrorHtml(title: string, message: string): string {
  return `
    <html>
      <body style="font-family: system-ui; padding: 2rem; text-align: center; background: #1a1a2e; color: #fff;">
        <h1>${title}</h1>
        <p>${message}</p>
      </body>
    </html>
  `;
}

/**
 * Generate success HTML page for wallet connection
 */
export function createWalletConnectedHtml(address: string, platform: string): string {
  return `
    <html>
      <body style="font-family: system-ui; padding: 2rem; text-align: center; background: #1a1a2e; color: #fff;">
        <h1>✅ Wallet Connected</h1>
        <p>Your wallet has been connected to Otto.</p>
        <p>You can now close this window and return to ${platform}.</p>
        <script>
          // Try to close window or redirect
          if (window.opener) {
            window.opener.postMessage({ type: 'wallet_connected', address: '${address}' }, '*');
          }
          setTimeout(() => window.close(), 2000);
        </script>
      </body>
    </html>
  `;
}
