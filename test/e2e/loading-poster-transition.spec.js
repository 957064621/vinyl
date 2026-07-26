import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const FIXTURE_DELAY_STEP_MS = 80;
const LIGHT_PEAK_OFFSETS = Object.freeze({ ordinary: 0.40, final: 0.30 });
const HIGH_VISIBILITY_POSTER_OPACITY = 0.35;
// One 60Hz presentation interval plus 3.4ms for timestamp and rAF sampling quantization.
const PRESENTED_FRAME_TOLERANCE_MS = 20;
const PARENT_PEAK_LOWER_BOUNDS = Object.freeze({ ordinary: 0.60, final: 0.20 });
const PARENT_PEAK_UPPER_BOUNDS = Object.freeze({ ordinary: 0.84, final: 0.30 });
const SEMANTIC_LIGHT_LIMITS = Object.freeze({
  gateNetMeanMin: 4,
  gateLitRatioMin: 0.75,
  gateProminenceMin: 1.2,
  gateP90Max: 210,
  shoulderNetMeanMin: 0.5,
  shoulderLitRatioMin: 0.25,
  shoulderBalanceMin: 0.04,
  shoulderP90Max: 96
});
const COMPACT_SEMANTIC_LIGHT_LIMITS = Object.freeze({
  ...SEMANTIC_LIGHT_LIMITS,
  gateLitRatioMin: 0.67,
  gateP90Max: 220,
  shoulderNetMeanMin: 0.15,
  shoulderLitRatioMin: 0.08
});
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
    { delayMs: fixtureIndex * FIXTURE_DELAY_STEP_MS }
  ];
}));
const EXPECTED_COVER_PATHNAMES = [...COVER_FIXTURES.keys()].sort();
const FINAL_COVER_PATHNAME = new URL(
  CRITICAL_IMAGE_MANIFEST.find(({ id }) => id === 'archive-05').source
).pathname;
const EXPECTED_COMPLETE_REQUEST_PATHNAMES = [
  ...EXPECTED_COVER_PATHNAMES,
  FINAL_COVER_PATHNAME
].sort();
const FAILED_COVER_PATHNAME = new URL(
  CRITICAL_IMAGE_MANIFEST.find(({ id }) => id === 'archive-01').source
).pathname;

const DETERMINISTIC_COVER = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#11151d"/>
    <rect x="28" y="28" width="544" height="744" fill="#f4f1e8"/>
    <rect x="56" y="56" width="488" height="688" fill="#26394a"/>
    <rect x="164" y="352" width="272" height="96" fill="#fffdf4"/>
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
        body: DETERMINISTIC_COVER
      });
    } finally {
      stats.active -= 1;
    }
  });
  return stats;
};

const expectExactCoverRequests = (stats, expectHandoff = true) => {
  const expectedPathnames = expectHandoff
    ? EXPECTED_COMPLETE_REQUEST_PATHNAMES
    : EXPECTED_COVER_PATHNAMES;
  expect(stats.active).toBe(0);
  expect(stats.total).toBe(expectedPathnames.length);
  expect([...stats.pathnames].sort()).toEqual(expectedPathnames);
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
        body: DETERMINISTIC_COVER
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

const measureSemanticLightDelta = (page, before, after, clip, regions) => page.evaluate(async ({
  before,
  after,
  clip,
  regions
}) => {
  const decode = (base64, mimeType) => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = `data:${mimeType};base64,${base64}`;
  });
  const [beforeImage, afterImage] = await Promise.all([
    decode(before, 'image/png'),
    decode(after.data, after.mimeType)
  ]);
  const canvas = document.createElement('canvas');
  canvas.width = clip.width;
  canvas.height = clip.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixelsFor = (image, source = null) => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (source) {
      context.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        0,
        0,
        canvas.width,
        canvas.height
      );
    } else {
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
    }
    return context.getImageData(0, 0, canvas.width, canvas.height).data;
  };
  const beforePixels = pixelsFor(beforeImage);
  const scaleX = afterImage.naturalWidth / after.metadata.deviceWidth;
  const scaleY = afterImage.naturalHeight / after.metadata.deviceHeight;
  const source = {
    x: (clip.x - after.viewportState.visualOffsetLeft) * scaleX,
    y: (clip.y - after.viewportState.visualOffsetTop) * scaleY,
    width: clip.width * scaleX,
    height: clip.height * scaleY
  };
  const afterPixels = pixelsFor(afterImage, source);
  const croppedPng = canvas.toDataURL('image/png').split(',')[1];
  const deltasFor = (regionOrRegions) => {
    const values = [];
    const regionList = Array.isArray(regionOrRegions) ? regionOrRegions : [regionOrRegions];
    for (const region of regionList) {
      for (let y = region.top - clip.y; y < region.bottom - clip.y; y += 1) {
        for (let x = region.left - clip.x; x < region.right - clip.x; x += 1) {
          const index = ((y * canvas.width) + x) * 4;
          const beforeLuma = (beforePixels[index] * 0.2126)
            + (beforePixels[index + 1] * 0.7152)
            + (beforePixels[index + 2] * 0.0722);
          const afterLuma = (afterPixels[index] * 0.2126)
            + (afterPixels[index + 1] * 0.7152)
            + (afterPixels[index + 2] * 0.0722);
          values.push(Math.max(0, afterLuma - beforeLuma));
        }
      }
    }
    return values;
  };
  const summarize = (values, visibleFloor = Number.POSITIVE_INFINITY) => {
    const sorted = [...values].sort((left, right) => left - right);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    return {
      mean,
      max: sorted.at(-1),
      p90: sorted[Math.floor((sorted.length - 1) * 0.9)],
      litRatio: values.filter((value) => value > visibleFloor).length / values.length
    };
  };
  const background = summarize(deltasFor(regions.background));
  // JPEG screencast frames introduce a small positive rounding floor. Derive the
  // visible threshold from the isolated archive-void background instead of a magic luma value.
  const visibleFloor = background.p90 + 0.75;
  const withNetMean = (region) => {
    const summary = summarize(deltasFor(region), visibleFloor);
    return { ...summary, netMean: Math.max(0, summary.mean - background.mean) };
  };
  const gate = withNetMean(regions.gate);
  const gateContext = withNetMean(regions.gateContext);
  const leftShoulder = withNetMean(regions.leftShoulder);
  const rightShoulder = withNetMean(regions.rightShoulder);
  const columnMeans = Array.from({ length: canvas.width }, (_, x) => {
    let total = 0;
    for (let y = 0; y < canvas.height; y += 1) {
      const index = ((y * canvas.width) + x) * 4;
      const beforeLuma = (beforePixels[index] * 0.2126)
        + (beforePixels[index + 1] * 0.7152)
        + (beforePixels[index + 2] * 0.0722);
      const afterLuma = (afterPixels[index] * 0.2126)
        + (afterPixels[index + 1] * 0.7152)
        + (afterPixels[index + 2] * 0.0722);
      total += Math.max(0, afterLuma - beforeLuma);
    }
    return total / canvas.height;
  });
  const brightestColumn = columnMeans.reduce((brightest, mean, x) => (
    mean > brightest.mean ? { x: x + clip.x, mean } : brightest
  ), { x: clip.x, mean: columnMeans[0] });
  return {
    background,
    visibleFloor,
    gate,
    gateContext,
    gateProminence: gate.netMean / Math.max(0.01, gateContext.netMean),
    leftShoulder,
    rightShoulder,
    shoulderBalance: Math.min(leftShoulder.netMean, rightShoulder.netMean)
      / Math.max(0.01, leftShoulder.netMean, rightShoulder.netMean),
    brightestColumn,
    croppedPng,
    frameMapping: {
      imageWidth: afterImage.naturalWidth,
      imageHeight: afterImage.naturalHeight,
      croppedWidth: canvas.width,
      croppedHeight: canvas.height,
      scaleX,
      scaleY,
      source,
      regions
    }
  };
}, {
  before: before.toString('base64'),
  after: {
    data: after.buffer.toString('base64'),
    mimeType: after.mimeType,
    metadata: after.metadata,
    viewportState: after.viewportState
  },
  clip,
  regions
});

const getLightOracleRegions = (page) => page.evaluate(() => {
  const stage = document.querySelector('.loading-stage').getBoundingClientRect();
  const portalEdgeInset = Math.max(0, (stage.width - 520) / 2);
  const portalX = stage.right - portalEdgeInset;
  const centerY = stage.top + (stage.height / 2);
  const portalHalfHeight = Math.min(stage.height * 0.38, innerHeight * 0.34, 270);
  const portalTop = centerY - portalHalfHeight;
  const portalBottom = centerY + portalHalfHeight;
  const clampRect = ({ left, top, right, bottom }) => ({
    left: Math.max(0, Math.ceil(left)),
    top: Math.max(0, Math.ceil(top)),
    right: Math.min(innerWidth, Math.floor(right)),
    bottom: Math.min(innerHeight, Math.floor(bottom))
  });
  const clip = {
    x: 0,
    y: 0,
    width: Math.floor(innerWidth),
    height: Math.floor(innerHeight)
  };
  const gateRegion = clampRect({
    left: portalX - 2,
    top: portalTop,
    right: portalX + 3,
    bottom: portalBottom
  });
  const gateContext = [
    clampRect({
      left: portalX - 30,
      top: portalTop,
      right: portalX - 20,
      bottom: portalBottom
    }),
    clampRect({
      left: portalX + 20,
      top: portalTop,
      right: portalX + 30,
      bottom: portalBottom
    })
  ];
  const backgroundWidth = Math.max(16, Math.min(72, innerWidth * 0.06));
  const regions = {
    gate: gateRegion,
    gateContext,
    leftShoulder: clampRect({
      left: portalX - 18,
      top: portalTop,
      right: portalX - 5,
      bottom: portalBottom
    }),
    rightShoulder: clampRect({
      left: portalX + 5,
      top: portalTop,
      right: portalX + 18,
      bottom: portalBottom
    }),
    background: [
      clampRect({ left: 0, top: portalTop, right: backgroundWidth, bottom: portalBottom }),
      clampRect({
        left: innerWidth - backgroundWidth,
        top: portalTop,
        right: innerWidth,
        bottom: portalBottom
      })
    ]
  };
  return {
    clip,
    regions,
    gateIsVertical: (gateRegion.bottom - gateRegion.top) / (gateRegion.right - gateRegion.left) >= 30,
    gateMatchesRightPortal: Math.abs(((gateRegion.left + gateRegion.right) / 2) - portalX) <= 1,
    shouldersAreBilateral: regions.leftShoulder.right < portalX
      && regions.rightShoulder.left > portalX,
    regionsAreNonempty: Object.values(regions).flat().every((region) => (
      region.right > region.left && region.bottom > region.top
    ))
  };
});

const readLightAnimation = (phase) => {
  const root = document.querySelector('#loadingScreen');
  const slit = document.querySelector('#loadingLightSlit');
  const final = phase === 'final';
  const prefix = final ? 'loading-final-ambient-converge' : 'loading-right-portal-pulse';
  const animation = root?.getAnimations({ subtree: true }).find(({ animationName }) => (
    animationName?.startsWith(prefix)
  ));
  if (!animation) return null;
  const timing = animation.effect.getComputedTiming();
  const duration = Number(timing.duration);
  const peakOffset = final ? 0.30 : 0.40;
  const at = performance.now();
  const currentTime = Number(animation.currentTime);
  const naturalPeakAt = at + (((duration * peakOffset) - currentTime) / animation.playbackRate);
  const animations = root.getAnimations({ subtree: true }).filter(({ animationName }) => (
    animationName?.startsWith(phase === 'final' ? 'loading-final-' : 'loading-')
  ));
  const opacity = (selector) => {
    const element = root.querySelector(selector);
    return element ? Number.parseFloat(getComputedStyle(element).opacity) || 0 : 0;
  };
  const stage = root.querySelector('.loading-stage');
  const gateLine = getComputedStyle(stage, '::before');
  const gateHalo = getComputedStyle(stage, '::after');
  const slitStyle = getComputedStyle(slit);
  const gateLineOpacity = Number.parseFloat(gateLine.opacity) || 0;
  return {
    at,
    currentTime,
    duration,
    naturalPeakAt,
    animationName: animation.animationName,
    playState: animation.playState,
    playbackRate: animation.playbackRate,
    direction: slit.dataset.direction,
    portalSide: slit.dataset.portalSide,
    portalPhase: slit.dataset.portalPhase,
    parentOpacity: final ? gateLineOpacity : opacity('#loadingLightSlit'),
    coreOpacity: final ? 0 : opacity('.loading-light-core'),
    warmOpacity: final ? 0 : opacity('.loading-light-edge.is-warm'),
    coolOpacity: final ? 0 : opacity('.loading-light-edge.is-cool'),
    slitDisplay: slitStyle.display,
    slitOpacity: Number.parseFloat(slitStyle.opacity) || 0,
    gateLineOpacity,
    gateHaloOpacity: Number.parseFloat(gateHalo.opacity) || 0,
    gateLineWidth: Number.parseFloat(gateLine.width) || 0,
    gateLineHeight: Number.parseFloat(gateLine.height) || 0,
    gateLineFilter: gateLine.filter,
    gateLineAnimationName: gateLine.animationName,
    gateLineDuration: Number.parseFloat(gateLine.animationDuration) * 1000,
    pausedAnimations: animations.filter(({ playState }) => playState === 'paused').length
  };
};

const captureBaseline = async (page, clip) => {
  const start = await page.evaluate(() => performance.now());
  const buffer = await page.screenshot({ clip });
  const end = await page.evaluate(() => performance.now());
  await page.evaluate(({ start, end }) => {
    window.__vinylProbeOverhead.push({ start, end });
  }, { start, end });
  return buffer;
};

const captureNaturalPeak = async (page, { clip, phase }) => {
  const peakOffset = LIGHT_PEAK_OFFSETS[phase];
  await page.waitForFunction(({ phase, peakOffset }) => {
    const root = document.querySelector('#loadingScreen');
    const prefix = phase === 'final'
      ? 'loading-final-ambient-converge'
      : 'loading-right-portal-pulse';
    const animation = root?.getAnimations({ subtree: true }).find(({ animationName }) => (
      animationName?.startsWith(prefix)
    ));
    if (!animation) return false;
    const peakTime = Number(animation.effect.getComputedTiming().duration) * peakOffset;
    return animation.currentTime < peakTime - 100;
  }, { phase, peakOffset });

  const before = await page.evaluate(readLightAnimation, phase);
  const clock = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    viewportState: {
      innerWidth,
      innerHeight,
      scrollX,
      scrollY,
      visualOffsetLeft: visualViewport.offsetLeft,
      visualOffsetTop: visualViewport.offsetTop,
      visualScale: visualViewport.scale
    }
  }));
  const viewport = page.viewportSize();
  const frames = [];
  const screencast = await page.screencast.start({
    quality: 100,
    size: viewport,
    onFrame: ({ data, timestamp, viewportWidth, viewportHeight }) => {
      if (!Number.isFinite(timestamp)) return;
      // Chromium exposes this as CDP Page.screencastFrame metadata.timestamp.
      const metadata = {
        deviceWidth: viewportWidth,
        deviceHeight: viewportHeight,
        timestamp: timestamp / 1000
      };
      frames.push({
        buffer: data,
        mimeType: 'image/jpeg',
        metadata,
        viewportState: clock.viewportState,
        presentedAt: timestamp - clock.timeOrigin
      });
    }
  });
  try {
    await page.waitForFunction((naturalPeakAt) => (
      performance.now() >= naturalPeakAt + 60
    ), before.naturalPeakAt);
  } finally {
    await screencast[Symbol.asyncDispose]();
  }
  const after = await page.evaluate(readLightAnimation, phase);
  if (frames.length === 0) throw new Error(`No ${phase} presented frames were received`);
  const selected = frames.reduce((nearest, frame) => (
    Math.abs(frame.presentedAt - before.naturalPeakAt)
      < Math.abs(nearest.presentedAt - before.naturalPeakAt) ? frame : nearest
  ));
  return {
    ...selected,
    before,
    after,
    candidateCount: frames.length,
    peakErrorMs: selected.presentedAt - before.naturalPeakAt,
    presentedRange: {
      start: frames[0].presentedAt,
      end: frames.at(-1).presentedAt
    }
  };
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
      decodedNodeCount: 0,
      decodedNodeUniqueCount: 0,
      decodedAssetIds: [],
      posterGeometry: null,
      slitHiddenAtFirstActive: null,
      gateHiddenAtFirstActive: null,
      portalOpacityAtFirstActive: null,
      portalCoreOpacityAtFirstActive: null,
      gateLineOpacityAtFirstActive: null,
      gateHaloOpacityAtFirstActive: null,
      continuityArmed: false,
      continuitySamples: 0,
      maxVisualLayers: 0,
      highVisibilityPosterOpacity: 0.35,
      maxHighVisibilityPosters: 0,
      highVisibilityPosterViolations: [],
      finalContinuitySamples: 0,
      maxFinalHighVisibilityPosters: 0,
      finalHighVisibilityPosterViolations: [],
      minCompositeOpacity: 1,
      midHandoffs: {},
      ignitionLeads: [],
      posterTrajectories: {},
      exitTrajectories: {},
      portalSequence: [],
      lastPortalKey: null,
      stableHolds: [],
      currentStable: null,
      currentIgnitionAt: null,
      wasSlitLit: false,
      gatheredPixels: [],
      scatterHandoffs: [],
      clearedPixelCounts: [],
      scatterStartFrameCount: null,
      settledFrameCount: null,
      lightPasses: [],
      activeLightPass: null,
      finalHandoffSamples: [],
      handoffReadySeen: false,
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
        const decodedNodes = [...document.querySelectorAll('.loading-frame > .loading-image')];
        if (decodedNodes.length >= probe.decodedNodeCount) {
          probe.decodedNodeCount = decodedNodes.length;
          probe.decodedNodeUniqueCount = new Set(decodedNodes).size;
          probe.decodedAssetIds = decodedNodes.map(({ dataset }) => dataset.assetId);
        }
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
        const core = slit?.querySelector('.loading-light-core');
        const stageLine = getComputedStyle(stage, '::before');
        const stageHalo = getComputedStyle(stage, '::after');
        probe.slitHiddenAtFirstActive = slit ? getComputedStyle(slit).display === 'none' : null;
        probe.gateHiddenAtFirstActive = stageLine.display === 'none';
        probe.portalOpacityAtFirstActive = slit
          ? Number.parseFloat(getComputedStyle(slit).opacity) || 0
          : null;
        probe.portalCoreOpacityAtFirstActive = core
          ? Number.parseFloat(getComputedStyle(core).opacity) || 0
          : null;
        probe.gateLineOpacityAtFirstActive = Number.parseFloat(stageLine.opacity) || 0;
        probe.gateHaloOpacityAtFirstActive = Number.parseFloat(stageHalo.opacity) || 0;
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

      const readClipGeometry = (clipPath, rect) => {
        if (!clipPath || clipPath === 'none' || !clipPath.startsWith('inset(')) {
          return {
            inset: null,
            roundPercent: null,
            visibleLeft: rect.left,
            visibleTop: rect.top,
            visibleWidth: rect.width,
            visibleHeight: rect.height
          };
        }
        const content = clipPath.slice('inset('.length, -1);
        const [insetSource, roundSource = '0'] = content.split(/\s+round\s+/);
        const tokens = insetSource.trim().split(/\s+/);
        const expanded = tokens.length === 1
          ? [tokens[0], tokens[0], tokens[0], tokens[0]]
          : tokens.length === 2
            ? [tokens[0], tokens[1], tokens[0], tokens[1]]
            : tokens.length === 3
              ? [tokens[0], tokens[1], tokens[2], tokens[1]]
              : tokens.slice(0, 4);
        const toPixels = (token, size) => (
          token.endsWith('%') ? (Number.parseFloat(token) / 100) * size : Number.parseFloat(token)
        );
        const [top, right, bottom, left] = [
          toPixels(expanded[0], rect.height),
          toPixels(expanded[1], rect.width),
          toPixels(expanded[2], rect.height),
          toPixels(expanded[3], rect.width)
        ];
        return {
          inset: { top, right, bottom, left },
          roundPercent: Number.parseFloat(roundSource),
          visibleLeft: rect.left + left,
          visibleTop: rect.top + top,
          visibleWidth: Math.max(0, rect.width - left - right),
          visibleHeight: Math.max(0, rect.height - top - bottom)
        };
      };

      const readPosterSample = (frame, image, at) => {
        const frameStyle = getComputedStyle(frame);
        const imageStyle = getComputedStyle(image);
        const rect = image.getBoundingClientRect();
        const stageRect = image.closest('.loading-stage').getBoundingClientRect();
        const transform = imageStyle.transform;
        const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
        const clipPath = imageStyle.clipPath;
        const clip = readClipGeometry(clipPath, rect);
        const frameOpacity = Number.parseFloat(frameStyle.opacity) || 0;
        const imageOpacity = Number.parseFloat(imageStyle.opacity) || 0;
        return {
          at,
          centerX: rect.left + (rect.width / 2),
          centerY: rect.top + (rect.height / 2),
          stageCenterX: stageRect.left + (stageRect.width / 2),
          portalX: frame.dataset.portalSide === 'right'
            ? stageRect.right - Math.max(0, (stageRect.width - 520) / 2)
            : stageRect.left + Math.max(0, (stageRect.width - 520) / 2),
          stageWidth: stageRect.width,
          stageHeight: stageRect.height,
          scale: matrix ? Math.hypot(matrix.a, matrix.b) : 1,
          opacity: frameStyle.visibility === 'visible' ? frameOpacity * imageOpacity : 0,
          clipPath,
          clip,
          rect: {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          }
        };
      };

      const samplePosterContinuity = () => {
        const loading = document.querySelector('#loadingScreen');
        if (!loading) {
          if (probe.currentStable) {
            probe.stableHolds.push({ ...probe.currentStable, endedAt: performance.now() });
            probe.currentStable = null;
          }
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
        const portalSide = slit?.dataset.portalSide ?? null;
        const portalPhase = slit?.dataset.portalPhase ?? null;
        const portalKey = lightPhase ? `${lightPhase}:${portalSide}:${portalPhase}` : null;
        if (loading.classList.contains('is-exiting') && probe.exitGateAt === null) {
          probe.exitGateAt = now;
        }
        if (lightPhase) {
          if (!probe.activeLightPass || probe.activeLightPass.key !== portalKey) {
            if (probe.activeLightPass) {
              probe.activeLightPass.endedAt = now;
              probe.lightPasses.push(probe.activeLightPass);
            }
            probe.activeLightPass = {
              key: portalKey,
              phase: lightPhase,
              direction: slit.dataset.direction,
              portalSide,
              portalPhase,
              startedAt: now,
              endedAt: null,
              samples: []
            };
            if (portalKey !== probe.lastPortalKey) {
              probe.portalSequence.push({
                side: portalSide,
                phase: portalPhase,
                at: now
              });
              probe.lastPortalKey = portalKey;
            }
          }
          const bounds = slit.getBoundingClientRect();
          const opacity = (selector) => Number.parseFloat(
            getComputedStyle(loading.querySelector(selector)).opacity
          ) || 0;
          const stage = loading.querySelector('.loading-stage');
          const gateLineOpacity = Number.parseFloat(
            getComputedStyle(stage, '::before').opacity
          ) || 0;
          const gateHaloOpacity = Number.parseFloat(
            getComputedStyle(stage, '::after').opacity
          ) || 0;
          probe.activeLightPass.samples.push({
            at: now,
            centerX: bounds.left + (bounds.width / 2),
            centerY: bounds.top + (bounds.height / 2),
            parentOpacity: finalResolving ? gateLineOpacity : opacity('#loadingLightSlit'),
            coreOpacity: finalResolving ? 0 : opacity('.loading-light-core'),
            warmOpacity: finalResolving ? 0 : opacity('.loading-light-edge.is-warm'),
            coolOpacity: finalResolving ? 0 : opacity('.loading-light-edge.is-cool'),
            slitDisplay: getComputedStyle(slit).display,
            gateLineOpacity,
            gateHaloOpacity
          });
          if (finalResolving) {
            const poster = loading.querySelector('.loading-frame.is-active .loading-image');
            const target = document.querySelector('.vinyl-sticker');
            if (poster && target) {
              const frame = poster.closest('.loading-frame');
              const posterSample = readPosterSample(frame, poster, now);
              const targetRect = target.getBoundingClientRect();
              const visibleCenterX = posterSample.clip.visibleLeft
                + (posterSample.clip.visibleWidth / 2);
              const visibleCenterY = posterSample.clip.visibleTop
                + (posterSample.clip.visibleHeight / 2);
              const targetCenterX = targetRect.left + (targetRect.width / 2);
              const targetCenterY = targetRect.top + (targetRect.height / 2);
              const targetCover = document.querySelector('#vinylCoverA');
              const artworkSource = poster.currentSrc || poster.src;
              probe.handoffReadySeen ||= loading.dataset.handoffReady === 'true';
              probe.finalHandoffSamples.push({
                ...posterSample,
                centerDistance: Math.hypot(
                  visibleCenterX - targetCenterX,
                  visibleCenterY - targetCenterY
                ),
                visibleWidth: posterSample.clip.visibleWidth,
                visibleHeight: posterSample.clip.visibleHeight,
                targetWidth: targetRect.width,
                targetHeight: targetRect.height,
                targetCoverLoadingHandoff: targetCover?.dataset.loadingHandoff === 'true',
                targetCoverActive: Boolean(targetCover?.classList.contains('is-active')),
                targetCoverArtworkMatches: Boolean(
                  artworkSource && targetCover?.style.backgroundImage.includes(artworkSource)
                )
              });
            }
          }
        } else if (probe.activeLightPass) {
          probe.activeLightPass.endedAt = now;
          probe.lightPasses.push(probe.activeLightPass);
          probe.activeLightPass = null;
        }
        if (slitLit && !probe.wasSlitLit) probe.currentIgnitionAt = now;
        if (!slitLit && probe.wasSlitLit) probe.currentIgnitionAt = null;
        probe.wasSlitLit = slitLit;

        const stable = loading.querySelector('.loading-frame.is-active.is-stable');
        const stableId = stable?.dataset.loadingSlot ?? null;
        if (stableId !== probe.currentStable?.id) {
          if (probe.currentStable) {
            probe.stableHolds.push({ ...probe.currentStable, endedAt: now });
          }
          probe.currentStable = stableId ? { id: stableId, startedAt: now } : null;
        }

        if (probe.continuityArmed) {
          const effectiveOpacities = visualFrames.map((frame) => {
            const frameStyle = getComputedStyle(frame);
            const imageStyle = getComputedStyle(frame.querySelector('.loading-image'));
            const frameOpacity = Number.parseFloat(frameStyle.opacity) || 0;
            const imageOpacity = Number.parseFloat(imageStyle.opacity) || 0;
            return frameStyle.visibility === 'visible' ? frameOpacity * imageOpacity : 0;
          });
          probe.continuitySamples += 1;
          probe.maxVisualLayers = Math.max(probe.maxVisualLayers, visualFrames.length);
          const highVisibilityPosters = visualFrames.flatMap((frame, index) => (
            effectiveOpacities[index] > probe.highVisibilityPosterOpacity
              ? [{ id: frame.dataset.loadingSlot, opacity: effectiveOpacities[index] }]
              : []
          ));
          probe.maxHighVisibilityPosters = Math.max(
            probe.maxHighVisibilityPosters,
            highVisibilityPosters.length
          );
          if (highVisibilityPosters.length > 1 && probe.highVisibilityPosterViolations.length < 12) {
            probe.highVisibilityPosterViolations.push({
              at: now,
              phase: finalResolving ? 'final' : 'ordinary',
              posters: highVisibilityPosters
            });
          }
          if (finalResolving) {
            probe.finalContinuitySamples += 1;
            probe.maxFinalHighVisibilityPosters = Math.max(
              probe.maxFinalHighVisibilityPosters,
              highVisibilityPosters.length
            );
            if (
              highVisibilityPosters.length > 1
              && probe.finalHighVisibilityPosterViolations.length < 12
            ) {
              probe.finalHighVisibilityPosterViolations.push({
                at: now,
                posters: highVisibilityPosters
              });
            }
          } else {
            probe.minCompositeOpacity = Math.min(
              probe.minCompositeOpacity,
              effectiveOpacities.reduce((sum, opacity) => sum + opacity, 0)
            );
            const incoming = visualFrames.find((frame) => (
              frame.classList.contains('is-entering-from-portal')
            ));
            if (incoming && Number(incoming.dataset.transitionOrder) > 1) {
              const index = visualFrames.indexOf(incoming);
              const opacity = effectiveOpacities[index];
              const id = incoming.dataset.loadingSlot;
              const image = incoming.querySelector('.loading-image');
              const samples = probe.posterTrajectories[id] ?? [];
              samples.push(readPosterSample(incoming, image, now));
              probe.posterTrajectories[id] = samples;
              if (opacity >= 0.15 && opacity <= 0.85) {
                const sample = probe.midHandoffs[id] ?? { first: now, last: now, count: 0 };
                sample.last = now;
                sample.count += 1;
                probe.midHandoffs[id] = sample;
              }
              if (
                opacity > 0.05
                && probe.activeLightPass?.portalSide === 'left'
                && !probe.ignitionLeads.some((entry) => entry.id === id)
              ) {
                probe.ignitionLeads.push({
                  id,
                  ignitionAt: probe.activeLightPass.startedAt,
                  dominanceAt: now,
                  leadMs: now - probe.activeLightPass.startedAt
                });
              }
            }
            const outgoing = visualFrames.find((frame) => (
              frame.classList.contains('is-exiting-to-portal')
            ));
            if (outgoing) {
              const image = outgoing.querySelector('.loading-image');
              const id = outgoing.dataset.loadingSlot;
              const samples = probe.exitTrajectories[id] ?? [];
              samples.push(readPosterSample(outgoing, image, now));
              probe.exitTrajectories[id] = samples;
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
    slitHiddenAtFirstActive: window.__vinylLoadingProbe.slitHiddenAtFirstActive,
    gateHiddenAtFirstActive: window.__vinylLoadingProbe.gateHiddenAtFirstActive,
    portalOpacityAtFirstActive: window.__vinylLoadingProbe.portalOpacityAtFirstActive,
    portalCoreOpacityAtFirstActive: window.__vinylLoadingProbe.portalCoreOpacityAtFirstActive,
    gateLineOpacityAtFirstActive: window.__vinylLoadingProbe.gateLineOpacityAtFirstActive,
    gateHaloOpacityAtFirstActive: window.__vinylLoadingProbe.gateHaloOpacityAtFirstActive
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

  if (reduce) {
    expect(initialProbe.slitHiddenAtFirstActive).toBe(true);
    expect(initialProbe.gateHiddenAtFirstActive).toBe(true);
  } else {
    expect(initialProbe.gateHiddenAtFirstActive).toBe(false);
    expect(initialProbe.portalOpacityAtFirstActive).toBeGreaterThanOrEqual(0.24);
    expect(initialProbe.portalCoreOpacityAtFirstActive).toBeGreaterThanOrEqual(0.58);
    expect(initialProbe.gateLineOpacityAtFirstActive).toBeGreaterThanOrEqual(0.005);
    expect(initialProbe.gateHaloOpacityAtFirstActive).toBeGreaterThanOrEqual(0.14);
  }
  let ordinaryLightMetrics = null;
  let ordinaryCapture = null;
  let finalLightMetrics = null;
  let finalCapture = null;
  if (!reduce) {
    const lightOracle = await getLightOracleRegions(page);
    expect(lightOracle.gateIsVertical).toBe(true);
    expect(lightOracle.gateMatchesRightPortal).toBe(true);
    expect(lightOracle.shouldersAreBilateral).toBe(true);
    expect(lightOracle.regionsAreNonempty).toBe(true);
    await page.addStyleTag({ content: `
      #loadingScreen[data-light-oracle-isolated="true"] .loading-poster-stack,
      #loadingScreen[data-light-oracle-isolated="true"] #loadingParticles,
      #loadingScreen[data-light-oracle-isolated="true"] .loading-status {
        opacity: 0 !important;
      }
    ` });
    const setLightOracleIsolation = (isolated) => page.evaluate((nextIsolated) => {
      const root = document.querySelector('#loadingScreen');
      if (!root) return;
      if (nextIsolated) root.dataset.lightOracleIsolated = 'true';
      else delete root.dataset.lightOracleIsolated;
    }, isolated);
    await page.waitForFunction(() => (
      document.querySelector('[data-loading-slot="archive-01"].is-active.is-stable')
      && !document.querySelector('#loadingLightSlit')?.classList.contains('is-lit')
    ));
    await setLightOracleIsolation(true);
    const ordinaryBaseline = await captureBaseline(page, lightOracle.clip);
    await writeFile(
      testInfo.outputPath(`ordinary-baseline-${testInfo.project.name}.png`),
      ordinaryBaseline
    );
    const ordinaryPeak = await captureNaturalPeak(page, {
      clip: lightOracle.clip,
      phase: 'ordinary'
    });
    await writeFile(
      testInfo.outputPath(`ordinary-full-natural-peak-${testInfo.project.name}.jpeg`),
      ordinaryPeak.buffer
    );
    ordinaryCapture = {
      presentedAt: ordinaryPeak.presentedAt,
      presentedRange: ordinaryPeak.presentedRange,
      peakErrorMs: ordinaryPeak.peakErrorMs,
      metadata: ordinaryPeak.metadata,
      viewportState: ordinaryPeak.viewportState,
      before: ordinaryPeak.before,
      after: ordinaryPeak.after,
      candidateCount: ordinaryPeak.candidateCount,
      oracleClip: lightOracle.clip,
      oracleRegions: lightOracle.regions
    };
    ordinaryLightMetrics = await measureSemanticLightDelta(
      page,
      ordinaryBaseline,
      ordinaryPeak,
      lightOracle.clip,
      lightOracle.regions
    );
    await writeFile(
      testInfo.outputPath(`ordinary-natural-peak-${testInfo.project.name}.png`),
      Buffer.from(ordinaryLightMetrics.croppedPng, 'base64')
    );
    delete ordinaryLightMetrics.croppedPng;
    await setLightOracleIsolation(false);

    await page.waitForFunction(() => (
      window.__vinylLoadingProbe.activeIds.includes('archive-05')
    ), null, { timeout: 8_000 });
    await page.waitForFunction(() => {
      const final = document.querySelector('[data-loading-slot="archive-05"].is-active.is-stable');
      return final && !document.querySelector('#loadingScreen')?.classList.contains('is-final-resolving');
    });
    await setLightOracleIsolation(true);
    const finalBaseline = await captureBaseline(page, lightOracle.clip);
    await writeFile(
      testInfo.outputPath(`final-baseline-${testInfo.project.name}.png`),
      finalBaseline
    );
    const finalPeak = await captureNaturalPeak(page, {
      clip: lightOracle.clip,
      phase: 'final'
    });
    await writeFile(
      testInfo.outputPath(`final-full-natural-peak-${testInfo.project.name}.jpeg`),
      finalPeak.buffer
    );
    finalCapture = {
      presentedAt: finalPeak.presentedAt,
      presentedRange: finalPeak.presentedRange,
      peakErrorMs: finalPeak.peakErrorMs,
      metadata: finalPeak.metadata,
      viewportState: finalPeak.viewportState,
      before: finalPeak.before,
      after: finalPeak.after,
      candidateCount: finalPeak.candidateCount,
      oracleClip: lightOracle.clip,
      oracleRegions: lightOracle.regions
    };
    finalLightMetrics = await measureSemanticLightDelta(
      page,
      finalBaseline,
      finalPeak,
      lightOracle.clip,
      lightOracle.regions
    );
    await writeFile(
      testInfo.outputPath(`final-natural-peak-${testInfo.project.name}.png`),
      Buffer.from(finalLightMetrics.croppedPng, 'base64')
    );
    delete finalLightMetrics.croppedPng;
    await setLightOracleIsolation(false);

    for (const capture of [ordinaryCapture, finalCapture]) {
      expect(capture.before.direction).toBe('vertical');
      expect(capture.before.playState).toBe('running');
      expect(capture.before.playbackRate).toBe(1);
      expect(capture.before.pausedAnimations).toBe(0);
      expect(capture.after.playState).toBe('running');
      expect(capture.after.playbackRate).toBe(1);
      expect(capture.after.pausedAnimations).toBe(0);
      expect(Math.abs(capture.peakErrorMs)).toBeLessThanOrEqual(PRESENTED_FRAME_TOLERANCE_MS);
      expect(capture.presentedRange.start).toBeLessThan(capture.before.naturalPeakAt);
      expect(capture.presentedRange.end).toBeGreaterThan(capture.before.naturalPeakAt);
      expect(capture.metadata.deviceWidth).toBe(capture.viewportState.innerWidth);
      expect(capture.metadata.deviceHeight).toBe(capture.viewportState.innerHeight);
      expect(capture.viewportState.scrollX).toBe(0);
      expect(capture.viewportState.scrollY).toBe(0);
      expect(capture.viewportState.visualOffsetLeft).toBe(0);
      expect(capture.viewportState.visualOffsetTop).toBe(0);
      expect(capture.viewportState.visualScale).toBe(1);
    }
    expect(ordinaryCapture.before.portalSide).toBe('right');
    expect(ordinaryCapture.before.portalPhase).toBe('exit');
    expect(finalCapture.before.portalSide).toBe('center');
    expect(finalCapture.before.portalPhase).toBe('final-handoff');
    expect(ordinaryCapture.before.animationName).toBe('loading-right-portal-pulse');
    expect(finalCapture.before.animationName).toBe('loading-final-ambient-converge');
    expect(ordinaryCapture.before.gateLineAnimationName).toBe('loading-right-portal-rail-pulse');
    expect(finalCapture.before.gateLineAnimationName).toBe('loading-final-ambient-converge');
    expect(ordinaryCapture.before.gateLineHeight / ordinaryCapture.before.gateLineWidth)
      .toBeGreaterThanOrEqual(30);
    expect(Math.abs(
      ordinaryCapture.before.gateLineDuration - ordinaryCapture.before.duration
    )).toBeLessThanOrEqual(1);
    expect(ordinaryCapture.before.gateLineFilter).toBe('blur(0.35px)');
    const finalAmbientAspect = Math.min(
      finalCapture.before.gateLineWidth,
      finalCapture.before.gateLineHeight
    ) / Math.max(
      finalCapture.before.gateLineWidth,
      finalCapture.before.gateLineHeight
    );
    expect(finalAmbientAspect).toBeGreaterThanOrEqual(0.42);
    expect(Math.abs(
      finalCapture.before.gateLineDuration - finalCapture.before.duration
    )).toBeLessThanOrEqual(1);
    expect(finalCapture.before.gateLineFilter).toBe('blur(22px)');
    for (const state of [finalCapture.before, finalCapture.after]) {
      expect(state.slitDisplay).toBe('none');
      expect(state.slitOpacity).toBe(0);
      expect(state.parentOpacity).toBeLessThanOrEqual(0.30);
      expect(state.coreOpacity).toBe(0);
      expect(state.warmOpacity).toBe(0);
      expect(state.coolOpacity).toBe(0);
    }
  }
  await expect(loading).toHaveCount(0, { timeout: 10_000 });
  const effectEnd = await page.evaluate(() => performance.now());
  if (!reduce) {
    console.log('PORTAL_ORACLE_DEBUG', testInfo.project.name, JSON.stringify({
      capture: ordinaryCapture,
      metrics: ordinaryLightMetrics
    }));
    for (const [phase, { capture, metrics }] of Object.entries({
      ordinary: { capture: ordinaryCapture, metrics: ordinaryLightMetrics }
    })) {
      const lightLimits = capture.viewportState.innerWidth < 768
        ? COMPACT_SEMANTIC_LIGHT_LIMITS
        : SEMANTIC_LIGHT_LIMITS;
      expect(metrics.frameMapping.croppedWidth).toBe(capture.oracleClip.width);
      expect(metrics.frameMapping.croppedHeight).toBe(capture.oracleClip.height);
      expect(metrics.frameMapping.regions).toEqual(capture.oracleRegions);
      expect(metrics.gate.netMean).toBeGreaterThanOrEqual(lightLimits.gateNetMeanMin);
      expect(metrics.gate.litRatio).toBeGreaterThanOrEqual(lightLimits.gateLitRatioMin);
      expect(metrics.gateProminence).toBeGreaterThanOrEqual(lightLimits.gateProminenceMin);
      expect(metrics.gate.p90).toBeLessThanOrEqual(lightLimits.gateP90Max);
      for (const shoulder of [metrics.leftShoulder, metrics.rightShoulder]) {
        expect(shoulder.netMean).toBeGreaterThanOrEqual(lightLimits.shoulderNetMeanMin);
        expect(shoulder.litRatio).toBeGreaterThanOrEqual(lightLimits.shoulderLitRatioMin);
        expect(shoulder.p90).toBeLessThanOrEqual(lightLimits.shoulderP90Max);
      }
      expect(metrics.shoulderBalance).toBeGreaterThanOrEqual(
        lightLimits.shoulderBalanceMin
      );
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
    decodedNodeCount: window.__vinylLoadingProbe.decodedNodeCount,
    decodedNodeUniqueCount: window.__vinylLoadingProbe.decodedNodeUniqueCount,
    decodedAssetIds: window.__vinylLoadingProbe.decodedAssetIds,
    continuitySamples: window.__vinylLoadingProbe.continuitySamples,
    maxVisualLayers: window.__vinylLoadingProbe.maxVisualLayers,
    highVisibilityPosterOpacity: window.__vinylLoadingProbe.highVisibilityPosterOpacity,
    maxHighVisibilityPosters: window.__vinylLoadingProbe.maxHighVisibilityPosters,
    highVisibilityPosterViolations: window.__vinylLoadingProbe.highVisibilityPosterViolations,
    finalContinuitySamples: window.__vinylLoadingProbe.finalContinuitySamples,
    maxFinalHighVisibilityPosters: window.__vinylLoadingProbe.maxFinalHighVisibilityPosters,
    finalHighVisibilityPosterViolations: window.__vinylLoadingProbe.finalHighVisibilityPosterViolations,
    minCompositeOpacity: window.__vinylLoadingProbe.minCompositeOpacity,
    midHandoffs: window.__vinylLoadingProbe.midHandoffs,
    ignitionLeads: window.__vinylLoadingProbe.ignitionLeads,
    posterTrajectories: window.__vinylLoadingProbe.posterTrajectories,
    exitTrajectories: window.__vinylLoadingProbe.exitTrajectories,
    portalSequence: window.__vinylLoadingProbe.portalSequence,
    stableHolds: window.__vinylLoadingProbe.stableHolds,
    gatheredPixels: window.__vinylLoadingProbe.gatheredPixels,
    scatterHandoffs: window.__vinylLoadingProbe.scatterHandoffs,
    clearedPixelCounts: window.__vinylLoadingProbe.clearedPixelCounts,
    lightPasses: window.__vinylLoadingProbe.lightPasses,
    finalHandoffSamples: window.__vinylLoadingProbe.finalHandoffSamples,
    handoffReadySeen: window.__vinylLoadingProbe.handoffReadySeen,
    exitGateAt: window.__vinylLoadingProbe.exitGateAt
  }));
  expect(finalProbe.maxActive).toBe(1);
  expect(finalProbe.decodedNodeCount).toBe(5);
  expect(finalProbe.decodedNodeUniqueCount).toBe(5);
  expect(finalProbe.decodedAssetIds).toEqual(EXPECTED_ARCHIVE_IDS);
  expect(finalProbe.highVisibilityPosterOpacity).toBe(HIGH_VISIBILITY_POSTER_OPACITY);
  expect(finalProbe.maxHighVisibilityPosters).toBeLessThanOrEqual(1);
  expect(finalProbe.highVisibilityPosterViolations).toEqual([]);
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
    expect(finalProbe.maxVisualLayers).toBeLessThanOrEqual(1);
    expect(finalProbe.portalSequence.map(({ side, phase }) => [side, phase])).toEqual([
      ['left', 'enter'],
      ['right', 'exit'],
      ['left', 'enter'],
      ['right', 'exit'],
      ['left', 'enter'],
      ['right', 'exit'],
      ['left', 'enter'],
      ['right', 'exit'],
      ['left', 'enter'],
      ['center', 'final-handoff']
    ]);
    const nonfinalStableHolds = finalProbe.stableHolds.filter(({ id }) => id !== 'archive-05');
    expect(nonfinalStableHolds).toHaveLength(4);
    for (const hold of nonfinalStableHolds) {
      expect(hold.endedAt - hold.startedAt, `${hold.id} centered hold`).toBeGreaterThanOrEqual(360);
    }
    const midHandoffs = Object.values(finalProbe.midHandoffs);
    expect(midHandoffs).toHaveLength(4);
    for (const sample of midHandoffs) {
      expect(sample.count).toBeGreaterThanOrEqual(2);
      expect(sample.last - sample.first).toBeGreaterThanOrEqual(12);
      expect(sample.last - sample.first).toBeLessThanOrEqual(110);
    }
    expect(finalProbe.ignitionLeads).toHaveLength(4);
    expect(finalProbe.ignitionLeads.every(({ leadMs }) => leadMs > 0)).toBe(true);
    const posterTrajectories = Object.entries(finalProbe.posterTrajectories);
    expect(posterTrajectories).toHaveLength(4);
    for (const [id, samples] of posterTrajectories) {
      expect(samples.length, `${id} trajectory samples`).toBeGreaterThanOrEqual(4);
      const firstVisible = samples.find(({ opacity }) => opacity >= 0.05);
      expect(firstVisible, `${id} becomes visible at the left portal`).toBeTruthy();
      expect(
        firstVisible.stageCenterX - firstVisible.centerX,
        `${id} first appears left of center`
      ).toBeGreaterThan(firstVisible.stageWidth * 0.08);
      expect(firstVisible.scale, `${id} starts slightly compressed by the portal`).toBeLessThanOrEqual(0.95);
      expect(firstVisible.clipPath).toBe('none');

      const crossing = samples.find((sample) => (
        sample.at >= firstVisible.at
        && sample.centerX >= sample.stageCenterX - 1
        && sample.opacity >= 0.85
      ));
      expect(crossing, `${id} settles at center at high visibility`).toBeTruthy();
      expect(crossing.scale, `${id} restores full scale near center`).toBeGreaterThanOrEqual(0.97);
      expect(crossing.at - firstVisible.at, `${id} portal traversal stays fast`)
        .toBeLessThanOrEqual(260);
      const approach = samples.filter(({ at }) => at >= firstVisible.at && at <= crossing.at);
      const centerDeltas = approach.slice(1).map((sample, index) => (
        sample.centerX - approach[index].centerX
      ));
      expect(centerDeltas.every((delta) => delta >= -1), `${id} moves from left to center`).toBe(true);
    }
    const exitTrajectories = Object.entries(finalProbe.exitTrajectories);
    expect(exitTrajectories).toHaveLength(4);
    for (const [id, samples] of exitTrajectories) {
      expect(samples.length, `${id} exit trajectory samples`).toBeGreaterThanOrEqual(3);
      const visible = samples.filter(({ opacity }) => opacity >= 0.08);
      expect(visible.length, `${id} remains visible while leaving`).toBeGreaterThanOrEqual(2);
      expect(
        visible.at(-1).centerX - visible[0].centerX,
        `${id} exits toward the right portal`
      ).toBeGreaterThan(visible[0].stageWidth * 0.08);
    }
    const ordinaryPass = finalProbe.lightPasses.find((pass) => (
      pass.phase === 'ordinary'
      && pass.startedAt <= ordinaryCapture.before.naturalPeakAt
      && pass.endedAt >= ordinaryCapture.before.naturalPeakAt
    ));
    const finalPass = finalProbe.lightPasses.find((pass) => pass.phase === 'final');
    expect(ordinaryPass).toBeTruthy();
    expect(finalPass).toBeTruthy();
    expect(ordinaryPass.samples.length).toBeGreaterThanOrEqual(8);
    expect(finalPass.samples.length).toBeGreaterThanOrEqual(8);
    expect(finalPass.startedAt).toBeLessThan(finalProbe.exitGateAt);
    expect(finalCapture.before.naturalPeakAt).toBeLessThan(finalProbe.exitGateAt);
    expect(finalCapture.presentedAt).toBeLessThan(finalProbe.exitGateAt);
    const naturalPeak = (pass) => pass.samples.reduce((peak, sample) => (
      sample.parentOpacity > peak.parentOpacity ? sample : peak
    ));
    const ordinaryNaturalPeak = naturalPeak(ordinaryPass);
    const finalNaturalPeak = naturalPeak(finalPass);
    expect(ordinaryNaturalPeak.at).toBeGreaterThanOrEqual(ordinaryPass.startedAt);
    expect(ordinaryNaturalPeak.parentOpacity).toBeGreaterThanOrEqual(0.60);
    expect(finalNaturalPeak.parentOpacity).toBeGreaterThanOrEqual(0.20);
    expect(finalNaturalPeak.at).toBeLessThan(finalProbe.exitGateAt);
    expect(finalNaturalPeak.coreOpacity).toBeLessThanOrEqual(0.52);
    expect(finalNaturalPeak.warmOpacity).toBeLessThanOrEqual(0.22);
    expect(finalNaturalPeak.coolOpacity).toBeLessThanOrEqual(0.20);
    expect(finalProbe.handoffReadySeen).toBe(true);
    expect(finalProbe.finalContinuitySamples).toBeGreaterThanOrEqual(8);
    expect(finalProbe.maxFinalHighVisibilityPosters).toBe(1);
    expect(finalProbe.finalHighVisibilityPosterViolations).toEqual([]);
    expect(finalProbe.finalHandoffSamples.length).toBeGreaterThanOrEqual(8);
    const circularHandoffs = finalProbe.finalHandoffSamples.filter((sample) => (
      sample.clip.roundPercent >= 49
      && sample.opacity >= 0.75
      && sample.targetCoverLoadingHandoff
      && sample.targetCoverActive
      && sample.targetCoverArtworkMatches
    ));
    expect(circularHandoffs.length).toBeGreaterThanOrEqual(2);
    const alignedHandoff = circularHandoffs.reduce((nearest, sample) => (
      sample.centerDistance < nearest.centerDistance ? sample : nearest
    ));
    expect(alignedHandoff.centerDistance).toBeLessThanOrEqual(4);
    expect(Math.abs(alignedHandoff.visibleWidth - alignedHandoff.targetWidth)).toBeLessThanOrEqual(2);
    expect(Math.abs(alignedHandoff.visibleHeight - alignedHandoff.targetHeight)).toBeLessThanOrEqual(2);
    expect(alignedHandoff.scale).toBeLessThan(1);
    expect(alignedHandoff.clipPath).toMatch(/inset\(.+round 50%\)/);
    for (const [phase, capture, pass] of [
      ['ordinary', ordinaryCapture, ordinaryPass],
      ['final', finalCapture, finalPass]
    ]) {
      const presentedSample = pass.samples.reduce((nearest, sample) => (
        Math.abs(sample.at - capture.presentedAt) < Math.abs(nearest.at - capture.presentedAt)
          ? sample
          : nearest
      ));
      capture.presentedSample = presentedSample;
      expect(Math.abs(presentedSample.at - capture.presentedAt))
        .toBeLessThanOrEqual(PRESENTED_FRAME_TOLERANCE_MS);
      const compactOrdinary = phase === 'ordinary' && capture.viewportState.innerWidth < 768;
      expect(presentedSample.parentOpacity).toBeGreaterThanOrEqual(
        compactOrdinary ? 0.48 : PARENT_PEAK_LOWER_BOUNDS[phase]
      );
      expect(presentedSample.parentOpacity).toBeLessThanOrEqual(
        compactOrdinary ? 0.84 : PARENT_PEAK_UPPER_BOUNDS[phase]
      );
    }
    for (const pass of [ordinaryPass, finalPass]) {
      const deltas = pass.samples.slice(1).map((sample, index) => (
        sample.centerY - pass.samples[index].centerY
      ));
      expect(deltas.every((delta) => delta >= -0.5)).toBe(true);
    }
    const ordinaryGateLinePeak = Math.max(...ordinaryPass.samples.map(
      ({ gateLineOpacity }) => gateLineOpacity
    ));
    const ordinaryGateHaloPeak = Math.max(...ordinaryPass.samples.map(
      ({ gateHaloOpacity }) => gateHaloOpacity
    ));
    const visibleOrdinaryGateSamples = ordinaryPass.samples.filter(
      ({ gateLineOpacity }) => gateLineOpacity > 0.05
    );
    expect(ordinaryGateLinePeak).toBeGreaterThanOrEqual(0.55);
    expect(ordinaryGateHaloPeak).toBeGreaterThanOrEqual(0.16);
    expect(visibleOrdinaryGateSamples.length).toBeGreaterThan(0);
    const visibleGateRatioMax = ordinaryCapture.viewportState.innerWidth < 768 ? 0.70 : 0.55;
    expect(visibleOrdinaryGateSamples.length / ordinaryPass.samples.length)
      .toBeLessThanOrEqual(visibleGateRatioMax);

    const finalAmbientPeak = Math.max(...finalPass.samples.map(
      ({ gateLineOpacity }) => gateLineOpacity
    ));
    const finalRefractionPeak = Math.max(...finalPass.samples.map(
      ({ gateHaloOpacity }) => gateHaloOpacity
    ));
    expect(finalAmbientPeak).toBeGreaterThanOrEqual(0.22);
    expect(finalAmbientPeak).toBeLessThanOrEqual(0.30);
    expect(finalRefractionPeak).toBeGreaterThanOrEqual(0.16);
    expect(finalRefractionPeak).toBeLessThanOrEqual(0.22);
    expect(finalPass.samples.every(({ slitDisplay }) => slitDisplay === 'none')).toBe(true);
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
  expectExactCoverRequests(stats, !reduce);

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

test('failed cover loading clears particles and retry restarts from an empty Canvas', async ({ page }, testInfo) => {
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
  expectExactCoverRequests(
    routeControl.stats.retry,
    testInfo.project.name !== 'mobile-reduce'
  );
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
  expectExactCoverRequests(stats, testInfo.project.name !== 'mobile-reduce');
});
