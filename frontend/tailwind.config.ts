import type { Config } from 'tailwindcss';
// Brand colours live here: change these few values to re-skin all three portals.
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0F2340', tag: '#FFD21F', paper: '#F1F4F8', line: '#D3DBE5', muted: '#526378',
        go: '#0A7350', stop: '#B72C1B', wait: '#8F5300', link: '#1547C4',
      },
      fontFamily: { sans: ['"Archivo Variable"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config;
