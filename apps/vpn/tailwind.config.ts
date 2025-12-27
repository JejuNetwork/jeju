import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './web/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Background colors
        surface: {
          DEFAULT: '#0a0a0f',
          elevated: '#12121a',
          hover: '#1a1a25',
        },
        // Accent colors - vibrant greens
        accent: {
          DEFAULT: '#00ff88',
          secondary: '#00cc6a',
          tertiary: '#00aa55',
          muted: '#008844',
        },
        // Border and muted text
        border: '#2a2a35',
        muted: '#606070',
        'muted-light': '#808090',
        // Status colors
        success: '#00ff88',
        warning: '#ffaa00',
        danger: '#ff4444',
      },
      fontFamily: {
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'spin-slow': 'spin-slow 8s linear infinite',
        ripple: 'ripple 1s ease-out forwards',
        'fade-in': 'fade-in 0.3s ease-out forwards',
        'slide-up': 'slide-up 0.3s ease-out forwards',
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 255, 136, 0.15)',
        'glow-lg': '0 0 40px rgba(0, 255, 136, 0.2)',
      },
    },
  },
  plugins: [],
}

export default config
