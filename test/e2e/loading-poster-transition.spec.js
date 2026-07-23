import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const FIXTURE_DELAY_STEP_MS = 80;
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
const FAILED_COVER_PATHNAME = new URL(
  CRITICAL_IMAGE_MANIFEST.find(({ id }) => id === 'archive-01').source
).pathname;

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

const createRequestStats = () => ({
  active: 0,
  maxActive: 0,
  total: 0,
  pathnames: [],
  unknownPathnames: []
});

const installFailureThenRetryCovers = async (page) => {
  const stats = {
    failure: createRequestStats(),
    retry: createRequestStats()
  };
  let phase = 'failure';
  let releaseRetryRequests;
  const retryGate = new Promise((resolve) => {
    releaseRetryRequests = resolve;
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'image') {
      await route.continue();
      return;
    }

    const requestPhase = phase;
    const phaseStats = stats[requestPhase];
    const pathname = new URL(request.url()).pathname;
    const fixture = COVER_FIXTURES.get(pathname);
    phaseStats.active += 1;
    phaseStats.total += 1;
    phaseStats.pathnames.push(pathname);
    phaseStats.maxActive = Math.max(phaseStats.maxActive, phaseStats.active);
    if (!fixture) phaseStats.unknownPathnames.push(pathname);

    try {
      if (requestPhase === 'retry') await retryGate;
      if (!fixture) {
        await route.abort('blockedbyclient');
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, fixture.delayMs));
      if (requestPhase === 'failure' && pathname === FAILED_COVER_PATHNAME) {
        await route.abort('failed');
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: coverSvg(fixture.fixtureIndex)
      });
    } finally {
      phaseStats.active -= 1;
    }
  });

  return {
    stats,
    beginRetry() {
      phase = 'retry';
    },
    releaseRetryRequests
  };
};

const canvasState = (canvas) => canvas.evaluate((element) => {
  if (element.width === 0 || element.height === 0) {
    return { alphaCount: 0, phase: element.dataset.phase };
  }
  const pixels = element.getContext('2d').getImageData(0, 0, element.width, element.height).data;
  let alphaCount = 0;
  for (let index = 3; index < pixels.length; index += 4) {
    if (pixels[index] !== 0) alphaCount += 1;
  }
  return { alphaCount, phase: element.dataset.phase };
});

const measureHorizontalLightDelta = (page, before, after) => page.evaluate(async ({ before, after }) => {
  const decode = (base64) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `data:image/png;base64,${base64}`;
  });
  const [beforeImage, afterImage] = await Promise.all([decode(before), decode(after)]);
  const canvas = document.createElement('canvas');
  canvas.width = beforeImage.naturalWidth;
  canvas.height = beforeImage.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixelsFor = (image) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const beforePixels = pixelsFor(beforeImage);
  const afterPixels = pixelsFor(afterImage);
  const columns = Array(canvas.width).fill(0);
  for (let x = 0; x < canvas.width; x += 1) {
    let total = 0;
    for (let y = 0; y < canvas.height; y += 2) {
      const index = ((y * canvas.width) + x) * 4;
      const beforeLuma = (beforePixels[index] * 0.2126)
        + (beforePixels[index + 1] * 0.7152)
        + (beforePixels[index + 2] * 0.0722);
      const afterLuma = (afterPixels[index] * 0.2126)
        + (afterPixels[index + 1] * 0.7152)
        + (afterPixels[index + 2] * 0.0722);
      total += Math.max(0, afterLuma - beforeLuma);
    }
    columns[x] = total / Math.ceil(canvas.height / 2);
  }
  const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const edgeWidth = Math.max(1, Math.floor(canvas.width * 0.1));
  const middle = columns.slice(edgeWidth, -edgeWidth);
  const centerPeak = Math.max(...middle);
  const brightFloor = Math.max(0.35, centerPeak * 0.08);
  const uniformStep = Math.max(0.35, centerPeak * 0.04);
  let longestNearUniformRun = 0;
  let currentNearUniformRun = 0;
  for (let index = 0; index < columns.length; index += 1) {
    const value = columns[index];
    const followsUniformly = currentNearUniformRun === 0
      || Math.abs(value - columns[index - 1]) <= uniformStep;
    if (value >= brightFloor && followsUniformly) currentNearUniformRun += 1;
    else currentNearUniformRun = value >= brightFloor ? 1 : 0;
    longestNearUniformRun = Math.max(longestNearUniformRun, currentNearUniformRun);
  }
  return {
    centerPeak,
    leftEdgeMean: mean(columns.slice(0, edgeWidth)),
    rightEdgeMean: mean(columns.slice(-edgeWidth)),
    longestNearUniformRun,
    longestNearUniformRatio: longestNearUniformRun / columns.length,
    brightFloor,
    uniformStep
  };
}, {
  before: before.toString('base64'),
  after: after.toString('base64')
});

const captureInstrumented = async (page, path) => {
  const start = await page.evaluate(() => performance.now());
  const buffer = await page.screenshot({ path });
  const end = await page.evaluate(() => performance.now());
  await page.evaluate(({ start, end }) => {
    window.__vinylProbeOverhead.push({ start, end });
  }, { start, end });
  return buffer;
};

const installBrowserProbe = async (page) => {
  await page.addInitScript(() => {
    window.__vinylLongTasks = [];
    window.__vinylProbeOverhead = [];
    window.__vinylLoadingProbe = {
      canvas: null,
      effectStart: null,
      loadingSeen: false,
      phaseLeftIdle: false,
      firstRenderedFrameNontransparent: null,
      maxActive: 0,
      activeIds: [],
      activeTimeline: [],
      currentActiveId: null,
      posterGeometry: null,
      slitHiddenAtFirstActive: null,
      continuityArmed: false,
      continuitySamples: 0,
      maxVisualLayers: 0,
      maxDominantPosters: 0,
      minCompositeOpacity: 1,
      midHandoffs: {},
      ignitionLeads: [],
      currentIgnitionAt: null,
      wasSlitLit: false,
      gatheredPixels: [],
      scatterHandoffs: [],
      clearedPixelCounts: [],
      scatterStartFrameCount: null,
      settledFrameCount: null,
      lightPasses: [],
      activeLightPass: null,
      exitGateAt: null
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
        const nextActiveId = active.length === 1 ? active[0].dataset.loadingSlot : null;
        if (nextActiveId && nextActiveId !== probe.currentActiveId) {
          probe.activeTimeline.push({ id: nextActiveId, at: performance.now() });
        }
        probe.currentActiveId = nextActiveId;
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
        if (!loading) {
          if (probe.activeLightPass) {
            probe.activeLightPass.endedAt = performance.now();
            probe.lightPasses.push(probe.activeLightPass);
            probe.activeLightPass = null;
          }
          return;
        }
        const visualFrames = [...loading.querySelectorAll('.loading-frame.is-active, .loading-frame.is-outgoing')];
        probe.continuityArmed ||= Boolean(loading.querySelector('.loading-frame.is-stable'));

        const now = performance.now();
        const slit = loading.querySelector('#loadingLightSlit');
        const slitLit = Boolean(slit?.classList.contains('is-lit'));
        const finalResolving = loading.classList.contains('is-final-resolving');
        const lightPhase = finalResolving ? 'final' : (slitLit ? 'ordinary' : null);
        if (loading.classList.contains('is-exiting') && probe.exitGateAt === null) {
          probe.exitGateAt = now;
        }
        if (lightPhase) {
          if (!probe.activeLightPass || probe.activeLightPass.phase !== lightPhase) {
            if (probe.activeLightPass) {
              probe.activeLightPass.endedAt = now;
              probe.lightPasses.push(probe.activeLightPass);
            }
            probe.activeLightPass = {
              phase: lightPhase,
              direction: slit.dataset.direction,
              startedAt: now,
              endedAt: null,
              samples: []
            };
          }
          const bounds = slit.getBoundingClientRect();
          const opacity = (selector) => Number.parseFloat(
            getComputedStyle(loading.querySelector(selector)).opacity
          ) || 0;
          probe.activeLightPass.samples.push({
            at: now,
            center: bounds.left + (bounds.width / 2),
            parentOpacity: opacity('#loadingLightSlit'),
            coreOpacity: opacity('.loading-light-core'),
            warmOpacity: opacity('.loading-light-edge.is-warm'),
            coolOpacity: opacity('.loading-light-edge.is-cool')
          });
        } else if (probe.activeLightPass) {
          probe.activeLightPass.endedAt = now;
          probe.lightPasses.push(probe.activeLightPass);
          probe.activeLightPass = null;
        }
        if (slitLit && !probe.wasSlitLit) probe.currentIgnitionAt = now;
        if (!slitLit && probe.wasSlitLit) probe.currentIgnitionAt = null;
        probe.wasSlitLit = slitLit;

        if (probe.continuityArmed && !loading.classList.contains('is-final-resolving')) {
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
          const incoming = visualFrames.find((frame) => frame.classList.contains('is-revealing'));
          if (incoming && Number(incoming.dataset.transitionOrder) > 1) {
            const index = visualFrames.indexOf(incoming);
            const opacity = effectiveOpacities[index];
            const id = incoming.dataset.loadingSlot;
            if (opacity >= 0.15 && opacity <= 0.85) {
              const sample = probe.midHandoffs[id] ?? { first: now, last: now, count: 0 };
              sample.last = now;
              sample.count += 1;
              probe.midHandoffs[id] = sample;
            }
            if (
              opacity > 0.05
              && probe.currentIgnitionAt !== null
              && !probe.ignitionLeads.some((entry) => entry.id === id)
            ) {
              probe.ignitionLeads.push({
                id,
                ignitionAt: probe.currentIgnitionAt,
                dominanceAt: now,
                leadMs: now - probe.currentIgnitionAt
              });
            }
          }
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
  let ordinaryLightMetrics = null;
  let ordinaryCapture = null;
  let finalLightMetrics = null;
  let finalCapture = null;
  if (!reduce) {
    await page.waitForFunction(() => (
      document.querySelector('[data-loading-slot="archive-01"].is-active.is-stable')
      && !document.querySelector('#loadingLightSlit')?.classList.contains('is-lit')
    ));
    const ordinaryBaseline = await captureInstrumented(
      page,
      testInfo.outputPath(`ordinary-baseline-${testInfo.project.name}.png`)
    );
    await page.waitForFunction(() => {
      const slit = document.querySelector('#loadingLightSlit.is-lit');
      return document.querySelector('[data-loading-slot="archive-02"].is-revealing')
        && (Number.parseFloat(getComputedStyle(slit).opacity) || 0) >= 0.25;
    });
    ordinaryCapture = await page.evaluate(() => {
      const root = document.querySelector('#loadingScreen');
      const slit = document.querySelector('#loadingLightSlit');
      const animations = root.getAnimations({ subtree: true }).filter(({ animationName }) => (
        animationName?.startsWith('loading-')
      ));
      return {
        at: performance.now(),
        direction: slit.dataset.direction,
        parentOpacity: Number.parseFloat(getComputedStyle(slit).opacity) || 0,
        animationNames: animations.map(({ animationName }) => animationName),
        pausedAnimations: animations.filter(({ playState }) => playState === 'paused').length
      };
    });
    const ordinaryPeak = await captureInstrumented(
      page,
      testInfo.outputPath(`ordinary-natural-peak-${testInfo.project.name}.png`)
    );
    ordinaryLightMetrics = await measureHorizontalLightDelta(page, ordinaryBaseline, ordinaryPeak);

    await page.waitForFunction(() => (
      window.__vinylLoadingProbe.activeIds.includes('archive-05')
    ), null, { timeout: 8_000 });
    await page.waitForFunction(() => {
      const final = document.querySelector('[data-loading-slot="archive-05"].is-active.is-stable');
      return final && !document.querySelector('#loadingScreen')?.classList.contains('is-final-resolving');
    });
    const finalBaseline = await captureInstrumented(
      page,
      testInfo.outputPath(`final-baseline-${testInfo.project.name}.png`)
    );
    await page.waitForFunction(() => {
      const root = document.querySelector('#loadingScreen.is-final-resolving');
      const slit = document.querySelector('#loadingLightSlit');
      return root && (Number.parseFloat(getComputedStyle(slit).opacity) || 0) >= 0.20;
    });
    finalCapture = await page.evaluate(() => {
      const root = document.querySelector('#loadingScreen');
      const slit = document.querySelector('#loadingLightSlit');
      const animations = root.getAnimations({ subtree: true }).filter(({ animationName }) => (
        animationName?.startsWith('loading-final-')
      ));
      const opacity = (selector) => Number.parseFloat(getComputedStyle(root.querySelector(selector)).opacity);
      return {
        at: performance.now(),
        direction: slit.dataset.direction,
        parentOpacity: opacity('#loadingLightSlit'),
        coreOpacity: opacity('.loading-light-core'),
        warmOpacity: opacity('.loading-light-edge.is-warm'),
        coolOpacity: opacity('.loading-light-edge.is-cool'),
        animationNames: animations.map(({ animationName }) => animationName),
        pausedAnimations: animations.filter(({ playState }) => playState === 'paused').length
      };
    });
    const finalPeak = await captureInstrumented(
      page,
      testInfo.outputPath(`final-natural-peak-${testInfo.project.name}.png`)
    );
    finalLightMetrics = await measureHorizontalLightDelta(page, finalBaseline, finalPeak);

    expect(['ltr', 'rtl']).toContain(ordinaryCapture.direction);
    expect(ordinaryCapture.pausedAnimations).toBe(0);
    expect(ordinaryCapture.parentOpacity).toBeGreaterThanOrEqual(0.25);
    expect(['ltr', 'rtl']).toContain(finalCapture.direction);
    expect(finalCapture.animationNames).toContain(`loading-final-${finalCapture.direction}`);
    expect(finalCapture.pausedAnimations).toBe(0);
    expect(finalCapture.parentOpacity).toBeGreaterThanOrEqual(0.20);
    expect(finalCapture.parentOpacity).toBeLessThanOrEqual(0.22);
    expect(finalCapture.coreOpacity).toBeLessThanOrEqual(0.52);
    expect(finalCapture.warmOpacity).toBeLessThanOrEqual(0.22);
    expect(finalCapture.coolOpacity).toBeLessThanOrEqual(0.20);
  }
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  const effectEnd = await page.evaluate(() => performance.now());
  if (!reduce) {
    for (const metrics of [ordinaryLightMetrics, finalLightMetrics]) {
      expect(metrics.centerPeak).toBeGreaterThan(0.5);
      const edgeNoiseBound = Math.max(0.5, metrics.centerPeak * 0.25);
      expect(metrics.leftEdgeMean).toBeLessThan(edgeNoiseBound);
      expect(metrics.rightEdgeMean).toBeLessThan(edgeNoiseBound);
      expect(metrics.longestNearUniformRatio).toBeLessThanOrEqual(0.35);
    }
  }

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
    activeTimeline: window.__vinylLoadingProbe.activeTimeline,
    continuitySamples: window.__vinylLoadingProbe.continuitySamples,
    maxVisualLayers: window.__vinylLoadingProbe.maxVisualLayers,
    maxDominantPosters: window.__vinylLoadingProbe.maxDominantPosters,
    minCompositeOpacity: window.__vinylLoadingProbe.minCompositeOpacity,
    midHandoffs: window.__vinylLoadingProbe.midHandoffs,
    ignitionLeads: window.__vinylLoadingProbe.ignitionLeads,
    gatheredPixels: window.__vinylLoadingProbe.gatheredPixels,
    scatterHandoffs: window.__vinylLoadingProbe.scatterHandoffs,
    clearedPixelCounts: window.__vinylLoadingProbe.clearedPixelCounts,
    lightPasses: window.__vinylLoadingProbe.lightPasses,
    exitGateAt: window.__vinylLoadingProbe.exitGateAt
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
    expect(finalProbe.minCompositeOpacity).toBeGreaterThanOrEqual(0.94);
    const midHandoffs = Object.values(finalProbe.midHandoffs);
    expect(midHandoffs).toHaveLength(4);
    for (const sample of midHandoffs) {
      expect(sample.count).toBeGreaterThanOrEqual(8);
      expect(sample.last - sample.first).toBeGreaterThanOrEqual(210);
    }
    expect(finalProbe.ignitionLeads).toHaveLength(4);
    expect(finalProbe.ignitionLeads.every(({ leadMs }) => leadMs > 0)).toBe(true);
    const ordinaryPass = finalProbe.lightPasses.find((pass) => (
      pass.phase === 'ordinary'
      && pass.startedAt <= ordinaryCapture.at
      && pass.endedAt >= ordinaryCapture.at
    ));
    const finalPass = finalProbe.lightPasses.find((pass) => pass.phase === 'final');
    expect(ordinaryPass).toBeTruthy();
    expect(finalPass).toBeTruthy();
    expect(ordinaryPass.samples.length).toBeGreaterThanOrEqual(8);
    expect(finalPass.samples.length).toBeGreaterThanOrEqual(8);
    expect(finalPass.startedAt).toBeLessThan(finalProbe.exitGateAt);
    expect(finalCapture.at).toBeLessThan(finalProbe.exitGateAt);
    const naturalPeak = (pass) => pass.samples.reduce((peak, sample) => (
      sample.parentOpacity > peak.parentOpacity ? sample : peak
    ));
    const ordinaryNaturalPeak = naturalPeak(ordinaryPass);
    const finalNaturalPeak = naturalPeak(finalPass);
    expect(ordinaryNaturalPeak.at).toBeGreaterThanOrEqual(ordinaryPass.startedAt);
    expect(ordinaryNaturalPeak.parentOpacity).toBeGreaterThanOrEqual(0.27);
    expect(finalNaturalPeak.parentOpacity).toBeGreaterThanOrEqual(0.20);
    expect(finalNaturalPeak.at).toBeLessThan(finalProbe.exitGateAt);
    expect(finalNaturalPeak.coreOpacity).toBeLessThanOrEqual(0.52);
    expect(finalNaturalPeak.warmOpacity).toBeLessThanOrEqual(0.22);
    expect(finalNaturalPeak.coolOpacity).toBeLessThanOrEqual(0.20);
    for (const pass of [ordinaryPass, finalPass]) {
      const deltas = pass.samples.slice(1).map((sample, index) => (
        sample.center - pass.samples[index].center
      ));
      expect(deltas.every((delta) => pass.direction === 'ltr' ? delta >= -0.5 : delta <= 0.5)).toBe(true);
    }
    if (testInfo.project.name === 'mobile-chromium') {
      const activeDeltas = finalProbe.activeTimeline.slice(1).map(({ at }, index) => (
        at - finalProbe.activeTimeline[index].at
      ));
      expect(activeDeltas.slice(-3).every((duration) => duration >= 900 && duration < 1000)).toBe(true);
    }
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
      && !window.__vinylProbeOverhead.some((overhead) => (
        entry.startTime <= overhead.end
        && (entry.startTime + entry.duration) >= overhead.start
      ))
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
    ordinaryCapture,
    ordinaryLightMetrics,
    finalCapture,
    finalLightMetrics,
    ...finalProbe
  }, null, 2));
  await testInfo.attach('loading-poster-transition-metrics.json', {
    path: metricsPath,
    contentType: 'application/json'
  });
});

test('failed cover loading clears particles and retry restarts from an empty Canvas', async ({ page }) => {
  const routeControl = await installFailureThenRetryCovers(page);
  await page.goto('./', { waitUntil: 'commit' });

  const loading = page.locator('#loadingScreen');
  const retry = page.locator('#loadingRetry');
  const canvas = page.locator('#loadingParticles');
  await expect(retry).toBeVisible({ timeout: 10_000 });
  await expect(loading).toHaveAttribute('data-state', 'error');
  await expect(loading).toHaveAttribute('data-error-kind', 'asset');
  expect(routeControl.stats.failure).toMatchObject({
    active: 0,
    total: 9,
    unknownPathnames: []
  });
  expect([...routeControl.stats.failure.pathnames].sort()).toEqual([
    ...EXPECTED_COVER_PATHNAMES,
    ...Array(4).fill(FAILED_COVER_PATHNAME)
  ].sort());
  expect(routeControl.stats.failure.maxActive).toBeLessThanOrEqual(2);
  await expect(canvasState(canvas)).resolves.toEqual({ alphaCount: 0, phase: 'idle' });

  routeControl.beginRetry();
  await retry.click();
  await expect(loading).toHaveAttribute('data-state', 'loading');
  await expect(canvasState(canvas)).resolves.toEqual({ alphaCount: 0, phase: 'idle' });
  routeControl.releaseRetryRequests();

  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  expectExactCoverRequests(routeControl.stats.retry);
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#appRoot')).not.toHaveAttribute('aria-hidden', 'true');
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
