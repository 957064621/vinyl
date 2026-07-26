import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../src/style.css', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../../src/main.js', import.meta.url), 'utf8');
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
    return properties.length === 1 && ['transform', 'opacity', 'none'].includes(properties[0])
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
      properties.every((property) => ['transform', 'opacity', 'none'].includes(property)),
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
  assert.doesNotMatch(css, /(?:-webkit-)?backdrop-filter\s*:/);
  assert.doesNotMatch(css, /\bwill-change\s*:/);
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
    /background:\s*var\(--archive-void\)/
  );
  assert.match(
    archiveRuleBody('.result-area.is-visible .overlay-close-btn:active,\n        .playlist-area.is-visible .overlay-close-btn:active'),
    /background:\s*var\(--archive-void\)/
  );
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
    '.lyric-toggle-btn.is-visible:active,\n        .playlist-toggle-btn.is-visible:active,\n        .playlist-mode-switch:active,\n        .audio-status .audio-retry:not(:disabled):active',
    '.result-area.is-visible .overlay-close-btn:active,\n        .playlist-area.is-visible .overlay-close-btn:active'
  ];

  for (const selector of terminalActiveRules) {
    const rule = archiveRuleBody(selector);
    const properties = [...rule.matchAll(/\btransition\s*:\s*([\s\S]*?);/g)]
      .flatMap((match) => transitionProperties(match[1]));
    assert.deepEqual(properties, ['transform', 'opacity'], `${selector} must explicitly transition only transform and opacity`);
  }

  assert.match(
    sourceRuleBody('.overlay-close-btn:active'),
    /transition:\s*transform\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*opacity\s+0\.1s\s+var\(--continuity-ease\)\s+0s;/,
    'the base overlay-close press transition must retain its 100ms continuity curve and zero delay'
  );

  assert.match(
    archiveRuleBody('.result-area.is-visible .overlay-close-btn:active,\n        .playlist-area.is-visible .overlay-close-btn:active'),
    /transition:\s*transform\s+0\.1s\s+var\(--continuity-ease\)\s+0s,\s*opacity\s+0\.1s\s+var\(--continuity-ease\)\s+0s;/,
    'the terminal visible overlay-close rule must win the cascade with the restored 100ms continuity timing'
  );

  assert.deepEqual(
    transitionProperties('transform 180ms cubic-bezier(0.4, 0, 0.2, 1), opacity 160ms linear(0, 0.5 50%, 1)'),
    ['transform', 'opacity'],
    'commas inside timing functions must not split transition entries'
  );

  for (const [description, stylesheet] of [
    ['reordered shorthand', '.reordered:active { transition: background ease 180ms; }'],
    ['uppercase shorthand and active selector', '.uppercase:ACTIVE { TRANSITION: background 180ms; }'],
    ['compact forbidden rule', 'a {} .compact:AcTiVe { transition: background 180ms; }'],
    ['opaque shorthand', '.opaque:active { transition: var(--active-transition); }'],
    ['forbidden longhand', '.longhand:active { transition: transform 180ms; transition-duration: 180ms; }'],
    ['uppercase transition-property', '.property:ACTIVE { TRANSITION-PROPERTY: background; }']
  ]) {
    assert.throws(
      () => assertActiveTransitionsSafe(stylesheet),
      /forbidden|unparseable/,
      `${description} must not evade the active transition guard`
    );
  }

  assertActiveTransitionsSafe(css);
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

test('linear timing is limited to physical rotation, progress sync, and reduced-motion fades', () => {
  const linearCssDeclarations = [...css.matchAll(
    /(?:transition|animation)\s*:[^;\n]*\blinear\b[^;\n]*;/g
  )].map((match) => match[0].replace(/\s+/g, ' ').trim());
  const declarationCounts = Object.fromEntries(
    [...new Set(linearCssDeclarations)].map((declaration) => [
      declaration,
      linearCssDeclarations.filter((candidate) => candidate === declaration).length
    ])
  );

  assert.deepEqual(declarationCounts, {
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
  assert.match(mobile, /\.archive-track-meta\s*\{[\s\S]*width:\s*var\(--mobile-content-rail\)/);
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

  assert.match(overlayLight, /var\(--cover-a\) 72%/);
  assert.match(overlayLight, /var\(--cover-b\) 68%/);
  assert.match(overlayLight, /filter:\s*blur\(42px\)/);
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

test('dual loading portals prelight on their first rendered frame and peak before poster travel', () => {
  const portal = archiveRuleBody('.loading-light-slit[data-portal-side="left"],\n        .loading-light-slit[data-portal-side="right"]');
  const core = archiveRuleBody('.loading-light-slit[data-portal-side="left"] .loading-light-core,\n        .loading-light-slit[data-portal-side="right"] .loading-light-core');
  const volumeBeam = archiveRuleBody('.loading-light-slit[data-portal-side="left"]::before,\n        .loading-light-slit[data-portal-side="right"]::before');
  const leftVolumeBeam = archiveRuleBody('.loading-light-slit[data-portal-side="left"]::before');
  const leftPulse = blockBody(archiveCss, '@keyframes loading-left-portal-pulse {');
  const rightPulse = blockBody(archiveCss, '@keyframes loading-right-portal-pulse {');
  const corePulse = blockBody(archiveCss, '@keyframes loading-portal-core-pulse {');
  const leftRail = blockBody(archiveCss, '@keyframes loading-left-portal-rail-pulse {');
  const volumePulse = blockBody(archiveCss, '@keyframes loading-portal-volume-pulse {');

  assert.match(portal, /width:\s*clamp\(54px,\s*6\.8vw,\s*88px\)/);
  assert.match(core, /width:\s*3px/);
  assert.match(core, /box-shadow:[\s\S]*rgba\(255, 253, 244, 0\.88\)/);
  assert.match(volumeBeam, /width:\s*min\(38vw,\s*390px\)/);
  assert.match(volumeBeam, /filter:\s*blur\(11px\)/);
  assert.match(volumeBeam, /loading-portal-volume-pulse/);
  assert.match(leftVolumeBeam, /linear-gradient\(\s*90deg/);
  assert.match(leftVolumeBeam, /transform-origin:\s*left center/);
  assert.match(
    archiveCss,
    /\.loading-light-slit\[data-portal-side="right"\]::before\s*\{[^}]*right:\s*50%;[^}]*linear-gradient\(\s*270deg[^}]*transform-origin:\s*right center/s
  );
  assert.match(
    archiveCss,
    /\.loading-light-slit\[data-portal-side="right"\]::before,\s*\.loading-light-slit\[data-portal-side="right"\]::after\s*\{[^}]*mask-image:\s*linear-gradient\(270deg/s
  );
  assert.match(
    archiveCss,
    /\.loading-screen\[data-portal-side\] \.loading-stage::after\s*\{[^}]*width:\s*clamp\(68px,\s*8vw,\s*104px\)/s
  );
  assert.match(leftPulse, /0%\s*\{\s*opacity:\s*0\.38/);
  assert.match(rightPulse, /0%\s*\{\s*opacity:\s*0\.36/);
  assert.match(corePulse, /0%\s*\{\s*opacity:\s*0\.82/);
  assert.match(leftRail, /0%\s*\{\s*opacity:\s*0\.02/);
  assert.match(leftPulse, /24%\s*\{\s*opacity:\s*0\.92/);
  assert.match(rightPulse, /26%\s*\{\s*opacity:\s*0\.9/);
  assert.match(volumePulse, /26%\s*\{\s*opacity:\s*0\.66/);
  assert.doesNotMatch(`${leftPulse}${rightPulse}${corePulse}${leftRail}${volumePulse}`, /\blinear\b/);
});

test('obsolete loading chrome stays removed from the visual layer', () => {
  assert.doesNotMatch(css, /\.loading-progress-rail\b/);
});
