/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
    "../../packages/core-react/src/**/*.{ts,tsx}"
  ],
  darkMode: "class",
  theme: {
    extend: {}
  },
  plugins: []
};
