import { test, expect } from '@playwright/test';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const FIXTURE_DELAY_STEP_MS = 160;

const COVER_FIXTURES = new Map(CRITICAL_IMAGE_MANIFEST.map((asset, index) => {
  const fixtureIndex = index + 1;
  return [
    new URL(asset.source).pathname,
    { fixtureIndex, delayMs: fixtureIndex * FIXTURE_DELAY_STEP_MS }
  ];
}));

const coverSvg = (index) => Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#11151d"/>
    <rect x="28" y="28" width="544" height="744" fill="#f4f1e8"/>
    <rect x="56" y="56" width="488" height="688" fill="#26394a"/>
    <text x="300" y="410" text-anchor="middle" fill="#fffdf4" font-size="64">AR-${String(index).padStart(2, '0')}</text>
  </svg>
`);

const installDeterministicCovers = async (page) => {
  const stats = { active: 0, maxActive: 0, total: 0 };
  await page.route('**/*', async (route) => {
    const fixture = COVER_FIXTURES.get(new URL(route.request().url()).pathname);
    if (route.request().resourceType() !== 'image' || !fixture) {
      await route.continue();
      return;
    }
    stats.active += 1;
    stats.total += 1;
    stats.maxActive = Math.max(stats.maxActive, stats.active);
    try {
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
      slitHiddenAtFirstActive: null
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
        probe.phaseLeftIdle ||= Boolean(phase && phase !== 'idle');
        if (
          probe.firstRenderedFrameNontransparent !== null
          || Number(canvas.dataset.frameCount) === 0
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
    }, { once: true });
  });
};

test('single-poster loading sequence is bounded and settles', async ({ page }, testInfo) => {
  const reduce = testInfo.project.name === 'mobile-reduce';
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
  await page.waitForTimeout(300);
  const framesAfterWait = Number(await canvasHandle.evaluate((element) => element.dataset.frameCount));
  expect(framesAfterWait).toBe(framesAtExit);

  const finalProbe = await page.evaluate(() => ({
    phaseLeftIdle: window.__vinylLoadingProbe.phaseLeftIdle,
    firstRenderedFrameNontransparent: window.__vinylLoadingProbe.firstRenderedFrameNontransparent,
    maxActive: window.__vinylLoadingProbe.maxActive,
    activeIds: window.__vinylLoadingProbe.activeIds
  }));
  expect(finalProbe.maxActive).toBe(1);
  if (reduce) {
    expect(framesAtExit).toBe(0);
    expect(finalProbe.phaseLeftIdle).toBe(false);
    expect(finalProbe.firstRenderedFrameNontransparent).toBeNull();
  } else {
    expect(finalProbe.phaseLeftIdle).toBe(true);
    expect(finalProbe.firstRenderedFrameNontransparent).toBe(true);
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
  expect(stats.total).toBe(5);
  expect(stats.maxActive).toBeLessThanOrEqual(2);

  const effectLongTasks = await page.evaluate(({ end }) => (
    window.__vinylLongTasks.filter((entry) => (
      entry.startTime >= window.__vinylLoadingProbe.effectStart
      && entry.startTime <= end
    ))
  ), { end: effectEnd });
  expect(effectLongTasks.filter(({ duration }) => duration > 50)).toEqual([]);
});

test('captures the loading poster visual', async ({ page }, testInfo) => {
  await installDeterministicCovers(page);
  await page.goto('./', { waitUntil: 'commit' });

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
});
