/**
 * Development HTML Generator
 *
 * Generates development HTML with theme support and Tailwind CDN.
 * For production, apps use their own build scripts with Tailwind CLI.
 */

import type { AppTheme } from './types'

/**
 * Generate development HTML with Tailwind CDN
 */
export function generateDevHtml(theme: AppTheme, title?: string): string {
  const pageTitle = title ?? `${theme.name} - Dev`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0">
  <meta name="theme-color" content="${theme.dark.bg}" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="${theme.light.bg}" media="(prefers-color-scheme: light)">
  <title>${pageTitle}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${theme.fonts.google}" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'class',
      theme: {
        extend: {
          fontFamily: {
            sans: ['${theme.fonts.sans}', 'system-ui', 'sans-serif'],
            display: ['${theme.fonts.display}', 'system-ui', 'sans-serif'],
            mono: ['${theme.fonts.mono}', 'monospace'],
          },
          colors: {
            primary: '${theme.colors.primary}',
            'primary-dark': '${theme.colors.primaryDark}',
            'primary-light': '${theme.colors.primaryLight}',
            accent: '${theme.colors.accent}',
            'accent-dark': '${theme.colors.accentDark}',
            'accent-light': '${theme.colors.accentLight}',
          }
        }
      }
    }
  </script>
  <script>
    (function() {
      try {
        const savedTheme = localStorage.getItem('${theme.storageKey}');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (savedTheme ? savedTheme === 'dark' : prefersDark) {
          document.documentElement.classList.add('dark');
        }
      } catch (e) {}
    })();
  </script>
  <style>
    :root {
      --color-primary: ${theme.colors.primary};
      --color-accent: ${theme.colors.accent};
      --bg-primary: ${theme.light.bg};
      --bg-secondary: ${theme.light.bgSecondary};
      --surface: ${theme.light.surface};
      --border: ${theme.light.border};
      --text-primary: ${theme.light.text};
      --text-secondary: ${theme.light.textSecondary};
    }
    .dark {
      --bg-primary: ${theme.dark.bg};
      --bg-secondary: ${theme.dark.bgSecondary};
      --surface: ${theme.dark.surface};
      --border: ${theme.dark.border};
      --text-primary: ${theme.dark.text};
      --text-secondary: ${theme.dark.textSecondary};
    }
    body {
      font-family: '${theme.fonts.sans}', system-ui, sans-serif;
      background-color: var(--bg-primary);
      color: var(--text-primary);
    }
  </style>
</head>
<body class="font-sans antialiased">
  <div id="root"></div>
  <script type="module" src="/client.js"></script>
</body>
</html>`
}
