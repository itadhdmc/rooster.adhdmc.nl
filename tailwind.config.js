/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Huisstijlkleuren komen uit CSS-variabelen zodat ze per organisatie
      // instelbaar zijn (app_settings → SettingsProvider). De fallbacks
      // staan in index.css (:root).
      colors: {
        salmon: {
          50:  'var(--color-primary-50)',
          100: 'var(--color-primary-100)',
          200: 'var(--color-primary-200)',
          300: 'var(--color-primary-300)',
          400: 'var(--color-primary-400)',
          500: 'var(--color-primary)',
          600: 'var(--color-primary-600)',
          700: 'var(--color-primary-700)',
        },
        dark: {
          DEFAULT: 'var(--color-dark)',
          800: 'var(--color-dark-800)',
          900: 'var(--color-dark-900)',
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
