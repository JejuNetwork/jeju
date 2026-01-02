import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./web/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Plus Jakarta Sans', 'General Sans', 'system-ui', 'sans-serif'],
        display: ['Outfit', 'Clash Display', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        crucible: {
          // Indigo primary
          primary: '#6366F1',
          'primary-dark': '#4F46E5',
          'primary-light': '#818CF8',
          // Pink accent
          accent: '#F472B6',
          'accent-dark': '#EC4899',
          'accent-light': '#F9A8D4',
          // Teal
          teal: '#14B8A6',
          'teal-dark': '#0D9488',
          'teal-light': '#2DD4BF',
          // Violet
          violet: '#8B5CF6',
          'violet-dark': '#7C3AED',
          'violet-light': '#A78BFA',
          // Amber
          amber: '#F59E0B',
          'amber-dark': '#D97706',
          'amber-light': '#FBBF24',
          // Status
          success: '#10B981',
          error: '#F43F5E',
          warning: '#F59E0B',
          info: '#6366F1',
        },
        light: {
          bg: '#FAFBFC',
          'bg-secondary': '#F1F5F9',
          'bg-tertiary': '#E2E8F0',
          surface: '#FFFFFF',
          'surface-elevated': '#FFFFFF',
          border: '#E2E8F0',
          'border-strong': '#CBD5E1',
          text: '#1E293B',
          'text-secondary': '#475569',
          'text-tertiary': '#94A3B8',
        },
        dark: {
          bg: '#0B0F1A',
          'bg-secondary': '#151B2B',
          'bg-tertiary': '#1E293B',
          surface: '#1A2236',
          'surface-elevated': '#243049',
          border: '#2D3A52',
          'border-strong': '#3D4A66',
          text: '#F8FAFC',
          'text-secondary': '#CBD5E1',
          'text-tertiary': '#64748B',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-crucible':
          'linear-gradient(135deg, var(--tw-gradient-stops))',
        'gradient-vibrant':
          'linear-gradient(135deg, #6366F1 0%, #F472B6 50%, #14B8A6 100%)',
        'gradient-electric':
          'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
        'gradient-warm': 'linear-gradient(135deg, #F59E0B 0%, #F472B6 100%)',
        'mesh-light': `
          radial-gradient(at 20% 10%, rgba(99, 102, 241, 0.15) 0px, transparent 50%),
          radial-gradient(at 80% 5%, rgba(244, 114, 182, 0.12) 0px, transparent 50%),
          radial-gradient(at 10% 60%, rgba(20, 184, 166, 0.10) 0px, transparent 50%),
          radial-gradient(at 90% 50%, rgba(139, 92, 246, 0.08) 0px, transparent 50%),
          radial-gradient(at 50% 100%, rgba(245, 158, 11, 0.08) 0px, transparent 50%)
        `,
        'mesh-dark': `
          radial-gradient(at 20% 10%, rgba(99, 102, 241, 0.20) 0px, transparent 50%),
          radial-gradient(at 80% 5%, rgba(244, 114, 182, 0.15) 0px, transparent 50%),
          radial-gradient(at 10% 60%, rgba(20, 184, 166, 0.12) 0px, transparent 50%),
          radial-gradient(at 90% 50%, rgba(139, 92, 246, 0.10) 0px, transparent 50%),
          radial-gradient(at 50% 100%, rgba(245, 158, 11, 0.10) 0px, transparent 50%)
        `,
      },
      boxShadow: {
        'glow-primary': '0 0 30px rgba(99, 102, 241, 0.25)',
        'glow-accent': '0 0 30px rgba(244, 114, 182, 0.25)',
        'glow-violet': '0 0 30px rgba(139, 92, 246, 0.25)',
        'card-light': '0 4px 24px rgba(0, 0, 0, 0.06)',
        'card-dark': '0 4px 24px rgba(0, 0, 0, 0.5)',
        'card-hover-light': '0 12px 40px rgba(99, 102, 241, 0.15)',
        'card-hover-dark': '0 12px 40px rgba(99, 102, 241, 0.25)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        float: 'float 4s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        shimmer: 'shimmer 1.5s ease-in-out infinite',
        'bounce-in': 'bounce-in 0.4s ease-out',
        'slide-up': 'slide-up 0.3s ease-out',
        'fade-in': 'fade-in 0.2s ease-out',
        'spin-slow': 'spin 3s linear infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'pulse-glow': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.7' },
        },
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'bounce-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '50%': { transform: 'scale(1.02)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}

export default config
