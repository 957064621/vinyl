import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');

const blockBody = (source, marker, { last = false } = {}) => {
  const start = last ? source.lastIndexOf(marker) : source.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS block: ${marker}`);

  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `missing opening brace: ${marker}`);

  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }

  assert.fail(`unterminated CSS block: ${marker}`);
};

const ruleBody = (selector) => blockBody(css, `${selector} {`, { last: true });
const baseRuleBody = (selector) => blockBody(css, `${selector} {`);

test('archive palette and typography use the fixed neutral system', () => {
  const root = blockBody(css, ':root {');
  const expectedTokens = {
    '--archive-void': '#070808',
    '--archive-graphite': '#151819',
    '--archive-slate': '#222526',
    '--archive-silver': '#aeb6b9',
    '--archive-projector': '#f1f2ee',
    '--archive-red': '#a43b42'
  };

  for (const [token, value] of Object.entries(expectedTokens)) {
    assert.match(root, new RegExp(`${token}:\\s*${value};`), `missing ${token}`);
  }

  const letterSpacingValues = [...css.matchAll(/\bletter-spacing\s*:\s*([^;}]+)/g)]
    .map((match) => match[1].trim().replace(/\s*!important$/, ''));
  assert.ok(letterSpacingValues.length > 0, 'expected explicit zero-spacing typography rules');
  assert.ok(
    letterSpacingValues.every((value) => value === '0' || value === 'inherit'),
    `nonzero letter-spacing declarations remain: ${letterSpacingValues.filter((value) => value !== '0' && value !== 'inherit').join(', ')}`
  );

  assert.match(ruleBody('.header h1'), /font-family:\s*var\(--font-title\)/);
  assert.match(ruleBody('.lyric-text'), /font-family:\s*var\(--font-title\)/);
  assert.match(baseRuleBody('.archive-track-meta'), /font-family:\s*var\(--font-ui\)/);
});

test('the viewport uses only two directional projector fields', () => {
  const fields = [baseRuleBody('body::before'), baseRuleBody('body::after')];

  for (const field of fields) {
    assert.match(field, /position:\s*fixed/);
    assert.match(field, /(?:linear-gradient|conic-gradient)\(/);
    assert.match(field, /clip-path:\s*polygon\(/);
    assert.match(field, /(?:-webkit-)?mask-image:\s*linear-gradient\(/);
    assert.doesNotMatch(field, /radial-gradient\(/);
  }

  assert.doesNotMatch(css, /\bambient-dust-drift\b/);
  assert.doesNotMatch(css, /\bambient-veil-shift\b/);
  assert.doesNotMatch(css, /\bbtn-sheen-sweep\b/);
});

test('compact and reduced motion keep the beam static without live filters', () => {
  const compactBeam = ruleBody('html[data-motion-profile="compact"] body::before,\n        html[data-motion-profile="compact"] body::after');
  const reduceBeam = ruleBody('html[data-motion-profile="reduce"] body::before,\n        html[data-motion-profile="reduce"] body::after');
  const reducedMedia = blockBody(css, '@media (prefers-reduced-motion: reduce)', { last: true });

  for (const profile of [compactBeam, reduceBeam]) {
    assert.match(profile, /animation:\s*none/);
    assert.match(profile, /filter:\s*none/);
    assert.match(profile, /box-shadow:\s*none/);
  }

  assert.doesNotMatch(css, /(?:-webkit-)?backdrop-filter\s*:/);
  assert.doesNotMatch(reducedMedia, /background-position\s*:/);
  assert.doesNotMatch(css, /\bwill-change\s*:/);
});

test('desktop and mobile layout rules preserve the unframed turntable contract', () => {
  const shell = ruleBody('.app-shell');
  const turntable = ruleBody('.turntable');
  const mobile = blockBody(css, '@media (max-width: 767px)');

  assert.match(shell, /grid-template-areas:/);
  assert.doesNotMatch(turntable, /border-radius:\s*(?:[1-9][0-9]|[1-9]\d{2,})px/);
  assert.match(mobile, /\.app-shell\s*\{[\s\S]*grid-template-areas:\s*"header"\s*"stage"\s*"meta"\s*"controls"/);
  assert.match(mobile, /\.turntable\s*\{[\s\S]*width:\s*min\(86vw,\s*min\(62svh,\s*340px\)\)/);
  assert.match(mobile, /\.play-btn\s*\{[\s\S]*max-width:\s*100%/);
});

test('obsolete loading chrome stays removed from the visual layer', () => {
  assert.doesNotMatch(css, /\.loading-progress-rail\b/);
});
