import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./web/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Sora', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        crucible: {
          // Electric blue - primary brand
          primary: '#3B82F6',
          'primary-dark': '#2563EB',
          'primary-light': '#60A5FA',
          // Cyber teal - accent
          accent: '#06B6D4',
          'accent-dark': '#0891B2',
          'accent-light': '#22D3EE',
          // Neon purple for contrast
          purple: '#8B5CF6',
          'purple-dark': '#7C3AED',
          'purple-light': '#A78BFA',
          // Ember orange for warnings/highlights
          ember: '#F97316',
          'ember-dark': '#EA580C',
          'ember-light': '#FB923C',
          // Status colors
          success: '#10B981',
          error: '#EF4444',
          warning: '#F59E0B',
          info: '#3B82F6',
        },
        // Light mode surfaces
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
        // Dark mode surfaces
        dark: {
          bg: '#0A0E17',
          'bg-secondary': '#111827',
          'bg-tertiary': '#1E293B',
          surface: '#1E293B',
          'surface-elevated': '#334155',
          border: '#334155',
          'border-strong': '#475569',
          text: '#F8FAFC',
          'text-secondary': '#CBD5E1',
          'text-tertiary': '#64748B',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-crucible':
          'linear-gradient(135deg, var(--tw-gradient-stops))',
        'gradient-cyber':
          'linear-gradient(135deg, #3B82F6 0%, #8B5CF6 50%, #06B6D4 100%)',
        'gradient-electric':
          'linear-gradient(135deg, #3B82F6 0%, #2563EB 100%)',
        'gradient-neon': 'linear-gradient(135deg, #8B5CF6 0%, #06B6D4 100%)',
        'mesh-light': `
          radial-gradient(at 40% 20%, rgba(59, 130, 246, 0.12) 0px, transparent 50%),
          radial-gradient(at 80% 0%, rgba(139, 92, 246, 0.08) 0px, transparent 50%),
          radial-gradient(at 0% 50%, rgba(6, 182, 212, 0.08) 0px, transparent 50%),
          radial-gradient(at 80% 50%, rgba(59, 130, 246, 0.06) 0px, transparent 50%),
          radial-gradient(at 0% 100%, rgba(139, 92, 246, 0.06) 0px, transparent 50%)
        `,
        'mesh-dark': `
          radial-gradient(at 40% 20%, rgba(59, 130, 246, 0.15) 0px, transparent 50%),
          radial-gradient(at 80% 0%, rgba(139, 92, 246, 0.12) 0px, transparent 50%),
          radial-gradient(at 0% 50%, rgba(6, 182, 212, 0.10) 0px, transparent 50%),
          radial-gradient(at 80% 50%, rgba(59, 130, 246, 0.08) 0px, transparent 50%),
          radial-gradient(at 0% 100%, rgba(139, 92, 246, 0.08) 0px, transparent 50%)
        `,
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(59, 130, 246, 0.4)',
        'glow-accent': '0 0 20px rgba(6, 182, 212, 0.4)',
        'glow-purple': '0 0 20px rgba(139, 92, 246, 0.4)',
        'card-light': '0 4px 20px rgba(0, 0, 0, 0.06)',
        'card-dark': '0 4px 20px rgba(0, 0, 0, 0.4)',
        'card-hover-light': '0 8px 30px rgba(59, 130, 246, 0.12)',
        'card-hover-dark': '0 8px 30px rgba(59, 130, 246, 0.2)',
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
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'bounce-subtle': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
    },
  },
  plugins: [],
}

export default config
