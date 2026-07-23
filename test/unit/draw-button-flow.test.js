import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

const ruleBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
};

test('draw button perimeter flow is a masked one-pixel cool-light trace', () => {
  const flow = ruleBody('.btn-sheen::before');

  assert.match(css, /@property\s+--btn-flow-angle\s*\{[\s\S]*?syntax:\s*"<angle>"/);
  assert.match(flow, /content:\s*""/);
  assert.match(flow, /position:\s*absolute/);
  assert.match(flow, /inset:\s*0/);
  assert.match(flow, /padding:\s*1px/);
  assert.match(flow, /border-radius:\s*inherit/);
  assert.match(flow, /conic-gradient\(from var\(--btn-flow-angle\)/);
  assert.match(flow, /var\(--cover-a\)/);
  assert.match(flow, /var\(--cover-b\)/);
  assert.match(flow, /rgba\(238,\s*248,\s*255,\s*0\.96\)/);
  assert.match(flow, /-webkit-mask:[\s\S]*content-box/);
  assert.match(flow, /-webkit-mask-composite:\s*xor/);
  assert.match(flow, /mask:[\s\S]*content-box/);
  assert.match(flow, /mask-composite:\s*exclude/);
  assert.match(flow, /opacity:\s*0/);

  assert.doesNotMatch(flow, /\b(?:filter|mix-blend-mode|box-shadow|will-change|width|height|transform|scale)\s*:/);
  assert.doesNotMatch(flow, /hue-rotate|rainbow/i);
});

test('full and compact flow profiles keep a 1200ms orbit and bounded peaks', () => {
  assert.match(css, /btn-perimeter-orbit-full\s+7200ms\s+cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)\s+infinite/);
  assert.match(css, /btn-perimeter-fade-full\s+7200ms\s+linear\s+infinite/);
  assert.match(css, /@keyframes btn-perimeter-orbit-full\s*\{[\s\S]*?16\.667%,\s*100%\s*\{\s*--btn-flow-angle:\s*1turn/);
  assert.match(css, /@keyframes btn-perimeter-fade-full\s*\{[\s\S]*?8\.333%\s*\{\s*opacity:\s*0\.72/);

  assert.match(css, /btn-perimeter-orbit-compact\s+9600ms\s+cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)\s+infinite/);
  assert.match(css, /btn-perimeter-fade-compact\s+9600ms\s+linear\s+infinite/);
  assert.match(css, /@keyframes btn-perimeter-orbit-compact\s*\{[\s\S]*?12\.5%,\s*100%\s*\{\s*--btn-flow-angle:\s*1turn/);
  assert.match(css, /@keyframes btn-perimeter-fade-compact\s*\{[\s\S]*?6\.25%\s*\{\s*opacity:\s*0\.58/);
});

test('flow stops for unavailable controls and is absent under reduced motion', () => {
  assert.match(css, /\.play-btn\[data-busy\]\s+\.btn-sheen::before/);
  assert.match(css, /body\.has-lyric-overlay\s+\.btn-sheen::before/);
  assert.match(css, /body\.has-playlist-overlay\s+\.btn-sheen::before/);
  assert.match(css, /#loadingScreen\s*~\s*#appRoot\s+\.btn-sheen::before/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.btn-sheen::before[\s\S]*?animation:\s*none\s*!important[\s\S]*?opacity:\s*0\s*!important/);
  assert.match(html, /<span class="btn-sheen" aria-hidden="true"><\/span>/);
});
