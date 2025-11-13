/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // CRÍTICO: Asegura que Tailwind escanee tus componentes React
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}