/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        salmon: {
          50:  '#fff1f0',
          100: '#ffe0de',
          200: '#ffc2be',
          400: '#f99590',
          500: '#f87369',
          600: '#e5574d',
          700: '#c83d33',
        },
        dark: {
          DEFAULT: '#3c3c3b',
          800: '#2e2e2d',
          900: '#1e1e1d',
        },
        surface: '#f2f2f7',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
