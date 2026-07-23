import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const FIXTURE_DELAY_STEP_MS = 160;
const EXPECTED_ARCHIVE_IDS = Object.freeze([
  'archive-01',
  'archive-02',
  'archive-03',
  'archive-04',
  'archive-05'
]);

const COVER_FIXTURES = new Map(EXPECTED_ARCHIVE_IDS.map((id, index) => {
  const asset = CRITICAL_IMAGE_MANIFEST.find((entry) => entry.id === id);
  if (!asset) throw new Error(`Missing deterministic cover fixture: ${id}`);
  const fixtureIndex = index + 1;
  return [
    new URL(asset.source).pathname,
    { fixtureIndex, delayMs: fixtureIndex * FIXTURE_DELAY_STEP_MS }
  ];
}));
const EXPECTED_COVER_PATHNAMES = [...COVER_FIXTURES.keys()].sort();

const coverSvg = (index) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#11151d"/>
    <rect x="28" y="28" width="544" height="744" fill="#f4f1e8"/>
    <rect x="56" y="56" width="488" height="688" fill="#26394a"/>
    <text x="300" y="410" text-anchor="middle" fill="#fffdf4" font-size="64">AR-${String(index).padStart(2, '0')}</text>
  </svg>
`);

const installDeterministicCovers = async (page) => {
  expect(CRITICAL_IMAGE_MANIFEST.map(({ id }) => id)).toEqual(EXPECTED_ARCHIVE_IDS);
  const stats = {
    active: 0,
    maxActive: 0,
    total: 0,
    pathnames: [],
    unknownPathnames: []
  };
  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'image') {
      await route.continue();
      return;
    }

    const pathname = new URL(request.url()).pathname;
    stats.active += 1;
    stats.total += 1;
    stats.pathnames.push(pathname);
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    const fixture = COVER_FIXTURES.get(pathname);
    if (!fixture) stats.unknownPathnames.push(pathname);

    try {
      if (!fixture) {
        await route.abort('blockedbyclient');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: coverSvg(fixture.fixtureIndex)
      });
    } finally {
      stats.active -= 1;
    }
  });
  return stats;
};

const expectExactCoverRequests = (stats) => {
  expect(stats.active).toBe(0);
  expect(stats.total).toBe(EXPECTED_ARCHIVE_IDS.length);
  expect([...stats.pathnames].sort()).toEqual(EXPECTED_COVER_PATHNAMES);
  expect(stats.unknownPathnames).toEqual([]);
  expect(stats.maxActive).toBeLessThanOrEqual(2);
};

const installBrowserProbe = async (page) => {
  await page.addInitScript(() => {
    window.__vinylLongTasks = [];
    window.__vinylLoadingProbe = {
      canvas: null,
      effectStart: null,
      loadingSeen: false,
      phaseLeftIdle: false,
      firstRenderedFrameNontransparent: null,
      maxActive: 0,
      activeIds: [],
      currentActiveId: null,
      posterGeometry: null,
      slitHiddenAtFirstActive: null,
      continuityArmed: false,
      continuitySamples: 0,
      maxVisualLayers: 0,
      maxDominantPosters: 0,
      minCompositeOpacity: 1,
      gatheredPixels: [],
      scatterHandoffs: [],
      clearedPixelCounts: [],
      scatterStartFrameCount: null,
      settledFrameCount: null
    };

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        window.__vinylLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: true });

    document.addEventListener('DOMContentLoaded', () => {
      const probe = window.__vinylLoadingProbe;
      probe.effectStart = performance.now();
      probe.canvas = document.querySelector('#loadingParticles');
      probe.loadingSeen = Boolean(document.querySelector('#loadingScreen'));

      const inspectCanvas = () => {
        const canvas = probe.canvas;
        if (!canvas) return;
        const phase = canvas.dataset.phase;
        const frameCount = Number(canvas.dataset.frameCount) || 0;
        probe.phaseLeftIdle ||= Boolean(phase && phase !== 'idle');

        const pixelMetrics = () => {
          const { width, height } = canvas;
          const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
          let count = 0;
          let left = width;
          let top = height;
          let right = -1;
          let bottom = -1;
          for (let index = 3; index < pixels.length; index += 4) {
            if (pixels[index] === 0) continue;
            const pixel = (index - 3) / 4;
            const x = pixel % width;
            const y = Math.floor(pixel / width);
            count += 1;
            left = Math.min(left, x);
            top = Math.min(top, y);
            right = Math.max(right, x);
            bottom = Math.max(bottom, y);
          }
          return { count, bounds: count > 0 ? { left, top, right, bottom } : null };
        };

        if (phase === 'gathered') {
          const last = probe.gatheredPixels.at(-1);
          if (!last || last.frameCount !== frameCount) {
            probe.gatheredPixels.push({ frameCount, ...pixelMetrics() });
          }
        }
        if (phase === 'scatter' && probe.scatterStartFrameCount === null) {
          probe.scatterStartFrameCount = frameCount;
        }
        if (phase === 'scatter' && frameCount > probe.scatterStartFrameCount) {
          const gathered = probe.gatheredPixels.at(-1);
          if (gathered && !probe.scatterHandoffs.some(({ gatheredFrameCount }) => (
            gatheredFrameCount === gathered.frameCount
          ))) {
            probe.scatterHandoffs.push({
              gatheredFrameCount: gathered.frameCount,
              gathered: { count: gathered.count, bounds: gathered.bounds },
              scattered: pixelMetrics()
            });
          }
        }
        if (phase === 'idle') {
          probe.scatterStartFrameCount = null;
          if (frameCount > 0 && probe.settledFrameCount !== frameCount) {
            probe.settledFrameCount = frameCount;
            probe.clearedPixelCounts.push(pixelMetrics().count);
          }
        }
        if (
          probe.firstRenderedFrameNontransparent !== null
          || frameCount === 0
        ) return;

        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        probe.firstRenderedFrameNontransparent = false;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] === 0) continue;
          probe.firstRenderedFrameNontransparent = true;
          break;
        }
      };

      const inspectActivePosters = () => {
        const active = [...document.querySelectorAll('.loading-frame.is-active')];
        probe.maxActive = Math.max(probe.maxActive, active.length);
        probe.currentActiveId = active.length === 1 ? active[0].dataset.loadingSlot : null;
        for (const slot of active) {
          if (!probe.activeIds.includes(slot.dataset.loadingSlot)) {
            probe.activeIds.push(slot.dataset.loadingSlot);
          }
        }

        if (probe.posterGeometry || active.length !== 1) return;
        const image = active[0].querySelector('.loading-image');
        const stage = image?.closest('.loading-stage');
        if (!image || !stage || image.naturalWidth === 0) return;
        const imageRect = image.getBoundingClientRect();
        const stageRect = stage.getBoundingClientRect();
        probe.posterGeometry = {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          objectFit: getComputedStyle(image).objectFit,
          insideStage: imageRect.width <= stageRect.width + 0.5 && imageRect.height <= stageRect.height + 0.5
        };
        const slit = document.querySelector('#loadingLightSlit');
        probe.slitHiddenAtFirstActive = slit ? getComputedStyle(slit).display === 'none' : null;
      };

      new MutationObserver(() => {
        inspectActivePosters();
        inspectCanvas();
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-phase', 'data-frame-count'],
        childList: true,
        subtree: true
      });

      inspectActivePosters();
      inspectCanvas();

      const samplePosterContinuity = () => {
        const loading = document.querySelector('#loadingScreen');
        if (!loading) return;
        const visualFrames = [...loading.querySelectorAll('.loading-frame.is-active, .loading-frame.is-outgoing')];
        probe.continuityArmed ||= Boolean(loading.querySelector('.loading-frame.is-stable'));

        if (probe.continuityArmed && !loading.classList.contains('is-final-exposure')) {
          const effectiveOpacities = visualFrames.map((frame) => {
            const frameStyle = getComputedStyle(frame);
            const imageStyle = getComputedStyle(frame.querySelector('.loading-image'));
            const frameOpacity = Number.parseFloat(frameStyle.opacity) || 0;
            const imageOpacity = Number.parseFloat(imageStyle.opacity) || 0;
            return frameStyle.visibility === 'visible' ? frameOpacity * imageOpacity : 0;
          });
          probe.continuitySamples += 1;
          probe.maxVisualLayers = Math.max(probe.maxVisualLayers, visualFrames.length);
          probe.maxDominantPosters = Math.max(
            probe.maxDominantPosters,
            effectiveOpacities.filter((opacity) => opacity > 0.55).length
          );
          probe.minCompositeOpacity = Math.min(
            probe.minCompositeOpacity,
            effectiveOpacities.reduce((sum, opacity) => sum + opacity, 0)
          );
        }
        requestAnimationFrame(samplePosterContinuity);
      };
      requestAnimationFrame(samplePosterContinuity);
    }, { once: true });
  });
};

test('single-poster loading sequence is bounded and settles', async ({ page }, testInfo) => {
  const reduce = testInfo.project.name === 'mobile-reduce';
  const tracePath = testInfo.outputPath('loading-poster-transition-trace.zip');
  const stats = await installDeterministicCovers(page);
  await installBrowserProbe(page);
  await page.goto('./', { waitUntil: 'commit' });

  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(reduce);
  await page.waitForFunction(() => (
    window.__vinylLoadingProbe?.canvas
    && window.__vinylLoadingProbe.maxActive > 0
    && window.__vinylLoadingProbe.posterGeometry
  ), null, { timeout: 5_000 });

  const loading = page.locator('#loadingScreen');
  const canvasJsHandle = await page.evaluateHandle(() => window.__vinylLoadingProbe.canvas);
  const canvasHandle = canvasJsHandle.asElement();
  expect(canvasHandle).not.toBeNull();

  const initialProbe = await page.evaluate(() => ({
    effectStart: window.__vinylLoadingProbe.effectStart,
    loadingSeen: window.__vinylLoadingProbe.loadingSeen,
    maxActive: window.__vinylLoadingProbe.maxActive,
    posterGeometry: window.__vinylLoadingProbe.posterGeometry,
    slitHiddenAtFirstActive: window.__vinylLoadingProbe.slitHiddenAtFirstActive
  }));
  expect(Number.isFinite(initialProbe.effectStart)).toBe(true);
  expect(initialProbe.loadingSeen).toBe(true);
  expect(initialProbe.maxActive).toBe(1);
  expect(initialProbe.posterGeometry).toEqual({
    naturalWidth: 600,
    naturalHeight: 800,
    objectFit: 'contain',
    insideStage: true
  });

  if (reduce) expect(initialProbe.slitHiddenAtFirstActive).toBe(true);
  if (!reduce) {
    await page.waitForFunction(() => (
      window.__vinylLoadingProbe.activeIds.includes('archive-05')
    ), null, { timeout: 8_000 });
  }
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  const effectEnd = await page.evaluate(() => performance.now());

  const framesAtExit = Number(await canvasHandle.evaluate((element) => element.dataset.frameCount));
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 120)));
  }));
  const framesAfterWait = Number(await canvasHandle.evaluate((element) => element.dataset.frameCount));
  expect(framesAfterWait).toBe(framesAtExit);

  const finalProbe = await page.evaluate(() => ({
    phaseLeftIdle: window.__vinylLoadingProbe.phaseLeftIdle,
    firstRenderedFrameNontransparent: window.__vinylLoadingProbe.firstRenderedFrameNontransparent,
    maxActive: window.__vinylLoadingProbe.maxActive,
    activeIds: window.__vinylLoadingProbe.activeIds,
    continuitySamples: window.__vinylLoadingProbe.continuitySamples,
    maxVisualLayers: window.__vinylLoadingProbe.maxVisualLayers,
    maxDominantPosters: window.__vinylLoadingProbe.maxDominantPosters,
    minCompositeOpacity: window.__vinylLoadingProbe.minCompositeOpacity,
    gatheredPixels: window.__vinylLoadingProbe.gatheredPixels,
    scatterHandoffs: window.__vinylLoadingProbe.scatterHandoffs,
    clearedPixelCounts: window.__vinylLoadingProbe.clearedPixelCounts
  }));
  expect(finalProbe.maxActive).toBe(1);
  if (reduce) {
    expect(framesAtExit).toBe(0);
    expect(finalProbe.phaseLeftIdle).toBe(false);
    expect(finalProbe.firstRenderedFrameNontransparent).toBeNull();
  } else {
    expect(finalProbe.phaseLeftIdle).toBe(true);
    expect(finalProbe.firstRenderedFrameNontransparent).toBe(true);
    expect(finalProbe.gatheredPixels.length).toBeGreaterThan(0);
    expect(finalProbe.scatterHandoffs.length).toBeGreaterThan(0);
    for (const handoff of finalProbe.scatterHandoffs) {
      expect(handoff.scattered).toEqual(handoff.gathered);
    }
    expect(finalProbe.clearedPixelCounts.length).toBeGreaterThan(0);
    expect(finalProbe.clearedPixelCounts.every((count) => count === 0)).toBe(true);
  }
  if (!reduce) {
    expect(finalProbe.continuitySamples).toBeGreaterThan(3);
    expect(finalProbe.maxVisualLayers).toBeLessThanOrEqual(2);
    expect(finalProbe.maxDominantPosters).toBeLessThanOrEqual(1);
    expect(finalProbe.minCompositeOpacity).toBeGreaterThanOrEqual(0.90);
  }
  expect(finalProbe.activeIds).toEqual([
    'archive-01',
    'archive-02',
    'archive-03',
    'archive-04',
    'archive-05'
  ]);

  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#appRoot')).not.toHaveAttribute('aria-hidden', 'true');
  expectExactCoverRequests(stats);

  const effectLongTasks = await page.evaluate(({ end }) => (
    window.__vinylLongTasks.filter((entry) => (
      entry.startTime >= window.__vinylLoadingProbe.effectStart
      && entry.startTime <= end
    ))
  ), { end: effectEnd });
  expect(effectLongTasks.filter(({ duration }) => duration > 50)).toEqual([]);
  expect(await canvasHandle.evaluate((canvas) => {
    if (canvas.width === 0 || canvas.height === 0) return true;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) return false;
    }
    return true;
  })).toBe(true);

  await page.context().tracing.stop({ path: tracePath });
  await testInfo.attach('loading-poster-transition-trace.zip', {
    path: tracePath,
    contentType: 'application/zip'
  });
  const metricsPath = testInfo.outputPath('loading-poster-transition-metrics.json');
  await writeFile(metricsPath, JSON.stringify({
    project: testInfo.project.name,
    framesAtExit,
    framesAfterWait,
    requestCount: stats.total,
    maxRequestConcurrency: stats.maxActive,
    effectLongTasks,
    ...finalProbe
  }, null, 2));
  await testInfo.attach('loading-poster-transition-metrics.json', {
    path: metricsPath,
    contentType: 'application/json'
  });
});

test('captures the loading poster visual', async ({ page }, testInfo) => {
  const stats = await installDeterministicCovers(page);
  await page.goto('./', { waitUntil: 'commit' });
  const loading = page.locator('#loadingScreen');

  await page.waitForFunction(() => {
    const loadingScreen = document.querySelector('#loadingScreen');
    const image = document.querySelector('.loading-frame.is-active .loading-image');
    return loadingScreen?.isConnected
      && image
      && Number.parseFloat(getComputedStyle(image).opacity) > 0.5;
  }, null, { timeout: 5_000 });

  await page.screenshot({
    path: testInfo.outputPath(`loading-${testInfo.project.name}.png`)
  });

  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  expectExactCoverRequests(stats);
});
