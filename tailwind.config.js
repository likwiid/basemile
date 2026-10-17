// SPDX-License-Identifier: GPL-3.0-or-later

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: '#050505',
          elevated: '#0d0d0d',
          card: '#101010',
          border: '#242424',
        },
        zone: {
          z1: '#3b82f6',
          z2: '#10b981',
          z3: '#facc15',
          z4: '#f97316',
          z5: '#ef4444',
        },
        text: {
          primary: '#f5f5f5',
          secondary: '#a8a8a8',
          muted: '#737373',
        },
        accent: {
          DEFAULT: '#10b981',
          dim: '#065f46',
        },
      },
      fontFamily: {
        mono: ['SpaceMono', 'monospace'],
      },
      fontSize: {
        hero: ['144px', { lineHeight: '144px', fontWeight: '700' }],
      },
    },
  },
  plugins: [],
};
