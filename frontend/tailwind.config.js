/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      colors: {
        ink: { 950: '#050505', 900: '#0a0a0a', 850: '#0f0f0f', 800: '#141414' },
        brand: { 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5' },
      },
      backgroundImage: {
        'brand-gradient': 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #d946ef 100%)',
        'glass-sheen': 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
        'radial-glow': 'radial-gradient(600px circle at var(--x,50%) var(--y,0%), rgba(99,102,241,0.12), transparent 60%)',
      },
      boxShadow: {
        glow: '0 0 40px -8px rgba(99,102,241,0.45)',
        card: '0 8px 40px -12px rgba(0,0,0,0.6)',
      },
      keyframes: {
        shimmer: { '100%': { transform: 'translateX(100%)' } },
        float: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-6px)' } },
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(10px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
      },
      animation: {
        shimmer: 'shimmer 1.6s infinite',
        float: 'float 6s ease-in-out infinite',
        'fade-up': 'fade-up 0.4s ease-out',
      },
    },
  },
  plugins: [],
}
