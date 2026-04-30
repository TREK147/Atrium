/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
      portrait: { raw: '(orientation: portrait)' },
      landscape: { raw: '(orientation: landscape)' },
    },
    extend: {
      colors: {
        primary: {
          50: 'var(--primary-50, #f3f6fc)',
          100: 'var(--primary-100, #e8eef9)',
          400: 'var(--primary-400, #5d7bb9)',
          500: 'var(--primary-500, #4768ab)',
          600: 'var(--primary-600, #3e5d9a)',
          700: 'var(--primary-700, #334c7f)',
          900: 'var(--primary-900, #1f2f52)',
        },
      },
      safeArea: {
        top: 'env(safe-area-inset-top)',
        bottom: 'env(safe-area-inset-bottom)',
        left: 'env(safe-area-inset-left)',
        right: 'env(safe-area-inset-right)',
      },
    },
  },
  plugins: [],
}
