/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    screens: {
      'xs': '375px',
      'sm': '640px',
      'md': '768px',
      'lg': '1024px',
      'xl': '1280px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-geist)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        storage: {
          // Cosmic cyan - primary brand (futuristic data)
          primary: '#00E5FF',
          'primary-dark': '#00B8D4',
          'primary-light': '#6EFFFF',
          // Electric violet - accent (digital storage)
          accent: '#8B5CF6',
          'accent-dark': '#7C3AED',
          'accent-light': '#A78BFA',
          // Neon green - success/online
          success: '#00FF88',
          'success-dark': '#00CC6A',
          // Hot pink - attention
          hot: '#FF006E',
          'hot-dark': '#CC0058',
          // Status colors
          error: '#FF3B3B',
          warning: '#FFB800',
          info: '#00B4FF',
        },
        // Light mode surfaces - clean futuristic white
        light: {
          bg: '#F8FAFC',
          'bg-secondary': '#F1F5F9',
          'bg-tertiary': '#E2E8F0',
          surface: '#FFFFFF',
          'surface-elevated': '#FFFFFF',
          border: '#E2E8F0',
          'border-strong': '#CBD5E1',
          text: '#0F172A',
          'text-secondary': '#475569',
          'text-tertiary': '#94A3B8',
        },
        // Dark mode surfaces - deep space
        dark: {
          bg: '#030712',
          'bg-secondary': '#0D1117',
          'bg-tertiary': '#161B22',
          surface: '#161B22',
          'surface-elevated': '#21262D',
          border: '#30363D',
          'border-strong': '#484F58',
          text: '#F0F6FC',
          'text-secondary': '#8B949E',
          'text-tertiary': '#6E7681',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-storage': 'linear-gradient(135deg, #00E5FF 0%, #8B5CF6 50%, #FF006E 100%)',
        'gradient-data': 'linear-gradient(135deg, #00E5FF 0%, #00B8D4 100%)',
        'gradient-cosmic': 'linear-gradient(135deg, #8B5CF6 0%, #00E5FF 100%)',
        'mesh-light': `
          radial-gradient(at 40% 20%, rgba(0, 229, 255, 0.08) 0px, transparent 50%),
          radial-gradient(at 80% 0%, rgba(139, 92, 246, 0.06) 0px, transparent 50%),
          radial-gradient(at 0% 50%, rgba(0, 255, 136, 0.05) 0px, transparent 50%),
          radial-gradient(at 80% 50%, rgba(0, 229, 255, 0.04) 0px, transparent 50%),
          radial-gradient(at 0% 100%, rgba(255, 0, 110, 0.04) 0px, transparent 50%)
        `,
        'mesh-dark': `
          radial-gradient(at 40% 20%, rgba(0, 229, 255, 0.15) 0px, transparent 50%),
          radial-gradient(at 80% 0%, rgba(139, 92, 246, 0.12) 0px, transparent 50%),
          radial-gradient(at 0% 50%, rgba(0, 255, 136, 0.08) 0px, transparent 50%),
          radial-gradient(at 80% 50%, rgba(0, 229, 255, 0.06) 0px, transparent 50%),
          radial-gradient(at 0% 100%, rgba(255, 0, 110, 0.08) 0px, transparent 50%)
        `,
        'grid-lines': `
          linear-gradient(to right, rgba(0, 229, 255, 0.03) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(0, 229, 255, 0.03) 1px, transparent 1px)
        `,
      },
      boxShadow: {
        'glow-primary': '0 0 25px rgba(0, 229, 255, 0.4)',
        'glow-accent': '0 0 25px rgba(139, 92, 246, 0.4)',
        'glow-success': '0 0 25px rgba(0, 255, 136, 0.4)',
        'card-light': '0 4px 24px rgba(0, 0, 0, 0.06)',
        'card-dark': '0 4px 24px rgba(0, 0, 0, 0.5)',
        'card-hover-light': '0 8px 32px rgba(0, 229, 255, 0.15)',
        'card-hover-dark': '0 8px 32px rgba(0, 229, 255, 0.25)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
        'data-flow': 'data-flow 3s linear infinite',
        'scan-line': 'scan-line 4s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 25px rgba(0, 229, 255, 0.4)' },
          '50%': { opacity: '0.8', boxShadow: '0 0 40px rgba(0, 229, 255, 0.6)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        'data-flow': {
          '0%': { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '100% 100%' },
        },
        'scan-line': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
      },
    },
  },
  plugins: [],
}

