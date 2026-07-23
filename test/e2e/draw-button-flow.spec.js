import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const LOCKED_STYLE = Object.freeze({
  desktop: {
    width: '136px',
    height: '48px',
    fontSize: '15px',
    letterSpacing: '1.35px',
    islandWidth: '438px'
  },
  mobile: {
    width: '106px',
    height: '46px',
    fontSize: '13px',
    letterSpacing: '1.17px',
    islandWidth: '306px'
  }
});
const LOCKED_SHARED_STYLE = Object.freeze({
  borderRadius: '999px',
  padding: '0px',
  margin: '0px',
  fontFamily: 'Manrope, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontWeight: '500',
  backgroundColor: 'rgba(12, 18, 29, 0.44)',
  backdropFilter: 'blur(12px) saturate(1.36)',
  border: '1px solid rgba(224, 239, 255, 0.18)'
});
const DETERMINISTIC_COVER = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
    <rect width="600" height="800" fill="#101722"/>
    <rect x="36" y="36" width="528" height="728" fill="#b7ddff"/>
  </svg>
`);

const installCovers = async (page) => {
  const paths = new Set(CRITICAL_IMAGE_MANIFEST.map(({ source }) => new URL(source).pathname));
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'image') return route.continue();
    const pathname = new URL(route.request().url()).pathname;
    if (!paths.has(pathname)) return route.abort('blockedbyclient');
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: DETERMINISTIC_COVER });
  });
};

const getMetrics = (page) => page.locator('#playButton').evaluate((button) => {
  const style = getComputedStyle(button);
  const before = getComputedStyle(button, '::before');
  const after = getComputedStyle(button, '::after');
  const island = getComputedStyle(document.querySelector('#dynamicIsland'));
  const rect = button.getBoundingClientRect();
  const label = document.querySelector('#btnLabelViewport').getBoundingClientRect();
  return {
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    label: { x: label.x, y: label.y, width: label.width, height: label.height },
    style: Object.fromEntries([
      'width', 'height', 'borderRadius', 'padding', 'margin', 'fontFamily', 'fontSize',
      'fontWeight', 'letterSpacing', 'backgroundImage', 'backgroundColor',
      'backdropFilter', 'border', 'boxShadow', 'transform'
    ].map((property) => [property, style[property]])),
    before: Object.fromEntries(['backgroundImage', 'opacity', 'transform'].map((property) => [property, before[property]])),
    after: Object.fromEntries(['backgroundImage', 'opacity', 'transform'].map((property) => [property, after[property]])),
    island: Object.fromEntries(['width', 'height', 'minHeight', 'transform'].map((property) => [property, island[property]]))
  };
});

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

const measureDelta = (before, after) => {
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  const sums = { center: [0, 0, 0], perimeter: [0, 0, 0] };
  const counts = { center: 0, perimeter: 0 };
  for (let y = 0; y < before.height; y += 1) {
    for (let x = 0; x < before.width; x += 1) {
      const index = (y * before.width + x) * 4;
      const center = x >= before.width * 0.15 && x < before.width * 0.85
        && y >= before.height * 0.15 && y < before.height * 0.85;
      const perimeter = x < 3 || x >= before.width - 3 || y < 3 || y >= before.height - 3;
      if (!center && !perimeter) continue;
      const bucket = center ? 'center' : 'perimeter';
      for (let channel = 0; channel < 3; channel += 1) {
        sums[bucket][channel] += Math.abs(after.pixels[index + channel] - before.pixels[index + channel]);
      }
      counts[bucket] += 1;
    }
  }
  return {
    center: sums.center.map((sum) => sum / counts.center),
    perimeter: sums.perimeter.map((sum) => sum / counts.perimeter)
  };
};

const waitForApp = async (page) => {
  await installCovers(page);
  await page.goto('./');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 12_000 });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
};

test.use({ video: 'on' });

test('perimeter flow preserves geometry and concentrates controlled peak pixel change', async ({ page }, testInfo) => {
  await waitForApp(page);
  await page.waitForTimeout(1_000);
  const profile = testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop';
  const locked = LOCKED_STYLE[profile];
  const button = page.locator('#playButton');
  const flow = page.locator('.btn-sheen');

  const metrics = await getMetrics(page);
  expect(metrics.style).toMatchObject({
    ...LOCKED_SHARED_STYLE,
    width: locked.width,
    height: locked.height,
    fontSize: locked.fontSize,
    letterSpacing: locked.letterSpacing
  });
  expect(metrics.style.backgroundImage).toMatch(/^radial-gradient\(circle at 35% 0(?:px|%)/);
  expect(metrics.style.boxShadow).toContain('rgba(0, 0, 0, 0.35) 0px 16px 32px');
  expect(metrics.before).toMatchObject({ opacity: '0.62', transform: 'matrix(1, 0, 0, 1, 0, 0)' });
  expect(metrics.after).toMatchObject({ opacity: '0', transform: 'matrix(0.92, 0, 0, 0.92, 0, 0)' });
  expect(metrics.island).toMatchObject({ width: locked.islandWidth, height: '48px', minHeight: '48px' });
  expect(metrics.rect.width).toBeCloseTo(Number.parseFloat(locked.width), 0);
  expect(metrics.rect.height).toBeCloseTo(Number.parseFloat(locked.height), 0);

  if (testInfo.project.name === 'mobile-reduce') {
    const reduced = await flow.evaluate((node) => {
      const style = getComputedStyle(node, '::before');
      return { animationName: style.animationName, opacity: style.opacity };
    });
    expect(reduced).toEqual({ animationName: 'none', opacity: '0' });
    await button.screenshot({ path: testInfo.outputPath('button-reduced-motion.png') });
    return;
  }

  const duration = profile === 'mobile' ? 9600 : 7200;
  const peakAt = profile === 'mobile' ? duration / 16 : duration / 12;
  const animation = await flow.evaluate((node) => {
    const animations = node.getAnimations({ subtree: true });
    for (const candidate of animations) candidate.pause();
    return animations.map(({ animationName, effect }) => ({
      animationName,
      duration: effect.getTiming().duration
    }));
  });
  expect(animation).toEqual(expect.arrayContaining([
    expect.objectContaining({ duration })
  ]));

  await flow.evaluate((node) => {
    for (const animation of node.getAnimations({ subtree: true })) animation.currentTime = 0;
  });
  const idle = await button.screenshot({ path: testInfo.outputPath('button-idle.png') });
  await flow.evaluate((node, time) => {
    for (const animation of node.getAnimations({ subtree: true })) animation.currentTime = time;
  }, peakAt);
  const peak = await button.screenshot({ path: testInfo.outputPath('button-natural-peak.png') });
  const peakMetrics = await getMetrics(page);
  expect(peakMetrics.style).toEqual(metrics.style);
  expect(peakMetrics.before).toEqual(metrics.before);
  expect(peakMetrics.after).toEqual(metrics.after);
  expect(peakMetrics.island).toEqual(metrics.island);
  expect(peakMetrics.rect).toEqual(metrics.rect);
  expect(peakMetrics.label).toEqual(metrics.label);
  const delta = measureDelta(await decodeScreenshot(page, idle), await decodeScreenshot(page, peak));
  expect(delta.center.every((value) => value < 4)).toBe(true);
  expect(Math.max(...delta.perimeter)).toBeGreaterThan(Math.max(...delta.center));
  await writeFile(testInfo.outputPath('pixel-metrics.json'), JSON.stringify({ profile, delta }, null, 2));

  for (const state of ['busy', 'overlay']) {
    await page.evaluate((nextState) => {
      const buttonNode = document.querySelector('#playButton');
      buttonNode.toggleAttribute('data-busy', nextState === 'busy');
      document.body.classList.toggle('has-lyric-overlay', nextState === 'overlay');
    }, state);
    const stopped = await flow.evaluate((node) => {
      const style = getComputedStyle(node, '::before');
      return { animationName: style.animationName, opacity: style.opacity };
    });
    expect(stopped).toEqual({ animationName: 'none', opacity: '0' });
    const stateMetrics = await getMetrics(page);
    expect(stateMetrics.style).toEqual(metrics.style);
    expect(stateMetrics.before).toEqual(metrics.before);
    expect(stateMetrics.after).toEqual(metrics.after);
    expect(stateMetrics.island).toEqual(metrics.island);
    expect(stateMetrics.rect).toEqual(metrics.rect);
    expect(stateMetrics.label).toEqual(metrics.label);
    await page.evaluate(() => {
      document.querySelector('#playButton').removeAttribute('data-busy');
      document.body.classList.remove('has-lyric-overlay');
    });
  }
});

test('desktop and 390x844 evidence records one natural unpaused orbit', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-reduce');
  const mobile = testInfo.project.name === 'mobile-chromium';
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 };
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'no-preference',
    recordVideo: { dir: testInfo.outputPath('raw-video'), size: viewport }
  });
  const page = await context.newPage();
  const video = page.video();
  await waitForApp(page);
  const flowState = await page.locator('.btn-sheen').evaluate((node) => ({
    viewport: [innerWidth, innerHeight],
    compact: matchMedia('(hover: none) and (pointer: coarse)').matches,
    animations: node.getAnimations({ subtree: true }).map(({ playState, playbackRate }) => ({ playState, playbackRate }))
  }));
  expect(flowState.animations.length).toBeGreaterThanOrEqual(2);
  expect(flowState.animations.every(({ playState, playbackRate }) => playState === 'running' && playbackRate === 1)).toBe(true);
  expect(flowState.viewport).toEqual([viewport.width, viewport.height]);
  expect(flowState.compact).toBe(mobile);
  await page.waitForTimeout(1_350);
  const finalState = await page.locator('.btn-sheen').evaluate((node) => node.getAnimations({ subtree: true }).map(
    ({ playState, playbackRate }) => ({ playState, playbackRate })
  ));
  expect(finalState.every(({ playState, playbackRate }) => playState === 'running' && playbackRate === 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('natural-orbit-end.png') });
  await context.close();
  await video.saveAs(testInfo.outputPath(mobile ? 'mobile-390x844-natural.webm' : 'desktop-natural.webm'));
});

test('Pixel 5 runs two compact cycles without attributable long tasks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.addInitScript(() => {
    window.__buttonLongTasks = [];
    new PerformanceObserver((list) => {
      window.__buttonLongTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
    }).observe({ type: 'longtask', buffered: true });
  });
  await waitForApp(page);
  const startedAt = await page.evaluate(() => performance.now());
  await page.waitForTimeout(19_200);
  const { attributable, viewport } = await page.evaluate((start) => ({
    viewport: [innerWidth, innerHeight],
    attributable: window.__buttonLongTasks.filter(
      ({ startTime, duration }) => startTime >= start && duration > 50
    )
  }), startedAt);
  expect(attributable).toEqual([]);
  await writeFile(testInfo.outputPath('long-task-metrics.json'), JSON.stringify({
    viewport,
    observedMs: 19_200,
    thresholdMs: 50,
    attributable
  }, null, 2));
});
