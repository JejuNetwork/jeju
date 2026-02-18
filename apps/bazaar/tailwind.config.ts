import type { Config } from 'tailwindcss'

/**
 * Tailwind CSS Configuration for Nocturne Bazaar Theme
 *
 * Design System:
 * - Deep indigo background (#070816)
 * - Amber glow accents (#ffb43a)
 * - Cyan neon secondary (#00f2ff)
 * - Nebula purple depth (#1e1140)
 * - Outfit + JetBrains Mono fonts
 */
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './web/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'Outfit', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Outfit', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'JetBrains Mono', 'monospace'],
      },
      colors: {
        bazaar: {
          // Amber glow - primary brand
          primary: '#ffb43a',
          'primary-dark': '#e59a20',
          'primary-light': '#ffc566',
          // Cyan neon - accent
          accent: '#00f2ff',
          'accent-dark': '#00c4cf',
          'accent-light': '#4df7ff',
          // Silk violet - tertiary
          violet: '#4c1d95',
          'violet-dark': '#3b1578',
          'violet-light': '#6d28d9',
          // Status colors
          success: '#10B981',
          error: '#EF4444',
          warning: '#F59E0B',
          info: '#3B82F6',
        },
        // Light mode surfaces
        light: {
          bg: '#f8f7fc',
          'bg-secondary': '#efedf5',
          'bg-tertiary': '#e6e3ef',
          surface: '#ffffff',
          'surface-elevated': '#ffffff',
          border: 'rgba(76, 29, 149, 0.15)',
          'border-strong': 'rgba(76, 29, 149, 0.25)',
          text: '#070816',
          'text-secondary': '#4a4a5a',
          'text-tertiary': '#71717a',
        },
        // Dark mode surfaces - Nocturne Bazaar
        dark: {
          bg: '#070816',
          'bg-secondary': '#0f0c29',
          'bg-tertiary': '#1e1140',
          surface: 'rgba(15, 12, 41, 0.6)',
          'surface-elevated': 'rgba(30, 17, 64, 0.7)',
          border: 'rgba(255, 255, 255, 0.1)',
          'border-strong': 'rgba(255, 255, 255, 0.15)',
          text: '#d4d4d8',
          'text-secondary': '#a1a1aa',
          'text-tertiary': '#71717a',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-bazaar': 'linear-gradient(135deg, var(--tw-gradient-stops))',
        'gradient-nocturne':
          'linear-gradient(135deg, #070816 0%, #0f0c29 50%, #1e1140 100%)',
        'gradient-amber': 'linear-gradient(135deg, #ffb43a 0%, #e59a20 100%)',
        'gradient-cyan': 'linear-gradient(135deg, #00f2ff 0%, #00c4cf 100%)',
        // Compatibility gradients for UI components
        'gradient-warm': 'linear-gradient(135deg, #ffb43a 0%, #e59a20 100%)',
        'gradient-cool': 'linear-gradient(135deg, #00f2ff 0%, #4c1d95 100%)',
        'gradient-sunset':
          'linear-gradient(135deg, #ffb43a 0%, #4c1d95 50%, #00f2ff 100%)',
        // Nebula background gradients
        'nebula-purple': 'radial-gradient(circle, rgba(76, 29, 149, 0.15) 0%, transparent 40%)',
        'nebula-amber': 'radial-gradient(circle, rgba(255, 180, 58, 0.05) 0%, transparent 40%)',
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(255, 180, 58, 0.3)',
        'glow-accent': '0 0 20px rgba(0, 242, 255, 0.3)',
        'glow-violet': '0 0 20px rgba(76, 29, 149, 0.3)',
        'glow-sm': '0 0 15px rgba(255, 180, 58, 0.3)',
        'card-light': '0 20px 40px rgba(0, 0, 0, 0.15)',
        'card-dark': '0 20px 40px rgba(0, 0, 0, 0.4)',
        'card-hover-light': '0 30px 60px rgba(0, 0, 0, 0.2), 0 0 20px rgba(255, 180, 58, 0.1)',
        'card-hover-dark': '0 30px 60px rgba(0, 0, 0, 0.6), 0 0 20px rgba(255, 180, 58, 0.1)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        shimmer: 'shimmer 2s linear infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
        pulse: 'pulse 2s infinite',
        flicker: 'flicker 3s infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-20px) rotate(5deg)' },
        },
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 12px rgba(255, 180, 58, 0.3)' },
          '50%': { boxShadow: '0 0 24px rgba(255, 180, 58, 0.6)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1', transform: 'scale(1)' },
          '50%': { opacity: '0.4', transform: 'scale(1.2)' },
        },
        flicker: {
          '0%, 100%': { opacity: '1', filter: 'blur(0px)' },
          '50%': { opacity: '0.7', filter: 'blur(2px)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
