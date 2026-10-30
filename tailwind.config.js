/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eef6ff',
          100: '#d9ebff',
          200: '#bcdcff',
          300: '#8ec5ff',
          400: '#59a5ff',
          500: '#3385fb',
          600: '#1d67f0',
          700: '#1552dd',
          800: '#1845b3',
          900: '#1a3d8d'
        }
      }
    }
  },
  plugins: []
}
