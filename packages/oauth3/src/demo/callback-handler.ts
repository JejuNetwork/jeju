/**
 * OAuth3 Callback Handler
 * 
 * Minimal HTML page that handles OAuth callbacks and sends
 * the authorization code back to the opener window.
 */

export function generateCallbackHtml(origin: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OAuth3 - Authentication Complete</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container {
      background: white;
      padding: 3rem;
      border-radius: 1rem;
      box-shadow: 0 20px 60px rgba(0,0,0,0.2);
      text-align: center;
      max-width: 400px;
    }
    .spinner {
      width: 50px;
      height: 50px;
      border: 4px solid #f3f3f3;
      border-top: 4px solid #667eea;
      border-radius: 50%;
      animation: spin 1s linear infinite;
      margin: 0 auto 1.5rem;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    h1 { color: #333; margin-bottom: 0.5rem; font-size: 1.5rem; }
    p { color: #666; }
    .success { display: none; }
    .success svg { width: 50px; height: 50px; margin-bottom: 1rem; }
    .error { display: none; color: #e74c3c; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <div class="loading">
      <div class="spinner"></div>
      <h1>Completing Authentication</h1>
      <p>Please wait while we verify your credentials...</p>
    </div>
    <div class="success">
      <svg viewBox="0 0 52 52" fill="none">
        <circle cx="26" cy="26" r="25" fill="#22c55e"/>
        <path stroke="white" stroke-width="4" stroke-linecap="round" d="M14 27l8 8 16-16"/>
      </svg>
      <h1>Authentication Successful</h1>
      <p>You can close this window.</p>
    </div>
    <p class="error"></p>
  </div>
  <script>
    (function() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const error = params.get('error');
      const errorDescription = params.get('error_description');
      
      const origin = '${origin}';
      
      function showSuccess() {
        document.querySelector('.loading').style.display = 'none';
        document.querySelector('.success').style.display = 'block';
      }
      
      function showError(message) {
        document.querySelector('.loading').style.display = 'none';
        document.querySelector('.error').style.display = 'block';
        document.querySelector('.error').textContent = message;
      }
      
      if (error) {
        showError(errorDescription || error);
        if (window.opener) {
          window.opener.postMessage({ error, error_description: errorDescription }, origin);
        }
        return;
      }
      
      if (!code || !state) {
        showError('Missing authorization code or state');
        return;
      }
      
      if (window.opener) {
        window.opener.postMessage({ code, state }, origin);
        showSuccess();
        setTimeout(() => window.close(), 1500);
      } else {
        showSuccess();
        document.querySelector('.success p').textContent = 
          'Authentication complete. Return to the app to continue.';
      }
    })();
  </script>
</body>
</html>`;
}

/**
 * Creates a simple Hono route handler for OAuth callbacks
 */
export function createCallbackRoute(allowedOrigins: string[]) {
  return (c: { req: { url: string }; html: (content: string) => Response }) => {
    const url = new URL(c.req.url);
    const origin = url.searchParams.get('origin') || allowedOrigins[0] || '*';
    return c.html(generateCallbackHtml(origin));
  };
}
