import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Windows checkouts may smudge CRLF endings; the selector regexes embed \n.
const readSource = (url) => readFileSync(url, 'utf8').replace(/\r\n/g, '\n');
const css = readSource(new URL('../../src/style.css', import.meta.url));
const mainSource = readSource(new URL('../../src/main.js', import.meta.url));
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

const splitTopLevel = (value, separator) => {
  const values = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '(') depth += 1;
    if (value[index] === ')') depth -= 1;
    if (depth < 0) return null;
    if (depth === 0 && (separator === ' ' ? /\s/.test(value[index]) : value[index] === separator)) {
      values.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (depth !== 0) return null;
  values.push(value.slice(start).trim());
  return values;
};

const normalizeCssIdentifier = (value) => value.trim().toLowerCase();

const interactionTransitionProperties = new Set([
  'transform',
  'opacity',
  'color',
  'background',
  'border-color',
  'box-shadow',
  'text-shadow',
  'none'
]);

const transitionProperties = (declaration) => {
  const value = declaration.trim().replace(/\s*!important\b/gi, '');
  if (normalizeCssIdentifier(value) === 'none') return ['none'];

  const transitions = splitTopLevel(value, ',');
  if (!transitions?.length) return null;

  const timingKeywords = new Set(['ease', 'ease-in', 'ease-out', 'ease-in-out', 'linear', 'step-start', 'step-end']);
  const behaviorKeywords = new Set(['normal', 'allow-discrete']);
  const timingFunction = /^(?:cubic-bezier|steps|linear|var)\(.+\)$/i;
  const time = /^(?:0|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:ms|s))$/i;

  const properties = transitions.map((transition) => {
    const tokens = splitTopLevel(transition, ' ')?.filter(Boolean);
    if (!tokens?.length) return null;

    const properties = tokens
      .map(normalizeCssIdentifier)
      .filter((token) => !time.test(token) && !timingKeywords.has(token) && !behaviorKeywords.has(token) && !timingFunction.test(token));
    return properties.length === 1 && interactionTransitionProperties.has(properties[0])
      ? properties[0]
      : null;
  });

  return properties.every(Boolean) ? properties : null;
};

const activeRuleTransitions = (source) => {
  const rules = [...source.matchAll(/(?:(?<![\s\S])|(?<=[{}]))\s*([^{}]+:active[^{}]*)\{([^{}]*)\}/gi)];

  return rules.flatMap((match) => {
    const selector = match[1].trim();
    const body = match[2];
    const values = [...body.matchAll(/\btransition\s*:\s*([\s\S]*?);/gi)]
      .map((transition) => transition[1]);
    const shorthandProperties = values.map(transitionProperties);
    const transitionPropertyValues = [...body.matchAll(/\btransition-property\s*:\s*([\s\S]*?);/gi)]
      .flatMap((transition) => transition[1].trim().replace(/\s*!important\b/gi, '').split(/\s*,\s*/).map(normalizeCssIdentifier));
    const forbiddenLonghands = [...body.matchAll(/\btransition-([a-z-]+)\s*:/gi)]
      .map((longhand) => normalizeCssIdentifier(longhand[1]))
      .filter((longhand) => longhand !== 'property');
    const properties = shorthandProperties.flat().concat(transitionPropertyValues);

    return values.length || transitionPropertyValues.length || forbiddenLonghands.length
      ? [{ selector, properties, invalidShorthand: shorthandProperties.some((properties) => properties === null), forbiddenLonghands }]
      : [];
  });
};

const assertActiveTransitionsSafe = (source) => {
  const activeTransitions = activeRuleTransitions(source);
  assert.ok(activeTransitions.length > 0, 'expected active-state transition declarations');

  for (const { selector, properties, invalidShorthand, forbiddenLonghands } of activeTransitions) {
    assert.ok(!invalidShorthand, `${selector} contains an unparseable or forbidden active transition shorthand`);
    assert.deepEqual(forbiddenLonghands, [], `${selector} contains forbidden active transition longhands: ${forbiddenLonghands.join(', ')}`);
    assert.ok(
      properties.every((property) => interactionTransitionProperties.has(property)),
      `${selector} transitions forbidden active-state properties: ${properties.join(', ')}`
    );
  }
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

test('uses the archive void token instead of the retired shell color', () => {
  assert.doesNotMatch(css, /#070a12/i);
  assert.match(sourceRuleBody('.loading-screen'), /background:\s*var\(--archive-void\)/);
  assert.match(sourceRuleBody('.player-ctrl-btn'), /color:\s*var\(--archive-void\)/);
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
  const willChangeDeclarations = [...css.matchAll(/\bwill-change\s*:\s*([^;]+);/g)]
    .map((match) => match[1].trim());
  assert.deepEqual(willChangeDeclarations, ['transform, clip-path']);
  assert.match(
    sourceRuleBody('.loading-screen.is-final-resolving[data-handoff-ready="true"] .loading-image[data-loading-handoff="true"]'),
    /will-change:\s*transform, clip-path/,
    'the only promoted layer is the short-lived final poster handoff'
  );
});

test('overlay surfaces are true glass with a graceful non-blur fallback', () => {
  const overlayShell = archiveRuleBody('.result-area,\n        .playlist-area');

  assert.match(overlayShell, /--overlay-backdrop-filter:\s*blur\(28px\) saturate\(1\.24\)/);
  assert.match(overlayShell, /-webkit-backdrop-filter:\s*var\(--overlay-backdrop-filter\)/);
  assert.match(overlayShell, /(?<!-webkit-)backdrop-filter:\s*var\(--overlay-backdrop-filter\)/);
  assert.match(overlayShell, /color-mix\(in srgb, var\(--archive-void\) 30%, transparent\)/, 'the veil must stay sheer enough to see the stage');
  assert.match(
    archiveCss,
    /\.playlist-content\s*\{[^}]*--playlist-panel-backdrop-filter:\s*blur\(18px\) saturate\(1\.3\)[^}]*-webkit-backdrop-filter:\s*var\(--playlist-panel-backdrop-filter\)/s,
    'the playlist panel needs its own glass layer'
  );
  assert.match(
    archiveCss,
    /\.playlist-content\s*\{[^}]*(?<!-webkit-)backdrop-filter:\s*var\(--playlist-panel-backdrop-filter\)/s,
    'the playlist panel needs its own glass layer'
  );

  const fallbackGates = archiveCss.match(
    /@supports not \(\(-webkit-backdrop-filter: blur\(1px\)\) or \(backdrop-filter: blur\(1px\)\)\)/g
  ) || [];
  assert.equal(fallbackGates.length, 2, 'both glass surfaces need a denser non-blur fallback');

  const glassDeclarations = css.match(/(?<!-webkit-)backdrop-filter\s*:\s*var\(--(?:overlay|playlist-panel)-backdrop-filter\)/g) || [];
  assert.equal(glassDeclarations.length, 2, 'glass blur stays confined to the two overlay surfaces');
  assert.match(css, /html\[data-motion-profile="compact"\] \.playlist-area\s*\{[^}]*--overlay-backdrop-filter:\s*blur\(16px\) saturate\(1\.12\)/s);
  assert.match(css, /html\[data-motion-profile="compact"\] \.playlist-content\s*\{[^}]*--playlist-panel-backdrop-filter:\s*none/s);
});

test('fullscreen layers use a stable fallback and dynamic viewport height', () => {
  assert.doesNotMatch(css, /\b100lvh\b/);

  for (const [selector, height] of [
    ['.loading-screen', 100],
    ['.loading-light-slit', 140],
    ['.result-area', 100],
    ['.playlist-area', 100]
  ]) {
    assert.match(
      sourceRuleBody(selector),
      new RegExp(`height:\\s*${height}vh;\\s*height:\\s*${height}dvh;`),
      `${selector} should fall back from vh to dvh`
    );
  }
});

test('terminal desktop, tablet, and mobile layout rules keep the stage bounded', () => {
  const shell = archiveRuleBody('.app-shell');
  const turntable = archiveRuleBody('.turntable');
  const tablet = archiveMediaBody('(min-width: 768px) and (max-width: 1023px)');
  const mobile = archiveMediaBody('(max-width: 767px)');

  assert.match(shell, /grid-template-columns:\s*minmax\(176px,\s*0\.8fr\)\s+minmax\(300px,\s*420px\)\s+minmax\(176px,\s*0\.8fr\)/);
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
  assert.match(mobile, /\.turntable\s*\{[\s\S]*width:\s*var\(--mobile-content-rail\)/);
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
  assert.match(
    archiveRuleBody('.lyric-toggle-btn.is-visible:active,\n        .playlist-toggle-btn.is-visible:active,\n        .playlist-mode-switch:active,\n        .audio-status .audio-retry:not(:disabled):active'),
    /background:\s*color-mix\(in srgb, var\(--archive-void\) 62%, transparent\)/
  );
  assert.match(
    archiveRuleBody('.result-area.is-visible .overlay-close-btn:active,\n        .playlist-area.is-visible .overlay-close-btn:active'),
    /background:\s*color-mix\(in srgb, var\(--archive-void\) 62%, transparent\)/
  );

  // 播放页控件是透光玻璃，不是实心色块。
  assert.match(archiveRuleBody('.play-btn'), /background:\s*color-mix\(in srgb, var\(--archive-graphite\) 46%, transparent\)/);
  assert.match(archiveRuleBody('.player-pill'), /background:\s*color-mix\(in srgb, var\(--archive-slate\) 48%, transparent\)/);
  assert.match(archiveRuleBody('.player-ctrl-btn'), /background:\s*color-mix\(in srgb, var\(--archive-projector\) 16%, transparent\)/);
  assert.match(archiveRuleBody('.player-ctrl-btn'), /color:\s*var\(--archive-projector\)/);
  assert.match(
    archiveRuleBody('.lyric-toggle-btn,\n        .playlist-toggle-btn,\n        .overlay-close-btn'),
    /background:\s*color-mix\(in srgb, var\(--archive-slate\) 48%, transparent\)/
  );
  assert.doesNotMatch(archiveCss, /rgba\(255,\s*151,\s*135/);
  assert.match(groupCover, /border-radius:\s*6px/);

  const fixedRadii = [...archiveCss.matchAll(/\bborder-radius\s*:\s*(\d+)px/g)]
    .map((match) => Number(match[1]));
  assert.ok(fixedRadii.length > 0, 'expected terminal fixed-radius rules');
  assert.ok(fixedRadii.every((radius) => radius <= 8), `terminal panel/tile radius exceeds 8px: ${fixedRadii.join(', ')}`);
});

test('active states use an explicit interaction-property whitelist', () => {
  const terminalActiveRules = new Map([
    ['.play-btn:active', ['transform', 'opacity', 'background', 'box-shadow']],
    ['.player-ctrl-btn:active', ['transform', 'opacity', 'color', 'border-color', 'background', 'box-shadow']],
    ['.lyric-toggle-btn.is-visible:active,\n        .playlist-toggle-btn.is-visible:active,\n        .playlist-mode-switch:active,\n        .audio-status .audio-retry:not(:disabled):active', ['transform', 'opacity', 'border-color', 'background', 'box-shadow']],
    ['.result-area.is-visible .overlay-close-btn:active,\n        .playlist-area.is-visible .overlay-close-btn:active', ['transform', 'opacity', 'border-color', 'background', 'box-shadow']]
  ]);

  for (const [selector, expectedProperties] of terminalActiveRules) {
    const rule = archiveRuleBody(selector);
    const properties = [...rule.matchAll(/\btransition\s*:\s*([\s\S]*?);/g)]
      .flatMap((match) => transitionProperties(match[1]));
    assert.deepEqual(properties, expectedProperties, `${selector} must explicitly transition its active visual state`);
  }

  assert.match(
    sourceRuleBody('.overlay-close-btn:active'),
    /transition:\s*transform\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*opacity\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*border-color\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*background\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*box-shadow\s+0\.1s\s+var\(--continuity-ease\)\s+0s;/,
    'the base overlay-close press transition must retain its 100ms continuity curve and zero delay'
  );

  assert.match(
    archiveRuleBody('.result-area.is-visible .overlay-close-btn:active,\n        .playlist-area.is-visible .overlay-close-btn:active'),
    /transition:\s*transform\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*opacity\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*border-color\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*background\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*box-shadow\s+0\.1s\s+var\(--continuity-ease\)\s+0s;/,
    'the terminal visible overlay-close rule must win the cascade with the restored 100ms continuity timing'
  );

  assert.deepEqual(
    transitionProperties('transform 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 160ms linear(0, 0.5 50%, 1)'),
    ['transform', 'opacity'],
    'commas inside timing functions must not split transition entries'
  );

  for (const [description, stylesheet] of [
    ['reordered shorthand', '.reordered:active { transition: filter ease 180ms; }'],
    ['uppercase shorthand and active selector', '.uppercase:ACTIVE { TRANSITION: filter 180ms; }'],
    ['compact forbidden rule', 'a {} .compact:AcTiVe { transition: filter 180ms; }'],
    ['opaque shorthand', '.opaque:active { transition: var(--active-transition); }'],
    ['forbidden longhand', '.longhand:active { transition: transform 180ms; transition-duration: 180ms; }'],
    ['uppercase transition-property', '.property:ACTIVE { TRANSITION-PROPERTY: filter; }']
  ]) {
    assert.throws(
      () => assertActiveTransitionsSafe(stylesheet),
      /forbidden|unparseable/,
      `${description} must not evade the active transition guard`
    );
  }

  assertActiveTransitionsSafe(css);
});

test('interactive controls smoothly transition only intentional visual properties', () => {
  const controls = [
    [sourceRuleBody('.loading-retry'), ['transform', 'color', 'border-color', 'background', 'box-shadow']],
    [sourceRuleBody('.loading-skip'), ['transform', 'opacity', 'color', 'border-color', 'background', 'box-shadow']],
    [archiveRuleBody('.play-btn'), ['transform', 'opacity', 'color', 'border-color', 'background', 'box-shadow']],
    [archiveRuleBody('.lyric-toggle-btn,\n        .playlist-toggle-btn,\n        .overlay-close-btn'), ['transform', 'opacity', 'color', 'border-color', 'background', 'box-shadow']],
    [archiveRuleBody('.playlist-mode-switch'), ['transform', 'opacity', 'color', 'border-color', 'background', 'box-shadow']],
    [archiveRuleBody('.player-ctrl-btn'), ['transform', 'opacity', 'color', 'border-color', 'background', 'box-shadow']],
    [archiveRuleBody('.audio-retry'), ['transform', 'opacity', 'color', 'border-color', 'background', 'box-shadow']],
    [archiveRuleBody('.playlist-item'), ['transform', 'opacity', 'color', 'background', 'box-shadow', 'text-shadow']],
    [sourceRuleBody('.footer-link'), ['transform', 'color', 'border-color', 'text-shadow']]
  ];

  for (const [rule, expectedProperties] of controls) {
    const transitions = [...rule.matchAll(/\btransition\s*:\s*([\s\S]*?);/g)]
      .flatMap((match) => transitionProperties(match[1]));
    assert.deepEqual(transitions, expectedProperties);
  }

  assert.doesNotMatch(css, /\btransition\s*:\s*all\b/i);
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
    properties.every((property) => interactionTransitionProperties.has(property)),
    `archive transitions include unapproved properties: ${properties.join(', ')}`
  );
  assert.doesNotMatch(archiveCss, /\btransition(?:-property)?\s*:\s*all\b/);
  assert.match(archiveRuleBody('.vinyl-cover'), /transition:\s*none/);
  assert.match(archiveRuleBody('.tonearm-dock'), /transition:\s*opacity\s+0\.32s\s+var\(--continuity-ease\)/);
  assert.match(archiveRuleBody('body.is-track-transitioning .playlist-content'), /filter:\s*none/);
  assert.match(archiveRuleBody('body.is-track-transitioning .playlist-content'), /transition:\s*transform\s+0\.24s\s+var\(--continuity-ease\),\s*opacity\s+0\.24s\s+var\(--continuity-ease\)/);
  assert.match(archiveRuleBody('.player-track-bg'), /transition:\s*none/);
});

test('linear wrappers are limited to physical motion and keyframes with explicit segment curves', () => {
  const linearCssDeclarations = [...css.matchAll(
    /(?:transition|animation)\s*:[^;]*\blinear\b[^;]*;/g
  )].map((match) => match[0].replace(/\s+/g, ' ').trim());
  const declarationCounts = Object.fromEntries(
    [...new Set(linearCssDeclarations)].map((declaration) => [
      declaration,
      linearCssDeclarations.filter((candidate) => candidate === declaration).length
    ])
  );

  assert.deepEqual(declarationCounts, {
    'animation: loading-poster-to-player-motion var(--loading-handoff-morph-ms, 1280ms) linear both, loading-poster-to-player-shape var(--loading-handoff-morph-ms, 1280ms) linear both;': 1,
    'animation: loading-vinyl-grooves-reveal var(--loading-player-reveal-ms, 794ms) linear var(--loading-player-reveal-delay-ms, 486ms) both;': 1,
    'animation: loading-vinyl-highlight-reveal var(--loading-player-reveal-ms, 794ms) linear var(--loading-player-reveal-delay-ms, 486ms) both;': 1,
    'animation: loading-vinyl-surface-reveal var(--loading-player-reveal-ms, 794ms) linear var(--loading-player-reveal-delay-ms, 486ms) both;': 1,
    'animation: loading-portal-stretch var(--portal-phase-ms, 760ms) linear both, loading-portal-luminance var(--portal-phase-ms, 760ms) linear both;': 2,
    'animation: loading-backdrop-reveal var(--final-resolve-ms, 1280ms) linear both;': 1,
    'animation: playlist-ring-orbit 16s linear infinite, playlist-panel-edge-breathe 9.8s var(--continuity-ease) infinite;': 1,
    'transition: opacity 120ms linear;': 2,
    'transition: transform 0.2s linear;': 2,
    'transition: opacity 120ms linear !important;': 2
  });

  const linearJavaScriptEasings = [...mainSource.matchAll(/easing:\s*['"]linear['"]/g)];
  assert.equal(linearJavaScriptEasings.length, 2);
  assert.match(mainSource, /const spinAnimation[\s\S]*?easing:\s*'linear'/);
  assert.match(mainSource, /const sheenAnimation[\s\S]*?easing:\s*'linear'/);
});

test('controls reserve a stable three-column rail and keep time inside the player', () => {
  const controls = archiveRuleBody('.dynamic-island');
  const player = archiveRuleBody('.player-pill');
  const track = archiveRuleBody('.player-track-wrap');
  const time = archiveRuleBody('.player-time');
  const mobile = archiveMediaBody('(max-width: 767px)');

  assert.match(controls, /--control-rail-width:\s*calc\(\(var\(--side-control-size\) \* 2\) \+ var\(--player-slot\) \+ \(var\(--side-control-gap\) \* 2\)\)/);
  assert.match(controls, /z-index:\s*130/);
  assert.match(player, /grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+max-content/);
  assert.match(track, /width:\s*auto/);
  assert.match(track, /min-width:\s*0/);
  assert.match(time, /min-inline-size:\s*5ch/);
  assert.match(time, /white-space:\s*nowrap/);
  assert.match(time, /font-variant-numeric:\s*tabular-nums/);
  assert.match(mobile, /--mobile-content-rail:\s*min\(calc\(100vw - 32px\),\s*340px\)/);
  assert.match(mobile, /--side-control-size:\s*44px/);
  assert.match(mobile, /\.vinyl-wrapper\s*\{[\s\S]*width:\s*var\(--mobile-content-rail\)/);
  assert.match(mobile, /\.archive-track-meta\s*\{[\s\S]*width:\s*min\(calc\(var\(--mobile-content-rail\) - 44px\),\s*300px\)/);
  assert.match(mobile, /\.dynamic-island\s*\{[\s\S]*width:\s*var\(--mobile-content-rail\)/);
});

test('overlays and playlist use cover-driven polarized light without animated blur', () => {
  const overlayLight = archiveRuleBody('.result-area::before,\n        .playlist-area::before');
  const selected = archiveRuleBody('.playlist-item.is-current');
  const selectedGlow = archiveRuleBody('.playlist-item.is-current::before');
  const selectedLine = archiveRuleBody('.playlist-item.is-current::after');
  const identity = archiveRuleBody('.playlist-album-identity');
  const drift = blockBody(archiveCss, '@keyframes overlay-polarized-drift {');
  const reducedLight = archiveRuleBody('html[data-motion-profile="reduce"] .result-area.is-visible::before,\n        html[data-motion-profile="reduce"] .playlist-area.is-visible::before');
  const pointerLight = archiveRuleBody('.pointer-light');

  assert.match(overlayLight, /var\(--cover-a\) calc\(72% - \(var\(--overlay-mix, 0\) \* 22%\)\)/, 'the primary accent ratio must drift with --overlay-mix');
  assert.match(overlayLight, /var\(--cover-b\) calc\(68% \+ \(var\(--overlay-mix, 0\) \* 20%\)\)/, 'the secondary accent ratio must drift against it');
  assert.match(overlayLight, /filter:\s*blur\(42px\)/);
  assert.match(css, /@property --overlay-mix\s*\{[^}]*syntax:\s*"<number>"/s);
  assert.match(archiveCss, /@keyframes overlay-duotone-shift\s*\{/);
  assert.match(
    archiveCss,
    /html\[data-motion-profile="full"\] \.result-area\.is-visible::before,\s*html\[data-motion-profile="full"\] \.playlist-area\.is-visible::before\s*\{[^}]*opacity:\s*0\.25;[^}]*overlay-duotone-shift/s,
    'the duotone field must sit near 25% and keep drifting'
  );
  assert.match(reducedLight, /opacity:\s*0\.18/);
  assert.match(reducedLight, /transform:\s*none/);
  assert.match(selected, /background:\s*transparent/);
  assert.doesNotMatch(selected, /var\(--archive-red\)/);
  assert.match(selectedGlow, /playlist-current-breathe/);
  assert.match(selectedGlow, /filter:\s*blur\(11px\)/);
  assert.match(selectedLine, /var\(--cover-a\)/);
  assert.match(selectedLine, /var\(--cover-b\)/);
  assert.match(identity, /display:\s*grid/);
  assert.match(pointerLight, /radial-gradient/);
  assert.match(pointerLight, /var\(--pointer-x,\s*50vw\)/);
  assert.match(pointerLight, /var\(--pointer-y,\s*50vh\)/);
  assert.match(pointerLight, /mix-blend-mode:\s*screen/);
  assert.doesNotMatch(pointerLight, /clip-path/);
  assert.doesNotMatch(pointerLight, /\btransform\s*:/);
  assert.doesNotMatch(pointerLight, /\bfilter\s*:/);
  assert.doesNotMatch(drift, /\bfilter\s*:/);
  assert.doesNotMatch(drift, /\bbox-shadow\s*:/);
});

test('lamp portal separates Carbon stretch and luminance tracks around one bounded bloom', () => {
  const gate = archiveRuleBody('.loading-light-slit[data-portal-side="top"],\n        .loading-light-slit[data-portal-side="bottom"]');
  const layers = archiveRuleBody('.loading-light-slit[data-portal-side="top"] > span,\n        .loading-light-slit[data-portal-side="bottom"] > span');
  const core = archiveRuleBody('.loading-light-slit[data-portal-side="top"] .loading-light-core,\n        .loading-light-slit[data-portal-side="bottom"] .loading-light-core');
  const coreHalo = archiveRuleBody('.loading-light-slit:is([data-portal-side="top"], [data-portal-side="bottom"]) .loading-light-core::before');
  const topHalo = archiveRuleBody('.loading-light-slit[data-portal-side="top"] .loading-light-core::before');
  const bottomHalo = archiveRuleBody('.loading-light-slit[data-portal-side="bottom"] .loading-light-core::before');
  const warm = archiveRuleBody('.loading-light-slit[data-portal-side="top"] .loading-light-edge.is-warm,\n        .loading-light-slit[data-portal-side="bottom"] .loading-light-edge.is-warm');
  const cool = archiveRuleBody('.loading-light-slit[data-portal-side="top"] .loading-light-edge.is-cool,\n        .loading-light-slit[data-portal-side="bottom"] .loading-light-edge.is-cool');
  const finalGate = archiveRuleBody('.loading-screen.is-final-resolving .loading-light-slit');
  const stretch = blockBody(archiveCss, '@keyframes loading-portal-stretch {');
  const luminance = blockBody(archiveCss, '@keyframes loading-portal-luminance {');

  assert.match(gate, /height:\s*var\(--portal-height,\s*156px\)/);
  assert.match(gate, /top:\s*var\(--portal-y,\s*50%\)/);
  assert.match(gate, /left:\s*var\(--portal-x,\s*50%\)/);
  assert.match(gate, /width:\s*var\(--portal-width,\s*min\(76vw,\s*560px\)\)/);
  assert.match(gate, /contain:\s*layout style/);
  assert.match(gate, /overflow:\s*visible/, 'the fixed blur halo must be allowed to bloom outside the gate box');
  assert.match(layers, /border-radius:\s*0/);
  assert.doesNotMatch(layers, /mask-image/, 'the narrow core host must not crop its directional bloom');
  assert.match(core, /width:\s*100%/);
  assert.match(core, /height:\s*clamp\(1\.5px, 0\.14vw, 2px\)/);
  assert.match(core, /z-index:\s*1/);
  assert.match(core, /background:\s*linear-gradient\(\s*90deg/s);
  assert.match(core, /box-shadow:\s*none/);
  assert.match(
    core,
    /filter:[^;]*blur\(0\.2px\)[^;]*drop-shadow\(0 0 5px rgba\(255, 255, 255, 0\.86\)\)[^;]*drop-shadow\(0 0 14px rgba\(214, 235, 246, 0\.58\)\)/s,
    'the Lamp strip glow follows its tapered alpha instead of painting rectangular end caps'
  );
  assert.match(coreHalo, /height:\s*calc\(var\(--portal-height, 156px\) \* 1\.85\)/);
  assert.match(
    coreHalo,
    /mask-image:\s*linear-gradient\(\s*90deg,\s*transparent 0%,[\s\S]*rgba\(0, 0, 0, 0\.08\) 6%,[\s\S]*rgba\(0, 0, 0, 0\.76\) 28%,[\s\S]*#000 42%,[\s\S]*#000 58%,[\s\S]*transparent 100%\s*\)/,
    'the bounded bloom feathers through several horizontal stops instead of ending as a rectangle'
  );
  assert.match(
    coreHalo,
    /filter:\s*blur\(clamp\(14px, 1\.4vw, 22px\)\)/,
    'the single bounded bloom keeps a responsive fixed-per-frame blur radius'
  );
  assert.match(topHalo, /top:\s*50%/);
  assert.match(topHalo, /radial-gradient\(\s*ellipse 104% 100% at 50% 0%/s);
  assert.match(bottomHalo, /bottom:\s*50%/);
  assert.match(bottomHalo, /radial-gradient\(\s*ellipse 104% 100% at 50% 100%/s);
  assert.doesNotMatch(`${core}\n${topHalo}\n${bottomHalo}`, /rgba\(0,\s*0,\s*0/, 'the portal must not paint a black core');
  assert.match(warm, /display:\s*none/);
  assert.match(cool, /display:\s*none/);
  assert.match(finalGate, /display:\s*none/);
  assert.match(finalGate, /opacity:\s*0/);
  assert.match(finalGate, /animation:\s*none !important/);
  assert.match(
    archiveCss,
    /\.loading-light-slit\.is-lit\[data-portal-phase\] > \.loading-light-core,[\s\S]*\.loading-light-slit\.is-lit\[data-portal-phase\] > \.loading-light-edge\.is-cool\s*\{[^}]*animation:\s*none;[^}]*opacity:\s*1/s
  );
  assert.equal(
    (archiveCss.match(
      /loading-portal-stretch var\(--portal-phase-ms, 760ms\) linear both,\s*loading-portal-luminance var\(--portal-phase-ms, 760ms\) linear both/g
    ) || []).length,
    2,
    'enter and exit must retain the same 760ms stretch/luminance envelope'
  );
  for (const phase of ['enter', 'exit']) {
    assert.match(
      archiveCss,
      new RegExp(`data-portal-phase="${phase}"[^}]*loading-portal-stretch var\\(--portal-phase-ms, 760ms\\) linear both,[^}]*loading-portal-luminance var\\(--portal-phase-ms, 760ms\\) linear both`, 's')
    );
  }
  assert.match(stretch, /0%\s*\{[^}]*scale3d\(0\.04, 1, 1\)[^}]*cubic-bezier\(0, 0, 0\.3, 1\)/s);
  assert.match(stretch, /40%\s*\{[^}]*scale3d\(1, 1, 1\)/s);
  assert.match(stretch, /78%\s*\{[^}]*scale3d\(1\.004, 1, 1\)[^}]*cubic-bezier\(0\.4, 0, 1, 1\)/s);
  assert.match(stretch, /100%\s*\{[^}]*scale3d\(1\.018, 1, 1\)/s);
  assert.match(luminance, /0%\s*\{[^}]*opacity:\s*0[^}]*cubic-bezier\(0\.2, 0, 0, 1\)/s);
  assert.match(luminance, /12%\s*\{[^}]*opacity:\s*0\.58[^}]*cubic-bezier\(0, 0, 0\.3, 1\)/s);
  assert.match(luminance, /40%\s*\{\s*opacity:\s*1/);
  assert.match(luminance, /78%\s*\{[^}]*opacity:\s*0\.98[^}]*cubic-bezier\(0\.4, 0, 1, 1\)/s);
  assert.match(luminance, /100%\s*\{\s*opacity:\s*0/);
  for (const track of [stretch, luminance]) {
    assert.doesNotMatch(track, /(?:filter|backdrop-filter|box-shadow)\s*:/);
  }
  assert.doesNotMatch(archiveCss, /loading-portal-envelope/);
  assert.doesNotMatch(archiveCss, /loading-portal-(?:core|near|far)-bloom/);
  assert.doesNotMatch(archiveCss, /loading-(?:left|right)-portal-pulse|is-parked|idle-breathe/);
  assert.doesNotMatch(archiveCss, /data-motion-profile="compact"[^}]*loading-light-slit[^}]*width:/s);
});

test('posters travel vertically through geometric gates without edge transparency masks', () => {
  const enter = blockBody(archiveCss, '@keyframes loading-poster-glide-in {');
  const exit = blockBody(archiveCss, '@keyframes loading-poster-glide-out {');
  const artworkViewport = sourceRuleBody('.loading-artwork-viewport');
  const enterViewport = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-entering-from-portal[data-portal-side="top"] .loading-artwork-viewport');
  const exitViewport = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-exiting-to-portal[data-portal-side="bottom"] .loading-artwork-viewport');
  const posterImage = archiveRuleBody('.loading-screen .loading-frame .loading-image');
  const floatingFrame = archiveRuleBody('.loading-screen:not(.is-final-resolving):not([data-motion-profile="reduce"]) .loading-frame:is(.is-active, .is-outgoing):not([data-final-poster="true"])');
  const litImage = archiveRuleBody('.loading-screen:not(.is-final-resolving):not([data-motion-profile="reduce"]) .loading-frame:is(.is-active, .is-outgoing) .loading-image');
  const enterBinding = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-entering.is-entering-from-portal[data-portal-side="top"] .loading-image');
  const enterAura = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-entering.is-entering-from-portal[data-portal-side="top"]::before');
  const enterReflection = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-entering.is-entering-from-portal[data-portal-side="top"]::after');
  const exitBinding = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-exiting.is-exiting-to-portal[data-portal-side="bottom"] .loading-image');
  const exitAura = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-exiting.is-exiting-to-portal[data-portal-side="bottom"]::before');
  const exitReflection = archiveRuleBody('.loading-screen:not([data-motion-profile="reduce"]) .loading-frame.is-exiting.is-exiting-to-portal[data-portal-side="bottom"]::after');

  assert.match(artworkViewport, /--poster-effect-bleed:\s*96px/);
  assert.match(artworkViewport, /overflow:\s*visible/);
  assert.match(enterViewport, /clip-path:\s*inset\([\s\S]*var\(--seam-inset, 0%\)[\s\S]*calc\(0px - var\(--poster-effect-bleed, 96px\)\)[\s\S]*\)/);
  assert.match(exitViewport, /clip-path:\s*inset\([\s\S]*calc\(0px - var\(--poster-effect-bleed, 96px\)\)[\s\S]*var\(--seam-inset, 0%\)[\s\S]*\)/);
  assert.doesNotMatch(`${enterViewport}${exitViewport}`, /mask-image|poster-fade/);
  assert.doesNotMatch(
    archiveCss,
    /\.loading-frame\.is-(?:entering-from-portal|exiting-to-portal)\[data-portal-side="(?:top|bottom)"\]\s*\{[^}]*clip-path/s,
    'the frame-level aura and floor glow must remain outside the geometric poster viewport clip'
  );
  assert.match(posterImage, /-webkit-mask-image:\s*none/);
  assert.match(posterImage, /mask-image:\s*none/);
  assert.doesNotMatch(archiveCss, /--poster-fade-/);
  assert.match(enterBinding, /loading-poster-glide-in[\s\S]*loading-poster-arrive/, 'translate and scale ride separate tracks');
  assert.match(
    enterBinding,
    /animation-timing-function:\s*cubic-bezier\(0\.16, 1, 0\.3, 1\), cubic-bezier\(0\.22, 1, 0\.36, 1\);/,
    'translation and scale use separate bounded settling curves'
  );
  assert.match(exitBinding, /loading-poster-glide-out[\s\S]*loading-poster-depart/);
  assert.match(floatingFrame, /loading-poster-float 6\.4s/, 'the same ambient motion stays active across travel and rest');
  assert.match(litImage, /drop-shadow/);
  assert.match(enterAura, /loading-poster-glide-in[\s\S]*loading-poster-aura-arrive/);
  assert.match(enterReflection, /loading-poster-glide-in[\s\S]*loading-poster-floor-arrive/);
  assert.match(exitAura, /loading-poster-glide-out[\s\S]*loading-poster-aura-depart/);
  assert.match(exitReflection, /loading-poster-glide-out[\s\S]*loading-poster-floor-depart/);

  assert.match(enter, /translate:\s*0 var\(--poster-portal-offset, -112%\)/, 'the poster emerges from above the separated gate');
  assert.match(enter, /translate:\s*0 0%/);
  assert.match(blockBody(archiveCss, '@keyframes loading-poster-arrive {'), /scale:\s*0\.92/, 'scale settles on its own track');
  assert.match(exit, /translate:\s*0 var\(--poster-portal-offset, 112%\)/);
  assert.match(blockBody(archiveCss, '@keyframes loading-poster-depart {'), /scale:\s*0\.82/, 'the poster shrinks as the bottom lamp consumes it');
  for (const body of [enter, exit]) {
    assert.doesNotMatch(body, /clip-path|transform:/, 'flight keyframes carry only the split translate track');
  }
  assert.doesNotMatch(blockBody(archiveCss, '@keyframes loading-poster-arrive {'), /opacity:\s*0\s*[;}]/, 'the gate, not opacity, reveals the poster');
  assert.doesNotMatch(blockBody(archiveCss, '@keyframes loading-poster-depart {'), /opacity:\s*0\s*[;}]/, 'the gate, not opacity, consumes the poster');

  const stableReflection = archiveRuleBody('.loading-screen:not(.is-final-resolving):not([data-motion-profile="reduce"]) .loading-frame.is-stable::after');
  assert.match(stableReflection, /loading-poster-floor-glow 6\.4s/);
});

test('portal geometry follows the fixed poster stage while preserving artwork gaps and hold particles', () => {
  const posterTransition = readSource(new URL('../../src/ui/poster-transition.js', import.meta.url));

  assert.match(archiveCss, /top:\s*var\(--portal-y,\s*50%\)/);
  assert.match(posterTransition, /setProperty\('--gate-x'/);
  assert.match(posterTransition, /setProperty\('--gate-y'/);
  assert.match(posterTransition, /setProperty\('--gate-height'/);
  assert.match(posterTransition, /setProperty\('--gate-width'/);
  assert.match(posterTransition, /setProperty\('--portal-gap'/);
  assert.match(posterTransition, /setProperty\(\s*'--portal-x'/);
  assert.match(posterTransition, /setProperty\(\s*'--portal-y'/);
  assert.match(posterTransition, /setProperty\(\s*'--portal-width'/);
  assert.match(posterTransition, /setProperty\(\s*'--portal-height'/);
  assert.match(posterTransition, /particleBounds:\s*\{/);
  assert.match(
    css,
    /\.loading-particles\s*\{[^}]*height:\s*calc\(100% \+ 120px\);[^}]*inset:\s*-48px 0 auto/s,
    'the Canvas reserves real space below full-height desktop artwork'
  );
  assert.match(posterTransition, /setProperty\('--seam-inset'/);
  assert.match(posterTransition, /setProperty\('--poster-art-bottom'/);
  assert.match(posterTransition, /setProperty\('--poster-art-top'/);
  assert.match(posterTransition, /setProperty\('--poster-art-height'/);
  assert.match(posterTransition, /removeProperty\('--gate-x'\)/);
  assert.match(posterTransition, /removeProperty\('--gate-y'\)/);
  assert.match(posterTransition, /removeProperty\('--gate-height'\)/);
  assert.match(posterTransition, /removeProperty\('--gate-width'\)/);
  assert.match(posterTransition, /removeProperty\('--portal-gap'\)/);
  assert.match(posterTransition, /removeProperty\('--seam-inset'\)/);
  assert.match(posterTransition, /artWidth \* 1\.08/, 'the fixed horizontal gate includes an eight-percent breathing margin');
  assert.match(posterTransition, /const desiredGap = Math\.max\(20, Math\.min\(38, artHeight \* 0\.055\)\)/);
  assert.match(posterTransition, /const topY = Math\.max\(boundaryTop \+ 12, artTop - desiredGap\)/);
  assert.match(posterTransition, /const bottomY = artBottom \+ desiredGap/);
  assert.match(posterTransition, /const artworkCenterX = artLeft \+ \(artWidth \/ 2\)/);
  assert.match(posterTransition, /\? fixedPortalGeometry\.bottomY\s*:\s*fixedPortalGeometry\.topY/);
  assert.match(posterTransition, /\? Math\.max\(0, portalScreenY - artBottom\)\s*:\s*Math\.max\(0, artTop - portalScreenY\)/);
  assert.match(posterTransition, /activatePortal\('bottom', 'exit', sceneProfile, PORTAL_DURATION\)/);
  assert.match(posterTransition, /activatePortal\('top', 'enter', sceneProfile, PORTAL_DURATION\)/);
  assert.match(posterTransition, /particleField\.hold|holdParticles/, 'resting posters keep a bounded floating field below the art');
});

test('obsolete loading chrome stays removed from the visual layer', () => {
  assert.doesNotMatch(css, /\.loading-progress-rail\b/);
});
