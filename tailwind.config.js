/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brick: {
          50: '#fef2f2',
          500: '#b04a3c',
          600: '#962f22',
          700: '#7a2419',
          900: '#4a130c',
        },
        mortar: {
          50: '#f8f7f5',
          300: '#c5beb3',
          500: '#6d675d',
          800: '#2c2a26',
          900: '#1a1816',
          950: '#0e0d0c',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
