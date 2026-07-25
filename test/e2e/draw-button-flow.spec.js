import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const DETERMINISTIC_COVER = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
    <rect width="600" height="800" fill="#101722"/>
    <rect x="36" y="36" width="528" height="728" fill="#b7ddff"/>
  </svg>
`);

const installCovers = async (page, { hold = false } = {}) => {
  const paths = new Set(CRITICAL_IMAGE_MANIFEST.map(({ source }) => new URL(source).pathname));
  let release;
  const held = hold ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'image') return route.continue();
    if (!paths.has(new URL(route.request().url()).pathname)) return route.abort('blockedbyclient');
    await held;
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: DETERMINISTIC_COVER });
  });
  return release;
};

const waitForApp = async (page) => {
  await installCovers(page);
  await page.goto('./');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
};

const lightState = (page) => page.locator('#playButton').evaluate((button) => {
  const sheen = button.querySelector('.btn-sheen');
  const perimeter = getComputedStyle(sheen, '::before');
  const halo = getComputedStyle(button, '::after');
  const animations = button.getAnimations({ subtree: true })
    .filter((animation) => ['btn-perimeter-pass', 'btn-halo-pulse'].includes(animation.animationName))
    .sort((left, right) => left.animationName.localeCompare(right.animationName));
  return {
    perimeter: { opacity: Number.parseFloat(perimeter.opacity), animationName: perimeter.animationName, timing: perimeter.animationTimingFunction, transform: perimeter.transform },
    halo: { opacity: Number.parseFloat(halo.opacity), animationName: halo.animationName, timing: halo.animationTimingFunction, transform: halo.transform },
    animations: animations.map((animation, index) => ({
        animationName: animation.animationName,
        currentTime: Number(animation.currentTime),
        duration: animation.effect.getTiming().duration,
        easing: animation.animationName === 'btn-perimeter-pass' ? perimeter.animationTimingFunction : halo.animationTimingFunction,
        playState: animation.playState
      }))
  };
});

const setBlockedState = (page, name) => page.evaluate((state) => {
  const root = document.documentElement;
  const body = document.body;
  const island = document.querySelector('#dynamicIsland');
  const button = document.querySelector('#playButton');
  root.removeAttribute('data-document-hidden');
  body.classList.remove('has-lyric-overlay', 'has-playlist-overlay');
  island.classList.remove('is-opening', 'is-collapsing');
  button.removeAttribute('data-busy');
  button.disabled = false;
  document.querySelector('[data-flow-loading]')?.remove();
  if (state === 'busy') button.dataset.busy = '';
  if (state === 'disabled') button.disabled = true;
  if (state === 'hidden') root.dataset.documentHidden = '';
  if (state === 'lyric') body.classList.add('has-lyric-overlay');
  if (state === 'playlist') body.classList.add('has-playlist-overlay');
  if (state === 'opening') island.classList.add('is-opening');
  if (state === 'collapsing') island.classList.add('is-collapsing');
  if (state === 'loading') {
    const loading = document.createElement('div');
    loading.id = 'loadingScreen';
    loading.dataset.flowLoading = '';
    document.querySelector('#appRoot').before(loading);
  }
}, name);

const setPhase = (page, time) => page.evaluate(async (currentTime) => {
  const button = document.querySelector('#playButton');
  const sheen = button.querySelector('.btn-sheen');
  const animations = button.getAnimations({ subtree: true })
    .filter((animation) => ['btn-perimeter-pass', 'btn-halo-pulse'].includes(animation.animationName));
  await Promise.all(animations.map((animation) => animation.ready));
  for (const animation of animations) {
    animation.pause();
    animation.currentTime = currentTime;
  }
  await new Promise(requestAnimationFrame);
}, time);

const restartLightAtPhaseZero = async (page, gate) => {
  await setBlockedState(page, 'idle');
  await page.locator('#playButton').evaluate(() => new Promise(requestAnimationFrame));
  const restarted = await lightState(page);
  expect(restarted, `${gate} release restarts both layers`).toMatchObject({
    perimeter: { animationName: 'btn-perimeter-pass' },
    halo: { animationName: 'btn-halo-pulse' }
  });
  expect(restarted.animations).toHaveLength(2);
  expect(restarted.animations.every(({ currentTime }) => currentTime < 100), `${gate} release starts near phase zero`).toBe(true);
};

const sampleFrameGaps = (page, label) => page.evaluate(async (sampleLabel) => {
  const probe = window.__buttonLightProbe;
  const flush = () => probe.entries.push(...probe.observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration })));
  probe.entries.length = 0;
  const stamps = await new Promise((resolve) => {
    const values = [];
    const sample = (now) => {
      values.push(now);
      if (values.length === 49) resolve(values);
      else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  flush();
  const gaps = stamps.slice(1).map((time, index) => time - stamps[index]);
  return {
    label: sampleLabel,
    frameCount: gaps.length,
    maxFrameGap: Math.max(...gaps),
    longTasks: probe.entries.splice(0),
    animations: [
      getComputedStyle(document.querySelector('.btn-sheen'), '::before').animationName,
      getComputedStyle(document.querySelector('#playButton'), '::after').animationName
    ].filter((name) => name !== 'none')
  };
}, label);

const decodeScreenshot = async (page, buffer) => page.evaluate(async (base64) => {
  const response = await fetch(`data:image/png;base64,${base64}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  return { width: bitmap.width, height: bitmap.height, pixels: [...context.getImageData(0, 0, bitmap.width, bitmap.height).data] };
}, buffer.toString('base64'));

const concentration = (idle, peak) => {
  const buckets = { perimeter: [0, 0], interior: [0, 0], center: [0, 0] };
  const radius = idle.height / 2;
  for (let y = 0; y < idle.height; y += 1) {
    for (let x = 0; x < idle.width; x += 1) {
      const qx = Math.abs(x + 0.5 - idle.width / 2) - (idle.width / 2 - radius);
      const qy = Math.abs(y + 0.5 - idle.height / 2);
      const distance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
      if (distance > 0) continue;
      const bucket = distance >= -2 ? buckets.perimeter : (x > idle.width * 0.15 && x < idle.width * 0.85 && y > idle.height * 0.15 && y < idle.height * 0.85 ? buckets.center : buckets.interior);
      const index = (y * idle.width + x) * 4;
      bucket[0] += Math.abs(peak.pixels[index] - idle.pixels[index]) + Math.abs(peak.pixels[index + 1] - idle.pixels[index + 1]) + Math.abs(peak.pixels[index + 2] - idle.pixels[index + 2]);
      bucket[1] += 3;
    }
  }
  return Object.fromEntries(Object.entries(buckets).map(([name, [sum, count]]) => [name, sum / count / 255]));
};

test('full desktop synchronizes one perimeter pass and one halo pulse', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await page.waitForTimeout(100);
  const started = await lightState(page);
  expect(started.perimeter.animationName).toBe('btn-perimeter-pass');
  expect(started.halo.animationName).toBe('btn-halo-pulse');
  expect(started.animations).toHaveLength(2);
  expect(started.animations.map(({ animationName, duration, easing, playState }) => ({ animationName, duration, easing, playState }))).toEqual([
    { animationName: 'btn-halo-pulse', duration: 7200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', playState: 'running' },
    { animationName: 'btn-perimeter-pass', duration: 7200, easing: 'cubic-bezier(0.32, 0.72, 0, 1)', playState: 'running' }
  ]);
  expect(Math.abs(started.animations[0].currentTime - started.animations[1].currentTime)).toBeLessThan(34);
  await setPhase(page, 600);
  const peak = await lightState(page);
  expect(peak.perimeter.opacity).toBeGreaterThan(0.68);
  expect(peak.halo.opacity).toBeGreaterThan(0.03);
  let restingTransform;
  for (const time of [1500, 3600, 6900]) {
    await setPhase(page, time);
    const rest = await lightState(page);
    expect(rest.perimeter.opacity).toBe(0);
    expect(rest.halo.opacity).toBe(0);
    restingTransform ??= { perimeter: rest.perimeter.transform, halo: rest.halo.transform };
    expect(rest.perimeter.transform).toBe(restingTransform.perimeter);
    expect(rest.halo.transform).toBe(restingTransform.halo);
  }
  for (const blocked of ['busy', 'disabled', 'hidden', 'lyric', 'playlist', 'opening', 'collapsing', 'loading']) {
    await setBlockedState(page, blocked);
    expect(await lightState(page), `${blocked} blocks decorative light`).toMatchObject({
      perimeter: { opacity: 0, animationName: 'none' },
      halo: { opacity: 0, animationName: 'none' },
      animations: []
    });
    await restartLightAtPhaseZero(page, blocked);
  }
});

test('compact is static and reduced motion has no decorative light', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'desktop-chromium');
  await waitForApp(page);
  const state = await lightState(page);
  if (testInfo.project.name === 'mobile-chromium') {
    expect(state).toMatchObject({ perimeter: { animationName: 'none' }, halo: { animationName: 'none' }, animations: [] });
    expect(state.perimeter.opacity).toBeCloseTo(0.19, 2);
    expect(state.halo.opacity).toBeGreaterThanOrEqual(0.04);
    expect(state.halo.opacity).toBeLessThanOrEqual(0.07);
  }
  if (testInfo.project.name === 'mobile-reduce') {
    expect(state).toMatchObject({ perimeter: { animationName: 'none', opacity: 0 }, halo: { animationName: 'none', opacity: 0 }, animations: [] });
  }
});

test('button geometry, label, press, focus, and perimeter concentration remain locked', async ({ page }, testInfo) => {
  await waitForApp(page);
  await page.waitForTimeout(750);
  const button = page.locator('#playButton');
  const expected = testInfo.project.name === 'desktop-chromium'
    ? { width: 136, height: 48, label: '15px', pressY: '1px', pressScale: '.972' }
    : { width: 106, height: 46, label: '13px', pressY: '.5px', pressScale: '.988' };
  const idle = await button.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const label = document.querySelector('#btnText');
    const viewport = document.querySelector('#btnLabelViewport').getBoundingClientRect();
    const viewportStyle = getComputedStyle(document.querySelector('#btnLabelViewport'));
    const labelStyle = getComputedStyle(label);
    const buttonStyle = getComputedStyle(node);
    return {
      rect: rect.toJSON(),
      button: Object.fromEntries(['borderRadius', 'padding', 'display', 'justifyContent', 'alignItems'].map((property) => [property, buttonStyle[property]])),
      label: { text: label.textContent, fontSize: labelStyle.fontSize, whiteSpace: labelStyle.whiteSpace, rect: label.getBoundingClientRect().toJSON(), viewport: viewport.toJSON(), viewportOverflow: viewportStyle.overflow },
      transform: buttonStyle.transform
    };
  });
  expect({ width: idle.rect.width, height: idle.rect.height }).toEqual({ width: expected.width, height: expected.height });
  expect(idle.button).toMatchObject({ borderRadius: '999px', padding: '0px', display: 'flex', justifyContent: 'center', alignItems: 'center' });
  expect(idle.label.text.trim()).not.toBe('');
  expect(idle.label.fontSize).toBe(expected.label);
  expect(idle.label.whiteSpace).toBe('nowrap');
  expect(idle.label.viewportOverflow).toBe('hidden');
  expect(idle.label.viewport.width).toBeGreaterThan(0);
  expect(idle.label.viewport.width).toBeLessThanOrEqual(idle.rect.width);
  expect(idle.label.viewport.x).toBeGreaterThanOrEqual(idle.rect.x);
  expect(idle.label.viewport.y).toBeGreaterThanOrEqual(idle.rect.y);
  expect(idle.label.viewport.right).toBeLessThanOrEqual(idle.rect.right);
  expect(idle.label.viewport.bottom).toBeLessThanOrEqual(idle.rect.bottom);
  expect(idle.label.rect.x).toBeGreaterThanOrEqual(idle.label.viewport.x);
  expect(idle.label.rect.y).toBeGreaterThanOrEqual(idle.label.viewport.y);
  expect(idle.label.rect.right).toBeLessThanOrEqual(idle.label.viewport.right);
  expect(idle.label.rect.bottom).toBeLessThanOrEqual(idle.label.viewport.bottom);
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveCSS('outline-style', 'solid');
  await button.hover();
  const hoverTransform = await button.evaluate((node) => getComputedStyle(node).transform);
  await button.evaluate((node) => node.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, { capture: true, once: true }));
  await page.mouse.down();
  await page.waitForTimeout(80);
  expect(await button.evaluate((node) => getComputedStyle(node).getPropertyValue('--button-y'))).toBe(expected.pressY);
  expect(await button.evaluate((node) => getComputedStyle(node).getPropertyValue('--button-scale'))).toBe(expected.pressScale);
  expect(await button.evaluate((node) => getComputedStyle(node).transform)).not.toBe(hoverTransform);
  await page.mouse.up();

  if (testInfo.project.name === 'desktop-chromium') {
    await setPhase(page, 0);
    const baseline = await button.screenshot({ path: testInfo.outputPath('perimeter-idle.png'), scale: 'css' });
    await setPhase(page, 600);
    const peak = await button.screenshot({ path: testInfo.outputPath('perimeter-peak.png'), scale: 'css' });
    const delta = concentration(await decodeScreenshot(page, baseline), await decodeScreenshot(page, peak));
    expect(delta.center).toBeLessThan(4 / 255);
    expect(delta.perimeter).toBeGreaterThan(Math.max(delta.interior * 3, 0.0005));
    await writeFile(testInfo.outputPath('perimeter-pixel-concentration.json'), `${JSON.stringify(delta, null, 2)}\n`);
  }
});

test('loading does not start decorative light before critical resources resolve', async ({ page }) => {
  const release = await installCovers(page, { hold: true });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loadingScreen')).toHaveCount(1);
  expect(await lightState(page)).toMatchObject({ perimeter: { animationName: 'none', opacity: 0 }, halo: { animationName: 'none', opacity: 0 }, animations: [] });
  release();
});

test('static compact light adds no mobile long task over 50ms', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.addInitScript(() => {
    const supported = Boolean(window.PerformanceObserver?.supportedEntryTypes?.includes('longtask'));
    window.__buttonLightProbe = { supported, entries: [], observer: null };
    if (!supported) return;
    window.__buttonLightProbe.observer = new PerformanceObserver((list) => {
      window.__buttonLightProbe.entries.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
    });
    window.__buttonLightProbe.observer.observe({ type: 'longtask', buffered: true });
  });
  await waitForApp(page);
  await page.waitForTimeout(750);
  expect(await page.evaluate(() => window.__buttonLightProbe.supported)).toBe(true);
  await page.evaluate(() => new Promise((resolve) => setTimeout(() => {
    const endsAt = performance.now() + 70;
    while (performance.now() < endsAt) {}
    resolve();
  }, 0)));
  await page.waitForTimeout(100);
  const positiveControl = await page.evaluate(() => {
    const probe = window.__buttonLightProbe;
    probe.entries.push(...probe.observer.takeRecords().map(({ startTime, duration }) => ({ startTime, duration })));
    const entries = probe.entries.splice(0);
    return entries;
  });
  expect(positiveControl.some(({ duration }) => duration > 50)).toBe(true);

  await page.evaluate(() => document.documentElement.setAttribute('data-document-hidden', ''));
  const hiddenBaseline = await sampleFrameGaps(page, 'gated-hidden');
  await page.evaluate(() => document.documentElement.removeAttribute('data-document-hidden'));
  const compactVisible = await sampleFrameGaps(page, 'compact-visible');
  expect(hiddenBaseline.animations).toEqual([]);
  expect(compactVisible.animations).toEqual([]);
  expect(hiddenBaseline.longTasks.filter(({ duration }) => duration > 50)).toEqual([]);
  expect(compactVisible.longTasks.filter(({ duration }) => duration > 50)).toEqual([]);
  expect(compactVisible.frameCount).toBe(48);
  expect(compactVisible.maxFrameGap).toBeLessThanOrEqual(Math.max(hiddenBaseline.maxFrameGap + 33, 100));
  await writeFile(testInfo.outputPath('compact-light-performance.json'), `${JSON.stringify({
    viewport: await page.evaluate(() => [innerWidth, innerHeight]),
    positiveControl,
    hiddenBaseline,
    compactVisible
  }, null, 2)}\n`);
});
