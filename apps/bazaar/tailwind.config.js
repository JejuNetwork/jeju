/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        jeju: {
          primary: '#667eea',
          secondary: '#764ba2',
          accent: '#5568d3',
          success: '#238636',
          error: '#da3633',
          warning: '#bb8009',
        },
      },
    },
  },
  plugins: [],
}

