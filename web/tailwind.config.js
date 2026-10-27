import typography from '@tailwindcss/typography'

const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        panel: v('panel'),
        sunken: v('sunken'),
        line: v('line'),
        fg: v('fg'),
        muted: v('muted'),
        faint: v('faint'),
        accent: v('accent'),
        pos: v('pos'),
        neg: v('neg'),
        warn: v('warn'),
        claude: v('src-claude'),
        codex: v('src-codex'),
        grok: v('src-grok'),
        agy: v('src-agy'),
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
    },
  },
  plugins: [typography],
}
