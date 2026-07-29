import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Windows checkouts may smudge CRLF endings; the rule regexes embed \n.
const readSource = (url) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
const css = readSource(new URL('../../src/style.css', import.meta.url));
const html = readSource(new URL('../../index.html', import.meta.url));
const script = readSource(new URL('../../src/main.js', import.meta.url));

const ruleBody = (selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]+)\\}`, 'm'));
  assert.ok(match, `missing CSS rule: ${selector}`);
  return match[1];
};

const keyframeBody = (name) => {
  const start = css.search(new RegExp(`@keyframes\\s+${name}\\s*\\{`));
  assert.notEqual(start, -1, `missing keyframe: ${name}`);
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  assert.fail(`unterminated keyframe: ${name}`);
};

const capabilityGateBody = () => {
  const start = css.indexOf('@supports ((-webkit-mask-composite: xor) or (mask-composite: exclude)) and (background: conic-gradient(from 0deg, transparent, white))');
  assert.notEqual(start, -1, 'missing mask + conic-gradient capability gate');
  const open = css.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === '{') depth += 1;
    if (css[index] === '}') depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  assert.fail('unterminated capability gate');
};

test('draw button perimeter light preserves the locked pill geometry', () => {
  const perimeter = ruleBody('.btn-sheen::before');
  const sheen = ruleBody('.btn-sheen');
  const halo = ruleBody('.play-btn::after');
  const button = ruleBody('.play-btn');

  assert.match(button, /width:\s*136px/);
  assert.match(button, /height:\s*48px/);
  assert.match(button, /letter-spacing:\s*0/);
  assert.match(button, /border-radius:\s*999px/);
  assert.match(button, /justify-content:\s*center/);
  assert.match(button, /align-items:\s*center/);
  assert.match(sheen, /padding:\s*1px/);
  assert.match(sheen, /border-radius:\s*inherit/);
  assert.match(sheen, /-webkit-mask:[\s\S]*content-box/);
  assert.match(sheen, /mask:[\s\S]*content-box/);
  assert.match(sheen, /mask-composite:\s*exclude/);
  assert.match(perimeter, /top:\s*50%/);
  assert.match(perimeter, /left:\s*50%/);
  assert.match(perimeter, /width:\s*300%/);
  assert.match(perimeter, /aspect-ratio:\s*1/);
  assert.match(perimeter, /border-radius:\s*inherit/);
  assert.match(perimeter, /rgba\(174,\s*182,\s*185,\s*0\.32\)/);
  assert.match(perimeter, /rgba\(241,\s*242,\s*238,\s*0\.96\)/);
  assert.match(perimeter, /rgba\(164,\s*59,\s*66,\s*0\.38\)/);
  assert.match(perimeter, /var\(--archive-projector\)/);
  assert.match(perimeter, /var\(--archive-silver\)/);
  assert.match(perimeter, /var\(--archive-red\)/);
  assert.match(perimeter, /var\(--cover-accent\)/);
  assert.match(halo, /filter:\s*blur\(\d+px\)/);
  assert.match(halo, /transparent 38%,\s*rgba\(241,\s*242,\s*238,\s*0\.34\) 72%,\s*transparent 100%/);
  assert.match(halo, /transparent 38%,\s*color-mix\(in srgb, var\(--cover-accent\) 34%, transparent\) 72%,\s*transparent 100%/);
  assert.match(css, /\.play-btn:active\s*\{[\s\S]*?--button-y:\s*1px[\s\S]*?--button-scale:\s*0\.972/);
  assert.match(html, /<span class="btn-sheen" aria-hidden="true"><\/span>/);
});

test('full idle state has one synchronized transform and opacity light pass', () => {
  const perimeter = ruleBody('.btn-sheen::before');
  const halo = ruleBody('.play-btn::after');
  const pass = keyframeBody('btn-perimeter-pass');
  const pulse = keyframeBody('btn-halo-pulse');

  assert.equal((css.match(/@keyframes\s+btn-perimeter-pass\b/g) || []).length, 1);
  assert.equal((css.match(/@keyframes\s+btn-halo-pulse\b/g) || []).length, 1);
  assert.match(css, /--btn-light-cycle:\s*7200ms/);
  assert.match(css, /--btn-light-active-window:\s*94\.444%/);
  assert.match(css, /html\[data-motion-profile="full"\]\s+\.play-btn:not\(\[data-busy\]\):not\(:disabled\)\s+\.btn-sheen::before[\s\S]*?btn-perimeter-pass\s+var\(--btn-light-cycle\)\s+cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)\s+infinite/);
  assert.match(css, /html\[data-motion-profile="full"\]\s+\.play-btn:not\(\[data-busy\]\):not\(:disabled\)::after[\s\S]*?btn-halo-pulse\s+var\(--btn-light-cycle\)\s+cubic-bezier\(0\.32,\s*0\.72,\s*0,\s*1\)\s+infinite/);
  assert.match(pulse, /0%,\s*100%\s*\{[\s\S]*?opacity:\s*0/);
  assert.match(pass, /0%\s*\{[\s\S]*?transform:\s*translate3d\(-50%,\s*-50%,\s*0\)\s*rotate\(0turn\)/);
  assert.match(pass, /5\.556%\s*\{\s*opacity:\s*0\.58;\s*\}/);
  assert.match(pass, /66\.667%\s*\{\s*opacity:\s*0\.26;\s*\}/);
  assert.match(pass, /100%\s*\{[\s\S]*?transform:\s*translate3d\(-50%,\s*-50%,\s*0\)\s*rotate\(1turn\)/);
  assert.equal(
    (pass.match(/transform:/g) || []).length,
    2,
    'the lap must keep exactly two rotation stops so the sweep runs one uninterrupted easing segment'
  );
  assert.match(pass, /transform:/);
  assert.match(pass, /opacity:/);
  assert.match(pulse, /transform:/);
  assert.match(pulse, /opacity:/);
  assert.doesNotMatch(pass, /(?:filter|background|box-shadow|--[\w-]+)\s*:/);
  assert.doesNotMatch(pulse, /(?:filter|background|box-shadow|--[\w-]+)\s*:/);
  assert.doesNotMatch(perimeter, /will-change\s*:/);
  assert.doesNotMatch(halo, /will-change\s*:/);
});

test('compact keeps a slower compositor light loop while reduced motion remains absent', () => {
  const capabilityGate = capabilityGateBody();
  assert.match(css, /--btn-light-cycle-compact:\s*9200ms/);
  assert.match(capabilityGate, /html\[data-motion-profile="compact"\]\s+\.play-btn:not\(\[data-busy\]\):not\(:disabled\)\s+\.btn-sheen::before\s*\{[\s\S]*?btn-perimeter-pass\s+var\(--btn-light-cycle-compact\)[\s\S]*?infinite/);
  assert.doesNotMatch(capabilityGate, /html\[data-motion-profile="compact"\][\s\S]*?\.play-btn:not\(\[data-busy\]\):not\(:disabled\)::after/);
  assert.match(css, /html\[data-motion-profile="compact"\]\s+\.play-btn:not\(\[data-busy\]\):not\(:disabled\)::after\s*\{[\s\S]*?btn-halo-pulse\s+var\(--btn-light-cycle-compact\)[\s\S]*?infinite/);
  assert.match(css, /html\[data-motion-profile="reduce"\]\s+\.btn-sheen::before[\s\S]*?animation:\s*none\s*!important[\s\S]*?opacity:\s*0\s*!important/);
  assert.match(css, /html\[data-motion-profile="reduce"\]\s+\.play-btn::after[\s\S]*?animation:\s*none\s*!important[\s\S]*?opacity:\s*0\s*!important/);

  const stopped = [
    '.play-btn[data-busy] .btn-sheen::before',
    '.play-btn:disabled .btn-sheen::before',
    'html[data-document-hidden] .btn-sheen::before',
    '#loadingScreen ~ #appRoot .btn-sheen::before',
    'body.has-lyric-overlay .btn-sheen::before',
    'body.has-playlist-overlay .btn-sheen::before',
    '.dynamic-island.is-opening .btn-sheen::before',
    '.dynamic-island.is-collapsing .btn-sheen::before'
  ];
  for (const selector of stopped) assert.match(css, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(css, /\.play-btn\[data-busy\][\s\S]*?\.play-btn:disabled[\s\S]*?html\[data-document-hidden\][\s\S]*?#loadingScreen[\s\S]*?animation:\s*none/);
  assert.match(script, /document\.documentElement\.toggleAttribute\('data-document-hidden',\s*document\.hidden\);\s*document\.addEventListener\('visibilitychange'/);
  assert.match(script, /document\.addEventListener\('visibilitychange',\s*\(\)\s*=>\s*\{\s*document\.documentElement\.toggleAttribute\('data-document-hidden',\s*document\.hidden\)/);
});

test('draw button pointer light is local, damped, finite, and fully gated', () => {
  const button = ruleBody('.play-btn');
  const surface = ruleBody('.play-btn::before');

  assert.match(button, /--btn-spot-x:\s*35%/);
  assert.match(button, /--btn-spot-y:\s*0%/);
  assert.match(button, /--btn-spot-strength:\s*0%/);
  assert.match(surface, /radial-gradient\(\s*circle at var\(--btn-spot-x\) var\(--btn-spot-y\)/);
  assert.match(surface, /var\(--btn-spot-strength\)/);
  assert.doesNotMatch(surface, /mix-blend-mode/);

  assert.match(script, /DRAW_BUTTON_SPOT_EASE\s*=\s*0\.22/);
  assert.match(script, /DRAW_BUTTON_SPOT_FADE_EASE\s*=\s*0\.16/);
  assert.match(script, /DRAW_BUTTON_SPOT_STOP_THRESHOLD\s*=\s*0\.06/);
  assert.match(script, /matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)/);
  assert.match(script, /document\.documentElement\.dataset\.motionProfile\s*===\s*'full'/);
  assert.match(script, /!playButton\.hasAttribute\('data-busy'\)/);
  assert.match(script, /playButton\.style\.setProperty\('--btn-spot-x'/);
  assert.match(script, /playButton\.style\.setProperty\('--btn-spot-y'/);
  assert.match(script, /playButton\.style\.setProperty\('--btn-spot-strength'/);
  assert.match(script, /playButton\.style\.removeProperty\('--btn-spot-x'\)/);
  assert.match(script, /playButton\.style\.removeProperty\('--btn-spot-y'\)/);
  assert.match(script, /playButton\.style\.removeProperty\('--btn-spot-strength'\)/);
  assert.match(script, /playButton\.addEventListener\('pointerleave',\s*releaseDrawButtonSpotlight\)/);
  assert.match(script, /drawButtonSpotPhase\s*=\s*'leaving'/);
  assert.match(script, /drawButtonSpotTargetX\s*=\s*DRAW_BUTTON_SPOT_DEFAULT_X/);
  assert.match(script, /drawButtonSpotTargetStrength\s*=\s*0/);
  assert.match(script, /window\.addEventListener\('blur',\s*resetPointerEffects\)/);
  assert.match(script, /setPlayButtonBusy\(isDrawing\);\s*if \(isDrawing\) resetDrawButtonSpotlight\(\)/);
  assert.match(script, /if \(document\.hidden\) \{[\s\S]*?resetDrawButtonSpotlight\(\)/);
  assert.match(script, /if \(nextProfile !== 'full'\) resetDrawButtonSpotlight\(\)/);
});
