/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-outfit)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      colors: {
        bazaar: {
          // Warm sunset orange - primary brand
          primary: '#FF6B35',
          'primary-dark': '#E85A2A',
          'primary-light': '#FF8F66',
          // Tropical teal - accent
          accent: '#00D9C0',
          'accent-dark': '#00B8A3',
          'accent-light': '#4AEADB',
          // Rich purple for contrast
          purple: '#7C3AED',
          'purple-dark': '#6D28D9',
          'purple-light': '#A78BFA',
          // Status colors
          success: '#10B981',
          error: '#EF4444',
          warning: '#F59E0B',
          info: '#3B82F6',
        },
        // Light mode surfaces
        light: {
          bg: '#FFFBF7',
          'bg-secondary': '#FFF5ED',
          'bg-tertiary': '#FFEDE0',
          surface: '#FFFFFF',
          'surface-elevated': '#FFFFFF',
          border: '#FFE4D4',
          'border-strong': '#FFD0B8',
          text: '#1A1523',
          'text-secondary': '#635E69',
          'text-tertiary': '#9D97A5',
        },
        // Dark mode surfaces
        dark: {
          bg: '#0D0B14',
          'bg-secondary': '#161222',
          'bg-tertiary': '#1E1830',
          surface: '#1E1830',
          'surface-elevated': '#2A2440',
          border: '#3D3558',
          'border-strong': '#4D4570',
          text: '#FAFAFA',
          'text-secondary': '#B8B4C0',
          'text-tertiary': '#7D7888',
        },
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-bazaar': 'linear-gradient(135deg, var(--tw-gradient-stops))',
        'gradient-sunset': 'linear-gradient(135deg, #FF6B35 0%, #7C3AED 50%, #00D9C0 100%)',
        'gradient-warm': 'linear-gradient(135deg, #FF6B35 0%, #E85A2A 100%)',
        'gradient-cool': 'linear-gradient(135deg, #7C3AED 0%, #00D9C0 100%)',
        'mesh-light': `
          radial-gradient(at 40% 20%, rgba(255, 107, 53, 0.15) 0px, transparent 50%),
          radial-gradient(at 80% 0%, rgba(124, 58, 237, 0.1) 0px, transparent 50%),
          radial-gradient(at 0% 50%, rgba(0, 217, 192, 0.1) 0px, transparent 50%),
          radial-gradient(at 80% 50%, rgba(255, 107, 53, 0.08) 0px, transparent 50%),
          radial-gradient(at 0% 100%, rgba(124, 58, 237, 0.08) 0px, transparent 50%)
        `,
        'mesh-dark': `
          radial-gradient(at 40% 20%, rgba(255, 107, 53, 0.2) 0px, transparent 50%),
          radial-gradient(at 80% 0%, rgba(124, 58, 237, 0.15) 0px, transparent 50%),
          radial-gradient(at 0% 50%, rgba(0, 217, 192, 0.12) 0px, transparent 50%),
          radial-gradient(at 80% 50%, rgba(255, 107, 53, 0.1) 0px, transparent 50%),
          radial-gradient(at 0% 100%, rgba(124, 58, 237, 0.1) 0px, transparent 50%)
        `,
      },
      boxShadow: {
        'glow-primary': '0 0 20px rgba(255, 107, 53, 0.3)',
        'glow-accent': '0 0 20px rgba(0, 217, 192, 0.3)',
        'glow-purple': '0 0 20px rgba(124, 58, 237, 0.3)',
        'card-light': '0 4px 20px rgba(0, 0, 0, 0.08)',
        'card-dark': '0 4px 20px rgba(0, 0, 0, 0.4)',
        'card-hover-light': '0 8px 30px rgba(255, 107, 53, 0.15)',
        'card-hover-dark': '0 8px 30px rgba(255, 107, 53, 0.2)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      animation: {
        'float': 'float 6s ease-in-out infinite',
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'shimmer': 'shimmer 2s linear infinite',
        'bounce-subtle': 'bounce-subtle 2s ease-in-out infinite',
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
