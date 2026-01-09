import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./web/**/*.{js,ts,jsx,tsx}', './index.html'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      colors: {
        jeju: {
          primary: '#6366F1',
          secondary: '#8B5CF6',
          accent: '#F472B6',
        },
      },
    },
  },
  plugins: [],
}

export default config
