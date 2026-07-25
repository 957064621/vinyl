import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
const archiveMarker = '/* Directional archive system */';
const archiveStart = css.indexOf(archiveMarker);

assert.notEqual(archiveStart, -1, 'missing terminal directional archive section');

const archiveCss = css.slice(archiveStart);

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const blockBody = (source, marker) => {
  const start = source.indexOf(marker);
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

const exactRuleBody = (source, selector) => {
  const matcher = new RegExp(`(?:^|\\n)\\s*${escapeRegExp(selector)}\\s*\\{`, 'm');
  const match = matcher.exec(source);
  assert.ok(match, `missing exact CSS rule: ${selector}`);
  const selectorStart = match.index + match[0].indexOf(selector);

  const open = source.indexOf('{', selectorStart);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, index);
  }

  assert.fail(`unterminated CSS rule: ${selector}`);
};

const sourceRuleBody = (selector) => exactRuleBody(css, selector);
const archiveRuleBody = (selector) => exactRuleBody(archiveCss, selector);
const archiveMediaBody = (query) => blockBody(archiveCss, `@media ${query} {`);

const transitionProperties = (declaration) => {
  const value = declaration.trim().replace(/\s*!important\b/g, '');
  if (value === 'none') return ['none'];

  return [...value.matchAll(/(?:^|,)\s*([a-z-]+)\s+(?=(?:\d|var\())/g)]
    .map((match) => match[1]);
};

const activeRuleTransitions = (source) => {
  const rules = [...source.matchAll(/(^|\n)\s*([^{}]+:active[^{}]*)\{([^{}]*)\}/g)];

  return rules.flatMap((match) => {
    const selector = match[2].trim();
    const body = match[3];
    const values = [...body.matchAll(/\btransition\s*:\s*([\s\S]*?);/g)]
      .map((transition) => transition[1]);
    const properties = values.flatMap(transitionProperties);
    const transitionPropertyValues = [...body.matchAll(/\btransition-property\s*:\s*([\s\S]*?);/g)]
      .flatMap((transition) => transition[1].trim().replace(/\s*!important\b/g, '').split(/\s*,\s*/));

    return properties.length || transitionPropertyValues.length
      ? [{ selector, properties: [...properties, ...transitionPropertyValues] }]
      : [];
  });
};

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

  assert.match(archiveRuleBody('.header h1'), /font-family:\s*var\(--font-title\)/);
  assert.match(archiveRuleBody('.lyric-text'), /font-family:\s*var\(--font-title\)/);
  assert.match(archiveRuleBody('.archive-track-meta'), /font-family:\s*var\(--font-ui\)/);
});

test('the viewport uses only two directional projector fields', () => {
  const fields = [sourceRuleBody('body::before'), sourceRuleBody('body::after')];

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
  assert.doesNotMatch(css, /(?:-webkit-)?backdrop-filter\s*:/);
  assert.doesNotMatch(css, /\bwill-change\s*:/);
});

test('fullscreen layers use a stable fallback and dynamic viewport height', () => {
  assert.doesNotMatch(css, /\b100lvh\b/);

  for (const selector of ['.loading-screen', '.loading-light-slit', '.result-area', '.playlist-area']) {
    assert.match(
      sourceRuleBody(selector),
      /height:\s*100vh;\s*height:\s*100dvh;/,
      `${selector} should fall back from vh to dvh`
    );
  }
});

test('terminal desktop, tablet, and mobile layout rules keep the stage bounded', () => {
  const shell = archiveRuleBody('.app-shell');
  const turntable = archiveRuleBody('.turntable');
  const tablet = archiveMediaBody('(min-width: 768px) and (max-width: 1023px)');
  const mobile = archiveMediaBody('(max-width: 767px)');

  assert.match(shell, /grid-template-columns:\s*minmax\(176px,\s*0\.8fr\)\s+minmax\(300px,\s*380px\)\s+minmax\(176px,\s*0\.8fr\)/);
  assert.match(shell, /grid-template-areas:\s*"header stage meta"\s*"header controls meta"/);
  assert.match(archiveRuleBody('.header'), /grid-area:\s*header/);
  assert.match(archiveRuleBody('.vinyl-wrapper'), /grid-area:\s*stage/);
  assert.match(archiveRuleBody('.archive-track-meta'), /grid-area:\s*meta/);
  assert.match(archiveRuleBody('.dynamic-island'), /grid-area:\s*controls/);
  assert.match(turntable, /border-radius:\s*0/);
  assert.match(turntable, /background:\s*transparent/);
  assert.match(turntable, /box-shadow:\s*none/);

  assert.match(tablet, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(280px,\s*340px\)/);
  assert.match(tablet, /grid-template-areas:\s*"header stage"\s*"meta stage"\s*"controls stage"/);
  assert.match(tablet, /column-gap:\s*clamp\(24px,\s*4vw,\s*40px\)/);

  assert.match(mobile, /\.app-shell\s*\{[\s\S]*grid-template-areas:\s*"header"\s*"stage"\s*"meta"\s*"controls"/);
  assert.match(mobile, /\.turntable\s*\{[\s\S]*width:\s*min\(86vw,\s*min\(62svh,\s*340px\)\)/);
  assert.match(mobile, /\.play-btn\s*\{[\s\S]*max-width:\s*100%/);
  assert.match(mobile, /\.btn-label-viewport,[\s\S]*\.btn-text\s*\{[\s\S]*max-width:\s*100%/);
});

test('terminal interaction and error states use the archive palette with compact radii', () => {
  const hover = archiveMediaBody('(hover: hover) and (pointer: fine)');
  const audioStatus = archiveRuleBody('.audio-status');
  const audioRetry = archiveRuleBody('.audio-retry');
  const groupCover = archiveRuleBody('.playlist-group::before');

  assert.match(audioStatus, /border-left-color:\s*var\(--archive-red\)/);
  assert.match(audioStatus, /background:\s*var\(--archive-graphite\)/);
  assert.match(audioStatus, /color:\s*var\(--archive-projector\)/);
  assert.match(audioRetry, /border-color:\s*color-mix\(in srgb,\s*var\(--archive-silver\)/);
  assert.match(audioRetry, /background:\s*var\(--archive-slate\)/);
  assert.match(audioRetry, /color:\s*var\(--archive-projector\)/);
  assert.match(hover, /\.audio-status \.audio-retry:not\(:disabled\):hover\s*\{[\s\S]*border-color:\s*var\(--archive-projector\)/);
  assert.match(archiveCss, /\.audio-status \.audio-retry:focus-visible\s*\{[\s\S]*outline:\s*2px solid var\(--archive-projector\)/);
  assert.match(archiveCss, /\.result-area\.is-visible \.overlay-close-btn:active,[\s\S]*\.audio-status \.audio-retry:not\(:disabled\):active\s*\{[\s\S]*background:\s*var\(--archive-void\)/);
  assert.doesNotMatch(archiveCss, /rgba\(255,\s*151,\s*135/);
  assert.match(groupCover, /border-radius:\s*6px/);

  const fixedRadii = [...archiveCss.matchAll(/\bborder-radius\s*:\s*(\d+)px/g)]
    .map((match) => Number(match[1]));
  assert.ok(fixedRadii.length > 0, 'expected terminal fixed-radius rules');
  assert.ok(fixedRadii.every((radius) => radius <= 8), `terminal panel/tile radius exceeds 8px: ${fixedRadii.join(', ')}`);
});

test('active states transition only composited properties', () => {
  const terminalActiveRules = [
    '.play-btn:active',
    '.player-ctrl-btn:active',
    '.lyric-toggle-btn.is-visible:active,\n        .playlist-toggle-btn.is-visible:active,\n        .result-area.is-visible .overlay-close-btn:active,\n        .playlist-area.is-visible .overlay-close-btn:active,\n        .playlist-mode-switch:active,\n        .audio-status .audio-retry:not(:disabled):active'
  ];

  for (const selector of terminalActiveRules) {
    const rule = archiveRuleBody(selector);
    const properties = [...rule.matchAll(/\btransition\s*:\s*([\s\S]*?);/g)]
      .flatMap((match) => transitionProperties(match[1]));
    assert.deepEqual(properties, ['transform', 'opacity'], `${selector} must explicitly transition only transform and opacity`);
  }

  const activeTransitions = activeRuleTransitions(css);
  assert.ok(activeTransitions.length > 0, 'expected active-state transition declarations');
  for (const { selector, properties } of activeTransitions) {
    assert.ok(
      properties.every((property) => ['transform', 'opacity', 'none'].includes(property)),
      `${selector} transitions forbidden active-state properties: ${properties.join(', ')}`
    );
  }
});

test('archive transitions are composited and reduce states are instant', () => {
  const compactBeam = blockBody(archiveCss, 'html[data-motion-profile="compact"] body::before,');
  const reduceBeam = blockBody(archiveCss, 'html[data-motion-profile="reduce"] body::before,');
  const reducedMedia = archiveMediaBody('(prefers-reduced-motion: reduce)');
  const reducedProfile = blockBody(archiveCss, 'html[data-motion-profile="reduce"] .header,');
  const transitionValues = [...archiveCss.matchAll(/\btransition\s*:\s*([\s\S]*?);/g)]
    .map((match) => match[1]);
  const properties = transitionValues.flatMap(transitionProperties);

  for (const profile of [compactBeam, reduceBeam]) {
    assert.match(profile, /animation:\s*none/);
    assert.match(profile, /filter:\s*none/);
    assert.match(profile, /box-shadow:\s*none/);
  }

  for (const selector of ['.turntable', '.vinyl-record', '.play-btn', '.result-area', '.playlist-area', '.lyric-text']) {
    assert.match(reducedMedia, new RegExp(selector.replaceAll('.', '\\.')));
    assert.match(archiveCss, new RegExp(`html\\[data-motion-profile="reduce"\\] ${selector.replaceAll('.', '\\.')}`));
  }

  for (const reduced of [reducedMedia, reducedProfile]) {
    assert.match(reduced, /animation:\s*none\s*!important/);
    assert.match(reduced, /filter:\s*none\s*!important/);
    assert.match(reduced, /transition:\s*none\s*!important/);
  }

  assert.ok(properties.length > 0, 'expected archive transition declarations');
  assert.ok(
    properties.every((property) => ['opacity', 'transform', 'none'].includes(property)),
    `archive transitions include non-composited properties: ${properties.join(', ')}`
  );
  assert.doesNotMatch(archiveCss, /\btransition(?:-property)?\s*:\s*all\b/);
  assert.match(archiveRuleBody('.vinyl-cover'), /transition:\s*opacity\s+0\.82s\s+var\(--crossfade-ease\),\s*transform\s+0\.82s\s+var\(--continuity-ease\)/);
  assert.match(archiveRuleBody('.tonearm-dock'), /transition:\s*opacity\s+0\.32s\s+var\(--continuity-ease\)/);
  assert.match(archiveRuleBody('body.is-track-transitioning .playlist-content'), /filter:\s*none/);
  assert.match(archiveRuleBody('body.is-track-transitioning .playlist-content'), /transition:\s*transform\s+0\.24s\s+var\(--continuity-ease\),\s*opacity\s+0\.24s\s+var\(--continuity-ease\)/);
  assert.match(archiveRuleBody('.player-track-bg'), /transition:\s*none/);
});

test('obsolete loading chrome stays removed from the visual layer', () => {
  assert.doesNotMatch(css, /\.loading-progress-rail\b/);
});
