import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          0: '#070e1b',
          1: '#0c1527',
          2: '#111f36',
          card: '#14213d',
          hover: '#1a2b4a',
        },
        sidebar: '#0a1424',
        accent: {
          green: '#22c55e',
          'green-dim': 'rgba(34,197,94,0.12)',
          blue: '#3b82f6',
          red: '#ef4444',
          yellow: '#f59e0b',
          purple: '#8b5cf6',
          orange: '#f97316',
          teal: '#14b8a6',
        },
        border: {
          DEFAULT: 'rgba(148,163,184,0.1)',
          focus: 'rgba(148,163,184,0.3)',
        },
        text: {
          1: '#f1f5f9',
          2: '#94a3b8',
          3: '#64748b',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-green': '0 0 20px rgba(34,197,94,0.25)',
        'glow-sm': '0 0 10px rgba(34,197,94,0.15)',
        card: '0 4px 24px rgba(0,0,0,0.4)',
        'card-lg': '0 8px 40px rgba(0,0,0,0.5)',
      },
      borderRadius: {
        xl: '12px',
        '2xl': '16px',
        '3xl': '20px',
      },
    },
  },
  plugins: [],
}

export default config
