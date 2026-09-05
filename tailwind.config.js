/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: '#0b0f19',
        cardBg: '#151d30',
        sidebarBg: '#111827',
        accent: '#3b82f6',
      }
    },
  },
  plugins: [],
}