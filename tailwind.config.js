/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ns: {
          50:  '#eaf4fb',
          100: '#d0e6f4',
          200: '#a3cde8',
          300: '#6fb2d8',
          400: '#4a9dcf',
          500: '#3688b9',
          600: '#2d6a8e',
          700: '#224e68',
          800: '#1a3d52',
          900: '#132b3a',
        },
        mortar: {
          50:  '#f4f1ea',
          100: '#e5dfd2',
          300: '#c5beb3',
          500: '#6d675d',
          700: '#3a3834',
          800: '#2c2a26',
          900: '#1a1816',
          950: '#0e0d0c',
        },
        cream: '#f4f1ea',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['Barlow Condensed', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
