// Live palettes — the exploration tool. Every palette is a designed PAIR:
//   brand = ACTION (buttons, FAB, links, active states)
//   a2    = TIME   (today's date, the now line) — see the DUO layer in v3.css
// Entries with a `neutrals` block additionally re-tint the CANVAS (paper,
// surfaces, ink) for that mode — a full theme, not just an accent. Without it,
// the v3.css base (warm cream day / warm graphite night) shows through.
// Selection persists per device and re-applies on light/dark flips.

export const PALETTES = {
  klein: {
    label: 'Klein blue', dot: '#002fa7', dot2: '#e0a64a',
    light: { brand: '#002fa7', press: '#00257f', gA: '#0d3cbe', gB: '#002fa7', pA: '#00257f', pB: '#001c62', link: '#1f3fd0', on: '#ffffff', glow: '0,47,167', a2: '#b47a24' },
    dark:  { brand: '#93a5ff', press: '#7d90f2', gA: '#a3b2ff', gB: '#7d90f2', pA: '#7d90f2', pB: '#6a7de6', link: '#b3c0ff', on: '#10143c', glow: '147,165,255', a2: '#e0a64a' },
  },
  amber: {
    label: 'Amber', dot: '#c9862b', dot2: '#52689e',
    light: { brand: '#9a6a12', press: '#855a0c', gA: '#a9761a', gB: '#8c5f0e', pA: '#855a0c', pB: '#6f4a08', link: '#855a0c', on: '#ffffff', glow: '154,106,18', a2: '#52689e' },
    dark:  { brand: '#e0a64a', press: '#cf9333', gA: '#e7b25b', gB: '#d4922f', pA: '#cf9333', pB: '#b87d22', link: '#ecc16f', on: '#2a1f08', glow: '224,166,74', a2: '#93a5ff' },
  },
  forest: {
    label: 'Forest', dot: '#1e5b3c', dot2: '#f2c230',
    light: { brand: '#1e5b3c', press: '#17492f', gA: '#27714c', gB: '#1e5b3c', pA: '#17492f', pB: '#123a26', link: '#1d6a44', on: '#ffffff', glow: '30,91,60', a2: '#a87e00' },
    dark:  { brand: '#6fd6a3', press: '#57c690', gA: '#83e0b2', gB: '#57c690', pA: '#57c690', pB: '#45b57f', link: '#8fe3b8', on: '#06301d', glow: '111,214,163', a2: '#f2c230' },
  },
  persimmon: {
    label: 'Persimmon', dot: '#c93a1c', dot2: '#2b46c0',
    light: { brand: '#c93a1c', press: '#a92e13', gA: '#de4f2b', gB: '#c93a1c', pA: '#a92e13', pB: '#8c250e', link: '#b53517', on: '#ffffff', glow: '201,58,28', a2: '#2b46c0' },
    dark:  { brand: '#ff8b6e', press: '#f57a5c', gA: '#ffa188', gB: '#f57a5c', pA: '#f57a5c', pB: '#e56a4d', link: '#ffa78f', on: '#401207', glow: '255,139,110', a2: '#8fa0ff' },
  },
  mulberry: {
    label: 'Mulberry', dot: '#7a3352', dot2: '#b5c689',
    light: { brand: '#7a3352', press: '#632942', gA: '#8f3f63', gB: '#7a3352', pA: '#632942', pB: '#4f2035', link: '#86395b', on: '#ffffff', glow: '122,51,82', a2: '#7d8a3d' },
    dark:  { brand: '#d78fae', press: '#c97b9d', gA: '#e3a5bf', gB: '#c97b9d', pA: '#c97b9d', pB: '#b96b8e', link: '#e2a9c2', on: '#3a0f22', glow: '215,143,174', a2: '#b5c689' },
  },
  sun: {
    label: 'Ink & sun', dot: '#1b1813', dot2: '#f5b800',
    light: { brand: '#1b1813', press: '#000000', gA: '#2f2a21', gB: '#1b1813', pA: '#14110d', pB: '#000000', link: '#8a6a00', on: '#fffdf7', glow: '27,24,19', a2: '#a87e00' },
    dark:  { brand: '#f0ece3', press: '#ddd6c8', gA: '#fff8e8', gB: '#efe6d2', pA: '#ddd6c8', pB: '#cbc3b2', link: '#ffd34d', on: '#171512', glow: '245,184,0', a2: '#ffc933' },
  },
  blush: {
    label: 'Blush', dot: '#a63a4f', dot2: '#6f8a72',
    light: {
      brand: '#a63a4f', press: '#8c2f42', gA: '#b84a5f', gB: '#a63a4f', pA: '#8c2f42', pB: '#6f2434', link: '#9c3448', on: '#ffffff', glow: '166,58,79', a2: '#6f8a72',
      neutrals: { bg: '#faf1ee', surface: '#fffbf9', surface2: '#f3e4de', border: 'rgba(60,25,25,.13)', text: '#26181a', text2: '#77605f', text3: '#a68f8c', barBg: 'rgba(250,241,238,.86)' },
    },
    dark: {
      brand: '#e8a0ad', press: '#db8a99', gA: '#f0b3be', gB: '#db8a99', pA: '#db8a99', pB: '#c97786', link: '#f0b9c3', on: '#47101c', glow: '232,160,173', a2: '#a9c4b0',
      neutrals: { bg: '#171012', surface: '#1f1618', surface2: '#2a1d20', border: 'rgba(255,255,255,.11)', text: '#f2e8e6', text2: '#c0a8a6', text3: '#8d7472', barBg: 'rgba(23,16,18,.82)' },
    },
  },
  sage: {
    label: 'Sage', dot: '#3d6b57', dot2: '#b3603c',
    light: {
      brand: '#3d6b57', press: '#315946', gA: '#487c65', gB: '#3d6b57', pA: '#315946', pB: '#264636', link: '#38654f', on: '#ffffff', glow: '61,107,87', a2: '#b3603c',
      neutrals: { bg: '#f3f6ee', surface: '#fcfdf8', surface2: '#e7ecdd', border: 'rgba(30,42,30,.13)', text: '#1f2a22', text2: '#5f6f60', text3: '#8d9c8c', barBg: 'rgba(243,246,238,.86)' },
    },
    dark: {
      brand: '#a9c4b0', press: '#97b59f', gA: '#b8d0bf', gB: '#97b59f', pA: '#97b59f', pB: '#85a48d', link: '#bcd4c3', on: '#16241b', glow: '169,196,176', a2: '#e08b66',
      neutrals: { bg: '#111513', surface: '#191f1b', surface2: '#232b25', border: 'rgba(255,255,255,.11)', text: '#e9efe9', text2: '#adbcae', text3: '#7a8a7c', barBg: 'rgba(17,21,19,.82)' },
    },
  },
  porcelain: {
    label: 'Porcelain', dot: '#2d5be3', dot2: '#b45f05',
    light: {
      brand: '#2d5be3', press: '#2449c2', gA: '#3f6bf0', gB: '#2d5be3', pA: '#2449c2', pB: '#1c3aa0', link: '#2851d6', on: '#ffffff', glow: '45,91,227', a2: '#b45f05',
      neutrals: { bg: '#f6f7f8', surface: '#ffffff', surface2: '#eceef1', border: 'rgba(20,24,30,.12)', text: '#16181b', text2: '#5c636e', text3: '#99a0ab', barBg: 'rgba(246,247,248,.86)' },
    },
    dark: {
      brand: '#7ea2ff', press: '#6a8ff2', gA: '#8fb0ff', gB: '#6a8ff2', pA: '#6a8ff2', pB: '#587ee0', link: '#9db9ff', on: '#0c1636', glow: '126,162,255', a2: '#f59e0b',
      neutrals: { bg: '#101114', surface: '#17191d', surface2: '#202329', border: 'rgba(255,255,255,.11)', text: '#edeff3', text2: '#b0b6c0', text3: '#7c828d', barBg: 'rgba(16,17,20,.82)' },
    },
  },
  mocha: {
    label: 'Mocha', dot: '#a4491d', dot2: '#45877f',
    light: {
      brand: '#a4491d', press: '#8a3b15', gA: '#b65627', gB: '#a4491d', pA: '#8a3b15', pB: '#6f2e0f', link: '#97431b', on: '#ffffff', glow: '164,73,29', a2: '#45877f',
      neutrals: { bg: '#f2eadd', surface: '#fbf6ec', surface2: '#e8dcc8', border: 'rgba(50,35,15,.15)', text: '#241b10', text2: '#6e5f4a', text3: '#9b8b73', barBg: 'rgba(242,234,221,.86)' },
    },
    dark: {
      brand: '#f0a35e', press: '#e5924a', gA: '#f5b374', gB: '#e5924a', pA: '#e5924a', pB: '#d18038', link: '#f5bc85', on: '#3c2005', glow: '240,163,94', a2: '#7fc3b8',
      neutrals: { bg: '#161210', surface: '#1e1814', surface2: '#29211a', border: 'rgba(255,255,255,.11)', text: '#f0e8dc', text2: '#c0b09c', text3: '#8b7b66', barBg: 'rgba(22,18,16,.82)' },
    },
  },
}

const KEY = 'rsp-palette'

const NEUTRAL_VARS = {
  bg: '--bg', surface: '--surface', surface2: '--surface-2', border: '--border',
  text: '--text', text2: '--text-2', text3: '--text-3', barBg: '--bar-bg',
}

export function currentPalette() {
  const k = localStorage.getItem(KEY)
  return PALETTES[k] ? k : 'klein'
}

function setVars(p) {
  const s = document.documentElement.style
  s.setProperty('--brand', p.brand)
  s.setProperty('--brand-press', p.press)
  s.setProperty('--grad-brand', `linear-gradient(135deg, ${p.gA} 0%, ${p.gB} 100%)`)
  s.setProperty('--grad-brand-press', `linear-gradient(135deg, ${p.pA} 0%, ${p.pB} 100%)`)
  s.setProperty('--link', p.link)
  s.setProperty('--on-accent', p.on)
  s.setProperty('--glow-brand', `0 5px 18px rgba(${p.glow},.24)`)
  s.setProperty('--ring-focus', `0 0 0 3px rgba(${p.glow},.26)`)
  s.setProperty('--accent-2', p.a2 || p.brand)
  // canvas overrides: set when the palette re-tints the neutrals, otherwise
  // clear so the v3.css base (cream / warm graphite) shows through
  for (const [key, cssVar] of Object.entries(NEUTRAL_VARS)) {
    const v = p.neutrals && p.neutrals[key]
    if (v) s.setProperty(cssVar, v)
    else s.removeProperty(cssVar)
  }
}

export function applyPalette(name) {
  const pal = PALETTES[name] || PALETTES.klein
  const mode = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'
  setVars(pal[mode])
  localStorage.setItem(KEY, PALETTES[name] ? name : 'klein')
}

export function initPalettes() {
  applyPalette(currentPalette())
  // light/dark toggle changes which take of the palette applies — follow it
  new MutationObserver(() => applyPalette(currentPalette()))
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
}
