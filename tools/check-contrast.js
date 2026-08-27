#!/usr/bin/env node
/**
 * Dev-only: prove the contrast invariant in css/tokens.css, for every theme,
 * every weekly accent family, and every surface a text token can land on.
 *
 * CLAUDE.md states the rule this enforces:
 *
 *   Every text token clears WCAG AA (4.5:1) against EVERY surface it can land
 *   on — not merely against white. There is no sub-AA tier.
 *
 * That was checked by hand while the app was light-only and had four text
 * tokens and five accent families. Dark mode doubles it: 2 themes × 5 families
 * × (6 text tokens × 7 surfaces + the inverse and meaning pairs) is several
 * hundred ratios, which is well past what anyone will re-check by hand after
 * nudging one hex. So it is checked here instead.
 *
 * Usage: node tools/check-contrast.js [--verbose]
 *
 * The parser is deliberately small: it understands the exact shape of
 * tokens.css (flat blocks of `--name: value;`) and resolves them the way the
 * cascade does, by specificity then source order. It does not attempt to be a
 * CSS engine. If tokens.css ever grows nesting or var() indirection, this file
 * has to grow with it — a silent wrong answer here is worse than a crash, so
 * anything it cannot parse is reported rather than skipped.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const VERBOSE = process.argv.includes('--verbose');
const cssPath = path.join(__dirname, '..', 'css', 'tokens.css');
const css = fs.readFileSync(cssPath, 'utf8');

// ---- Colour maths ---------------------------------------------------

function parseColor(value) {
  const v = String(value).trim();

  let m = /^#([0-9a-f]{3})$/i.exec(v);
  if (m) {
    const [r, g, b] = m[1].split('');
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16), a: 1 };
  }
  m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) {
    return {
      r: parseInt(m[1].slice(0, 2), 16),
      g: parseInt(m[1].slice(2, 4), 16),
      b: parseInt(m[1].slice(4, 6), 16),
      a: 1
    };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const parts = m[1].split(/[,/]/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 3) {
      return {
        r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]),
        a: parts.length > 3 ? Number(parts[3]) : 1
      };
    }
  }
  return null;
}

/** Composite a possibly-translucent colour over an opaque one. */
function over(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1
  };
}

function luminance(c) {
  const lin = x => {
    const s = x / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// ---- A very small slice of CSS --------------------------------------

/**
 * Pull out every top-level `selector { ... }` block, in source order.
 * Comments are stripped first so a `/* ... *\/` containing braces cannot
 * fool the brace counter.
 */
function parseBlocks(text) {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(stripped)) !== null) {
    const selector = m[1].trim();
    const decls = {};
    m[2].split(';').forEach(decl => {
      const i = decl.indexOf(':');
      if (i === -1) return;
      const prop = decl.slice(0, i).trim();
      const value = decl.slice(i + 1).trim();
      if (prop.startsWith('--')) decls[prop.slice(2)] = value;
    });
    blocks.push({ selector, decls });
  }
  return blocks;
}

/** Specificity of the handful of selector shapes tokens.css actually uses. */
function specificity(selector) {
  const classes = (selector.match(/\[[^\]]*\]/g) || []).length +
                  (selector.match(/:root|:[a-z-]+/g) || []).length;
  return classes;
}

/**
 * Resolve the token values in force for one theme + accent family, the way a
 * browser would: every block whose selector matches, sorted by specificity
 * then source order, applied in turn.
 */
function resolve(blocks, theme, family) {
  const out = {};
  const matching = [];

  blocks.forEach((block, index) => {
    block.selector.split(',').map(s => s.trim()).forEach(sel => {
      if (!matches(sel, theme, family)) return;
      matching.push({ sel, decls: block.decls, index, spec: specificity(sel) });
    });
  });

  matching.sort((a, b) => (a.spec - b.spec) || (a.index - b.index));
  matching.forEach(m => Object.assign(out, m.decls));
  return out;
}

/**
 * Does this selector apply to <html data-theme=THEME data-accent=FAMILY>?
 *
 * Only the shapes tokens.css uses are understood: `:root`, `[data-accent="x"]`,
 * `:root[data-theme="dark"]`, and combinations of those. Anything else is
 * rejected loudly rather than quietly ignored, because a selector this file
 * silently skipped would be a palette nobody ever checked.
 */
function matches(sel, theme, family) {
  let rest = sel;
  let ok = true;

  rest = rest.replace(/:root/g, '');
  rest = rest.replace(/\[data-theme="([^"]+)"\]/g, (_, want) => {
    if (want !== theme) ok = false;
    return '';
  });
  rest = rest.replace(/\[data-accent="([^"]+)"\]/g, (_, want) => {
    if (want !== family) ok = false;
    return '';
  });
  rest = rest.replace(/:not\(\[data-theme\]\)/g, '');

  if (rest.trim() !== '') {
    throw new Error('check-contrast.js does not understand the selector "' + sel +
      '" in css/tokens.css. Teach it that shape rather than leaving a palette unchecked.');
  }
  return ok;
}

// ---- What has to be legible on what ---------------------------------

/**
 * Every text token, against every surface it can actually land on. Derived by
 * reading css/styles.css, not guessed:
 *
 *  - the four text tokens are used freely on every surface;
 *  - --accent-primary is a text colour too (links, lane titles, hover states);
 *  - --accent-secondary is the notes indicator on a card;
 *  - --text-inverse only ever sits on a filled accent, danger, ok, or the
 *    toast's --text-primary background;
 *  - --danger / --warn / --ok are used as text on surfaces and on their washes;
 *  - the banners put --text-primary on --danger-wash and --warn-wash.
 */
const SURFACES = ['bg-page', 'bg-surface', 'bg-surface-subtle', 'bg-hover', 'focus-wash', 'danger-wash', 'warn-wash'];
const TEXT_ON_SURFACES = ['text-primary', 'text-secondary', 'text-muted', 'text-faint',
                          'accent-primary', 'accent-secondary'];

const FILLED = [
  ['text-inverse', 'accent-primary'],
  ['text-inverse', 'accent-strong'],
  ['text-inverse', 'danger'],
  ['text-inverse', 'ok'],
  ['text-inverse', 'text-primary'],
];

const MEANING = [
  ['danger', 'bg-surface'], ['danger', 'bg-page'], ['danger', 'bg-surface-subtle'], ['danger', 'danger-wash'],
  ['warn', 'bg-surface'], ['warn', 'bg-page'], ['warn', 'warn-wash'],
  ['ok', 'bg-surface'], ['ok', 'bg-page'], ['ok', 'bg-surface-subtle'],
  ['danger', 'bg-hover'], ['warn', 'bg-hover'], ['ok', 'bg-hover'],
];

const AA = 4.5;

/** Boundaries, not text: WCAG's 3:1 non-text threshold, reported not enforced. */
const NON_TEXT = [
  ['border-strong', 'bg-surface'],
  ['border-muted', 'bg-surface'],
  ['accent-primary', 'bg-surface'],
];

// ---- Run ------------------------------------------------------------

const blocks = parseBlocks(css);

const themes = new Set(['light']);
const families = new Set();
blocks.forEach(b => {
  b.selector.split(',').forEach(sel => {
    const t = /\[data-theme="([^"]+)"\]/.exec(sel);
    if (t) themes.add(t[1]);
    const f = /\[data-accent="([^"]+)"\]/.exec(sel);
    if (f) families.add(f[1]);
  });
});
if (families.size === 0) families.add('slate');

const failures = [];
const notes = [];
let checked = 0;

function check(theme, family, tokens, fgName, bgName, threshold, hard) {
  const rawFg = tokens[fgName];
  const rawBg = tokens[bgName];
  if (rawFg === undefined || rawBg === undefined) {
    failures.push(`[${theme}/${family}] token --${rawFg === undefined ? fgName : bgName} is not defined`);
    return;
  }
  const fg = parseColor(rawFg);
  const bg = parseColor(rawBg);
  if (!fg || !bg) {
    failures.push(`[${theme}/${family}] could not parse --${!fg ? fgName : bgName}: ` +
                  `"${!fg ? rawFg : rawBg}"`);
    return;
  }
  // A wash may be translucent; composite it onto the page before measuring.
  const solidBg = over(bg, parseColor(tokens['bg-page']) || { r: 255, g: 255, b: 255, a: 1 });
  const r = ratio(over(fg, solidBg), solidBg);
  checked++;

  const line = `[${theme}/${family}] --${fgName} on --${bgName}: ${r.toFixed(2)}:1`;
  if (r < threshold) {
    (hard ? failures : notes).push(line + `  (needs ${threshold}:1)`);
  } else if (VERBOSE) {
    console.log('  ok  ' + line);
  }
}

for (const theme of themes) {
  for (const family of families) {
    const tokens = resolve(blocks, theme, family);

    TEXT_ON_SURFACES.forEach(fg => {
      SURFACES.forEach(bg => check(theme, family, tokens, fg, bg, AA, true));
    });
    FILLED.forEach(([fg, bg]) => check(theme, family, tokens, fg, bg, AA, true));
    MEANING.forEach(([fg, bg]) => check(theme, family, tokens, fg, bg, AA, true));
    NON_TEXT.forEach(([fg, bg]) => check(theme, family, tokens, fg, bg, 3, false));
  }
}

// The four text tokens are meant to form a visible hierarchy. A palette where
// they are all near-white passes every ratio above and is still a broken
// design, so check that each step is perceptibly quieter than the last.
for (const theme of themes) {
  const tokens = resolve(blocks, theme, [...families][0]);
  const page = parseColor(tokens['bg-surface']);
  const steps = ['text-primary', 'text-secondary', 'text-muted', 'text-faint']
    .map(name => ({ name, r: ratio(parseColor(tokens[name]), page) }));
  for (let i = 1; i < steps.length; i++) {
    if (steps[i].r >= steps[i - 1].r) {
      failures.push(`[${theme}] --${steps[i].name} (${steps[i].r.toFixed(2)}:1) is not quieter than ` +
                    `--${steps[i - 1].name} (${steps[i - 1].r.toFixed(2)}:1); the text hierarchy is inverted`);
    }
  }
  if (VERBOSE) {
    console.log(`  ${theme} text ladder on --bg-surface: ` +
      steps.map(s => `${s.name} ${s.r.toFixed(1)}`).join(' → '));
  }
}

console.log(`contrast: ${checked} pairs checked across ` +
            `${themes.size} theme(s) × ${families.size} accent famil${families.size === 1 ? 'y' : 'ies'}`);

if (notes.length) {
  console.log('\nBelow 3:1 as a non-text boundary (informational — the light system has always been\n' +
              'here, hairlines are deliberately quiet):');
  notes.forEach(n => console.log('  · ' + n));
}

if (failures.length) {
  console.error('\nFAIL — the AA invariant in CLAUDE.md is broken:');
  failures.forEach(f => console.error('  ✗ ' + f));
  process.exit(1);
}

console.log('PASS — every text token clears AA on every surface it can land on.');
