/**
 * Shared HTML templates and styles for OAuth3 pages
 * DRY approach to consistent styling across all auth pages
 */

/**
 * HTML escape to prevent XSS in rendered templates.
 */
export function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/**
 * JS string escape for template literals.
 */
export function escapeJsString(unsafe: string): string {
  return unsafe
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
}

/**
 * Shared CSS styles for all auth pages
 */
export const sharedStyles = `
  :root {
    --bg-base: #fafbfc;
    --bg-card: #ffffff;
    --bg-elevated: #f0f4f8;
    --accent-primary: #6366f1;
    --accent-primary-light: #818cf8;
    --accent-primary-dark: #4f46e5;
    --accent-secondary: #06b6d4;
    --accent-farcaster: #8a63d2;
    --accent-success: #10b981;
    --accent-error: #ef4444;
    --gradient-primary: linear-gradient(135deg, #6366f1 0%, #06b6d4 50%, #10b981 100%);
    --gradient-farcaster: linear-gradient(135deg, #8a63d2 0%, #6944ba 100%);
    --text-primary: #1e293b;
    --text-secondary: #64748b;
    --text-muted: #94a3b8;
    --border-light: rgba(99, 102, 241, 0.15);
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
    --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.08), 0 2px 4px -1px rgba(0, 0, 0, 0.04);
    --shadow-lg: 0 10px 25px -5px rgba(99, 102, 241, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.08);
    --radius-sm: 8px;
    --radius-md: 12px;
    --radius-lg: 16px;
    --radius-xl: 20px;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }
  
  *:focus-visible {
    outline: 2px solid var(--accent-primary);
    outline-offset: 2px;
  }

  body {
    font-family: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    background: var(--bg-base);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-primary);
    padding: 24px;
    line-height: 1.5;
    -webkit-font-smoothing: antialiased;
  }

  .bg-pattern {
    position: fixed;
    inset: 0;
    background-image: 
      radial-gradient(circle at 25% 25%, rgba(99, 102, 241, 0.06) 0%, transparent 50%),
      radial-gradient(circle at 75% 75%, rgba(6, 182, 212, 0.06) 0%, transparent 50%);
    pointer-events: none;
    z-index: 0;
  }

  .card {
    position: relative;
    background: var(--bg-card);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-xl);
    padding: 40px;
    max-width: 420px;
    width: 100%;
    box-shadow: var(--shadow-lg);
    z-index: 1;
  }

  .logo {
    font-size: 28px;
    font-weight: 800;
    background: var(--gradient-primary);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
    text-align: center;
    margin-bottom: 8px;
    letter-spacing: -0.5px;
  }

  .subtitle {
    text-align: center;
    color: var(--text-secondary);
    font-size: 14px;
    margin-bottom: 32px;
  }

  .client-name {
    text-align: center;
    font-size: 16px;
    margin-bottom: 24px;
    color: var(--text-primary);
    font-weight: 500;
    padding: 12px;
    background: var(--bg-elevated);
    border-radius: var(--radius-md);
  }

  .providers {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .provider-btn {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 16px 20px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-primary);
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s ease;
    text-decoration: none;
    font-family: inherit;
  }

  .provider-btn:hover {
    background: var(--bg-elevated);
    border-color: var(--accent-primary);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .provider-btn.primary {
    background: var(--accent-primary);
    color: white;
    border: none;
    font-weight: 600;
    box-shadow: var(--shadow-sm);
  }

  .provider-btn.primary:hover {
    background: var(--accent-primary-dark);
    box-shadow: var(--shadow-md);
  }

  .provider-btn.farcaster {
    background: var(--gradient-farcaster);
    color: white;
    border: none;
    font-weight: 600;
  }

  .provider-btn.farcaster:hover {
    opacity: 0.9;
    transform: translateY(-2px);
  }

  .provider-btn .icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 20px;
  }

  .divider {
    display: flex;
    align-items: center;
    margin: 24px 0;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .divider::before,
  .divider::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border-light);
  }

  .divider span {
    padding: 0 16px;
  }

  .message-box {
    background: var(--bg-elevated);
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    padding: 16px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
    white-space: pre-wrap;
    margin-bottom: 24px;
    color: var(--text-secondary);
    line-height: 1.6;
  }

  .btn {
    width: 100%;
    padding: 16px;
    border: none;
    border-radius: var(--radius-md);
    font-size: 16px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
    font-family: inherit;
    background: var(--accent-primary);
    color: white;
    box-shadow: var(--shadow-sm);
  }

  .btn:hover {
    background: var(--accent-primary-dark);
    transform: translateY(-2px);
    box-shadow: var(--shadow-md);
  }

  .btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
    transform: none;
  }

  .btn-secondary {
    background: var(--bg-elevated);
    color: var(--text-primary);
    border: 1px solid var(--border-light);
    box-shadow: none;
  }

  .btn-secondary:hover {
    background: var(--bg-card);
    border-color: var(--accent-primary);
  }

  .status {
    text-align: center;
    margin-top: 16px;
    font-size: 14px;
    color: var(--text-secondary);
    min-height: 20px;
  }

  .status.error {
    color: var(--accent-error);
  }

  .status.success {
    color: var(--accent-success);
  }

  .address-badge {
    font-family: 'JetBrains Mono', monospace;
    background: var(--bg-elevated);
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    font-size: 12px;
    color: var(--accent-primary);
  }

  .qr-container {
    width: 200px;
    height: 200px;
    margin: 0 auto 24px;
    background: white;
    border-radius: var(--radius-lg);
    padding: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--border-light);
    box-shadow: var(--shadow-sm);
  }

  .qr-container img {
    width: 100%;
    height: 100%;
    border-radius: var(--radius-sm);
  }

  .input-group {
    margin-bottom: 16px;
  }

  .input-group label {
    display: block;
    text-align: left;
    font-size: 13px;
    color: var(--text-secondary);
    margin-bottom: 6px;
    font-weight: 500;
  }

  .input-group input {
    width: 100%;
    padding: 14px;
    border: 1px solid var(--border-light);
    border-radius: var(--radius-md);
    background: var(--bg-card);
    color: var(--text-primary);
    font-family: inherit;
    font-size: 14px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }

  .input-group input:focus {
    outline: none;
    border-color: var(--accent-primary);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.1);
  }

  .input-group input::placeholder {
    color: var(--text-muted);
  }

  .footer {
    text-align: center;
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--border-light);
    font-size: 13px;
    color: var(--text-muted);
  }

  .footer a {
    color: var(--accent-primary);
    text-decoration: none;
    font-weight: 500;
  }

  .footer a:hover {
    text-decoration: underline;
  }

  .manual-toggle {
    background: transparent;
    border: 1px solid var(--border-light);
    color: var(--text-secondary);
    padding: 10px 20px;
    border-radius: var(--radius-md);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.2s ease;
    font-family: inherit;
  }

  .manual-toggle:hover {
    background: var(--bg-elevated);
    border-color: var(--accent-primary);
  }

  .manual-input {
    display: none;
    margin-top: 24px;
    padding-top: 24px;
    border-top: 1px solid var(--border-light);
  }

  .manual-input.show {
    display: block;
  }

  .icon-large {
    font-size: 48px;
    line-height: 1;
    margin-bottom: 16px;
    text-align: center;
  }

  .title {
    font-size: 22px;
    font-weight: 700;
    text-align: center;
    margin-bottom: 8px;
    color: var(--text-primary);
  }

  @media (max-width: 480px) {
    .card {
      padding: 28px 20px;
    }

    .provider-btn {
      padding: 14px 16px;
      font-size: 14px;
    }

    .qr-container {
      width: 180px;
      height: 180px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    * {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }
`

/**
 * Generate complete HTML page with shared styles
 */
export function createHtmlPage(options: {
  title: string
  content: string
  scripts?: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <title>${escapeHtml(options.title)} · Jeju</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
  <style>${sharedStyles}</style>
</head>
<body>
  <div class="bg-pattern" aria-hidden="true"></div>
  ${options.content}
  ${options.scripts ? `<script>${options.scripts}</script>` : ''}
</body>
</html>`
}
