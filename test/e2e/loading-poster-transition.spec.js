import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const FIXTURE_DELAY_STEP_MS = 80;
const PORTAL_DURATION_MS = 760;
const PORTAL_THICKNESS_MIN = 112;
const PORTAL_THICKNESS_MAX = 168;
const PORTAL_ASPECT_DIVISOR = 4.4;
const PORTAL_HALO_HEIGHT_RATIO = 1.85;
const AMBIENT_POSTER_DRIFT_MAX = 9;
const FINAL_HANDOFF_DURATION_MS = Object.freeze({ full: 1280, compact: 920 });
const PORTAL_POSTER_LEAD_RANGE_MS = Object.freeze({ minimum: 190, maximum: 280 });
const LOADING_SETTLE_TIMEOUT_MS = 60_000;
const POSTER_TRAVERSAL_LIMIT_MS = 540;
const LIGHT_PEAK_OFFSETS = Object.freeze({ ordinary: 0.40, final: 0.30 });
const HIGH_VISIBILITY_POSTER_OPACITY = 0.35;
// One 60Hz presentation interval plus 3.4ms for timestamp and rAF sampling quantization.
const PRESENTED_FRAME_TOLERANCE_MS = 20;
const PARENT_PEAK_LOWER_BOUNDS = Object.freeze({ ordinary: 0.82, final: 0.10 });
const PARENT_PEAK_UPPER_BOUNDS = Object.freeze({ ordinary: 1, final: 0.16 });

const SEMANTIC_LIGHT_LIMITS = Object.freeze({
  gateNetMeanMin: 4,
  gateLitRatioMin: 0.66,
  gateProminenceMin: 1.2,
  gateP90Max: 220,
  inwardShoulderNetMeanMin: 0.5,
  inwardShoulderDominanceMin: 1.25,
  outwardShoulderP90Max: 96
});
const EXPECTED_ARCHIVE_IDS = Object.freeze([
  'archive-01',
  'archive-02',
  'archive-03',
  'archive-04',
  'archive-05',
  'archive-06',
  'archive-07',
  'archive-08',
  'archive-09',
  'archive-10'
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
  CRITICAL_IMAGE_MANIFEST.find(({ id }) => id === 'archive-10').source
).pathname;
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

const installOutOfOrderCovers = async (page) => {
  const completionOrder = [];
  const delayedPathname = new URL(
    CRITICAL_IMAGE_MANIFEST.find(({ id }) => id === 'archive-09').source
  ).pathname;

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'image') {
      await route.continue();
      return;
    }

    const pathname = new URL(request.url()).pathname;
    if (!COVER_FIXTURES.has(pathname)) {
      await route.abort('blockedbyclient');
      return;
    }

    await new Promise((resolve) => setTimeout(
      resolve,
      pathname === delayedPathname ? 500 : 5
    ));
    await route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: DETERMINISTIC_COVER
    });
    completionOrder.push(pathname);
  });

  return completionOrder;
};

const installDelayedFinalCover = async (page) => {
  let releaseFinalRequest;
  const finalGate = new Promise((resolve) => {
    releaseFinalRequest = resolve;
  });
  let released = false;
  const stats = {
    active: 0,
    total: 0,
    pathnames: []
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
    if (!COVER_FIXTURES.has(pathname)) {
      stats.active -= 1;
      await route.abort('blockedbyclient');
      return;
    }

    try {
      if (pathname === FINAL_COVER_PATHNAME) await finalGate;
      else await new Promise((resolve) => setTimeout(resolve, 5));
      await route.fulfill({
        status: 200,
        contentType: 'image/svg+xml',
        body: DETERMINISTIC_COVER
      });
    } finally {
      stats.active -= 1;
    }
  });

  return {
    stats,
    releaseFinal() {
      if (released) return;
      released = true;
      releaseFinalRequest();
    }
  };
};

const installSkipHandoffContinuityProbe = (page) => page.addInitScript(() => {
  const probe = window.__vinylSkipHandoffProbe = {
    samples: [],
    skipAt: null,
    skippedId: null,
    skipSnapshot: null,
    finalNaturalWidth: null,
    finalNaturalHeight: null,
    settledFrames: 0
  };

  const number = (value, fallback = 0) => {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const animationState = (element, name) => {
    const animation = element?.getAnimations?.().find(
      ({ animationName }) => animationName === name
    );
    const timing = animation?.effect?.getComputedTiming?.();
    return animation ? {
      progress: Number.isFinite(timing?.progress) ? Number(timing.progress) : null,
      playState: animation.playState,
      startTime: Number.isFinite(animation.startTime) ? Number(animation.startTime) : null
    } : null;
  };
  const rect = (element) => {
    if (!element) return null;
    const bounds = element.getBoundingClientRect();
    return {
      left: bounds.left,
      top: bounds.top,
      width: bounds.width,
      height: bounds.height,
      centerX: bounds.left + (bounds.width / 2),
      centerY: bounds.top + (bounds.height / 2)
    };
  };
  const expandInset = (tokens) => {
    if (tokens.length === 1) return [tokens[0], tokens[0], tokens[0], tokens[0]];
    if (tokens.length === 2) return [tokens[0], tokens[1], tokens[0], tokens[1]];
    if (tokens.length === 3) return [tokens[0], tokens[1], tokens[2], tokens[1]];
    return tokens.slice(0, 4);
  };
  const elementScale = (element, style = element ? getComputedStyle(element) : null) => {
    const independentScale = number(style?.scale, Number.NaN);
    if (Number.isFinite(independentScale)) return independentScale;
    if (!style?.transform || style.transform === 'none') return 1;
    const matrix = new DOMMatrixReadOnly(style.transform);
    return Math.hypot(matrix.a, matrix.b);
  };
  const clipGeometry = (clipPath, bounds, scale = 1) => {
    if (!bounds || !clipPath?.startsWith('inset(')) return null;
    const content = clipPath.slice('inset('.length, -1);
    const [insetSource, roundSource = '0'] = content.split(/\s+round\s+/);
    const [topToken, rightToken, bottomToken, leftToken] = expandInset(
      insetSource.trim().split(/\s+/)
    );
    const pixels = (token, size) => token.endsWith('%')
      ? (number(token) / 100) * size
      : number(token) * scale;
    const top = pixels(topToken, bounds.height);
    const right = pixels(rightToken, bounds.width);
    const bottom = pixels(bottomToken, bounds.height);
    const left = pixels(leftToken, bounds.width);
    const width = Math.max(0, bounds.width - left - right);
    const height = Math.max(0, bounds.height - top - bottom);
    const radiusToken = roundSource.trim().split(/[\s/]+/)[0];
    const radius = radiusToken.endsWith('%')
      ? (number(radiusToken) / 100) * Math.min(width, height)
      : number(radiusToken) * scale;
    return {
      left: bounds.left + left,
      top: bounds.top + top,
      width,
      height,
      centerX: bounds.left + left + (width / 2),
      centerY: bounds.top + top + (height / 2),
      radius
    };
  };
  const naturalCropForVisibleClip = (bounds, clip, naturalWidth, naturalHeight) => {
    if (!bounds || !clip || !naturalWidth || !naturalHeight) return null;
    const containScale = Math.min(bounds.width / naturalWidth, bounds.height / naturalHeight);
    const contentWidth = naturalWidth * containScale;
    const contentHeight = naturalHeight * containScale;
    const contentLeft = bounds.left + ((bounds.width - contentWidth) / 2);
    const contentTop = bounds.top + ((bounds.height - contentHeight) / 2);
    return {
      left: (clip.left - contentLeft) / contentWidth,
      top: (clip.top - contentTop) / contentHeight,
      width: clip.width / contentWidth,
      height: clip.height / contentHeight
    };
  };
  const naturalCropForCover = (naturalWidth, naturalHeight, bounds) => {
    if (!bounds || !naturalWidth || !naturalHeight) return null;
    const coverScale = Math.max(bounds.width / naturalWidth, bounds.height / naturalHeight);
    const contentWidth = naturalWidth * coverScale;
    const contentHeight = naturalHeight * coverScale;
    return {
      left: ((contentWidth - bounds.width) / 2) / contentWidth,
      top: ((contentHeight - bounds.height) / 2) / contentHeight,
      width: bounds.width / contentWidth,
      height: bounds.height / contentHeight
    };
  };

  document.addEventListener('click', (event) => {
    if (!event.target?.closest?.('#loadingSkip')) return;
    const active = document.querySelector('.loading-frame.is-active');
    const image = active?.querySelector('.loading-image');
    const imageStyle = image ? getComputedStyle(image) : null;
    probe.skipAt = performance.now();
    probe.skippedId = active?.dataset.loadingSlot ?? null;
    probe.skipSnapshot = {
      at: probe.skipAt,
      activeId: probe.skippedId,
      activeCenterY: rect(image)?.centerY ?? null,
      activeScale: image ? elementScale(image, imageStyle) : null,
      activeOpacity: image ? number(imageStyle.opacity) : 0,
      glide: animationState(image, 'loading-poster-glide-in')
    };
  }, true);

  const sample = () => {
    const at = performance.now();
    const root = document.querySelector('#loadingScreen');
    const active = document.querySelector('.loading-frame.is-active, .loading-frame.is-outgoing');
    const activeImage = active?.querySelector('.loading-image');
    const source = document.querySelector('.loading-image[data-loading-handoff="true"]');
    const target = document.querySelector('.vinyl-sticker');
    const targetCover = document.querySelector('#vinylCoverA');
    const appShell = document.querySelector('#appShell');
    const activeRect = rect(activeImage);
    const stageRect = rect(document.querySelector('.loading-stage'));
    const activeStyle = activeImage ? getComputedStyle(activeImage) : null;
    const sourceStyle = source ? getComputedStyle(source) : null;
    const sourceRect = rect(source);
    const targetRect = rect(target);
    const sourceScale = source ? elementScale(source, sourceStyle) : 1;
    const clip = source ? clipGeometry(sourceStyle.clipPath, sourceRect, sourceScale) : null;
    const naturalWidth = source?.naturalWidth || probe.finalNaturalWidth;
    const naturalHeight = source?.naturalHeight || probe.finalNaturalHeight;
    if (source?.naturalWidth && source?.naturalHeight) {
      probe.finalNaturalWidth = source.naturalWidth;
      probe.finalNaturalHeight = source.naturalHeight;
    }
    const frameOpacity = active ? number(getComputedStyle(active).opacity) : 0;
    const rootOpacity = root ? number(getComputedStyle(root).opacity) : 0;
    const sourceOpacity = source ? frameOpacity * number(sourceStyle.opacity) * rootOpacity : 0;
    const coverOpacity = targetCover ? number(getComputedStyle(targetCover).opacity) : 0;
    const shellOpacity = appShell ? number(getComputedStyle(appShell).opacity) : 0;
    const targetOpacity = coverOpacity * shellOpacity;
    const motion = animationState(source, 'loading-poster-to-player-motion');
    const glide = animationState(activeImage, 'loading-poster-glide-in');

    probe.samples.push({
      at,
      rootConnected: Boolean(root),
      rootState: root?.dataset.state ?? null,
      handoffPhase: root?.dataset.handoffPhase ?? null,
      activeId: active?.dataset.loadingSlot ?? null,
      activeClassName: active?.className ?? null,
      activeStable: Boolean(active?.classList.contains('is-stable')),
      activeCount: document.querySelectorAll('.loading-frame.is-active').length,
      activeCenterY: activeRect?.centerY ?? null,
      stageCenterY: stageRect?.centerY ?? null,
      activeScale: activeImage ? elementScale(activeImage, activeStyle) : null,
      activeOpacity: activeImage ? frameOpacity * number(activeStyle.opacity) : 0,
      glide,
      motion,
      sourceVisible: sourceOpacity > 0.05,
      sourceOpacity,
      targetVisible: targetOpacity > 0.05,
      targetOpacity,
      overlap: sourceOpacity > 0.05 && targetOpacity > 0.05,
      sourceArtwork: source?.currentSrc || source?.src || null,
      targetArtwork: targetCover?.style.backgroundImage || null,
      sourceClip: clip,
      sourceCrop: naturalCropForVisibleClip(
        sourceRect,
        clip,
        source?.naturalWidth || probe.finalNaturalWidth,
        source?.naturalHeight || probe.finalNaturalHeight
      ),
      targetCrop: naturalCropForCover(naturalWidth, naturalHeight, targetRect),
      targetRect,
      targetActive: Boolean(targetCover?.classList.contains('is-active')),
      targetBackgroundPosition: targetCover ? getComputedStyle(targetCover).backgroundPosition : null,
      targetBackgroundSize: targetCover ? getComputedStyle(targetCover).backgroundSize : null
    });
    if (probe.samples.length > 1800) probe.samples.shift();

    if (!root && targetOpacity > 0.98) probe.settledFrames += 1;
    if (probe.settledFrames < 4) requestAnimationFrame(sample);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(sample), { once: true });
  } else {
    requestAnimationFrame(sample);
  }
});

const installActivePosterSequenceProbe = (page) => page.addInitScript(() => {
  window.__vinylActivePosterSequence = [];
  const recordActivePoster = (slot) => {
    if (!slot?.matches?.('.loading-frame.is-active')) return;
    const id = slot.dataset.loadingSlot;
    const sequence = window.__vinylActivePosterSequence;
    if (id && sequence.at(-1) !== id) sequence.push(id);
  };
  const observer = new MutationObserver((records) => {
    records.forEach(({ target }) => recordActivePoster(target));
  });
  observer.observe(document, {
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });
});

const expectExactCoverRequests = (stats, { expectFinalPrewarm = false } = {}) => {
  const expectedPathnames = [...EXPECTED_COVER_PATHNAMES].sort();
  const finalRequestCount = stats.pathnames.filter(
    (pathname) => pathname === FINAL_COVER_PATHNAME
  ).length;
  const normalizedPathnames = [...stats.pathnames];
  if (expectFinalPrewarm && finalRequestCount === 2) {
    normalizedPathnames.splice(normalizedPathnames.lastIndexOf(FINAL_COVER_PATHNAME), 1);
  }
  expect(stats.active).toBe(0);
  expect(expectFinalPrewarm ? [1, 2] : [1]).toContain(finalRequestCount);
  expect(expectFinalPrewarm
    ? [expectedPathnames.length, expectedPathnames.length + 1]
    : [expectedPathnames.length]).toContain(stats.total);
  expect(normalizedPathnames.sort()).toEqual(expectedPathnames);
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
  const overheadStart = performance.now();
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
  const inwardShoulder = withNetMean(regions.inwardShoulder);
  const outwardShoulder = withNetMean(regions.outwardShoulder);
  const rowMeans = Array.from({ length: canvas.height }, (_, y) => {
    let total = 0;
    for (let x = 0; x < canvas.width; x += 1) {
      const index = ((y * canvas.width) + x) * 4;
      const beforeLuma = (beforePixels[index] * 0.2126)
        + (beforePixels[index + 1] * 0.7152)
        + (beforePixels[index + 2] * 0.0722);
      const afterLuma = (afterPixels[index] * 0.2126)
        + (afterPixels[index + 1] * 0.7152)
        + (afterPixels[index + 2] * 0.0722);
      total += Math.max(0, afterLuma - beforeLuma);
    }
    return total / canvas.width;
  });
  const brightestRow = rowMeans.reduce((brightest, mean, y) => (
    mean > brightest.mean ? { y: y + clip.y, mean } : brightest
  ), { y: clip.y, mean: rowMeans[0] });
  const metrics = {
    background,
    visibleFloor,
    gate,
    gateContext,
    gateProminence: gate.netMean / Math.max(0.01, gateContext.netMean),
    inwardShoulder,
    outwardShoulder,
    inwardShoulderDominance: inwardShoulder.netMean / Math.max(0.01, outwardShoulder.netMean),
    brightestRow,
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
  window.__vinylProbeOverhead.push({
    start: overheadStart,
    end: performance.now(),
    blocking: true
  });
  return metrics;
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

const getLightOracleRegions = (page, portalSide) => page.evaluate(({
  expectedPortalSide,
  thicknessMinimum,
  thicknessMaximum,
  aspectDivisor,
  haloHeightRatio
}) => {
  const stageNode = document.querySelector('.loading-stage');
  const rootNode = document.querySelector('#loadingScreen');
  const image = document.querySelector('[data-loading-slot="archive-01"] .loading-image');
  if (!stageNode || !rootNode || !image) throw new Error('Loading portal oracle is not ready');
  const frame = image.closest('.loading-frame');
  if (!frame) throw new Error('Loading poster frame is not ready');
  const root = rootNode.getBoundingClientRect();
  const stageRect = stageNode.getBoundingClientRect();
  const frameStyle = getComputedStyle(frame);
  const frameWidth = Number.parseFloat(frameStyle.width);
  const frameHeight = Number.parseFloat(frameStyle.height);
  if (!(frameWidth > 0) || !(frameHeight > 0)) {
    throw new Error('Loading poster layout box is not measurable');
  }
  const frameLeft = stageRect.left + ((stageRect.width - frameWidth) / 2);
  const frameTop = stageRect.top + ((stageRect.height - frameHeight) / 2);
  const frameRect = {
    left: frameLeft,
    top: frameTop,
    right: frameLeft + frameWidth,
    bottom: frameTop + frameHeight,
    width: frameWidth,
    height: frameHeight
  };
  const containRatio = Math.min(
    frameRect.width / image.naturalWidth,
    frameRect.height / image.naturalHeight
  );
  const artworkWidth = image.naturalWidth * containRatio;
  const artworkHeight = image.naturalHeight * containRatio;
  const artworkInsetX = Math.max(0, (frameRect.width - artworkWidth) / 2);
  const artworkInsetY = Math.max(0, (frameRect.height - artworkHeight) / 2);
  const artworkLeft = frameRect.left + artworkInsetX;
  const artworkTop = frameRect.top + ((frameRect.height - artworkHeight) / 2);
  const artworkBottom = frameRect.bottom - artworkInsetY;
  const desiredGap = Math.max(20, Math.min(38, artworkHeight * 0.055));
  const portalY = expectedPortalSide === 'bottom'
    ? Math.min(root.bottom - 12, artworkBottom + desiredGap)
    : Math.max(root.top + 12, artworkTop - desiredGap);
  const portalGap = expectedPortalSide === 'bottom'
    ? portalY - artworkBottom
    : artworkTop - portalY;
  const availableWidth = Math.max(1, root.width - 24);
  const portalWidth = Math.max(1, Math.min(artworkWidth * 1.08, availableWidth));
  const portalHeight = Math.max(
    thicknessMinimum,
    Math.min(thicknessMaximum, portalWidth / aspectDivisor)
  );
  const haloHeight = portalHeight * haloHeightRatio;
  const minimumPortalX = root.left + 12 + (portalWidth / 2);
  const maximumPortalX = root.right - 12 - (portalWidth / 2);
  const artworkCenterX = artworkLeft + (artworkWidth / 2);
  const portalX = Math.min(
    maximumPortalX,
    Math.max(minimumPortalX, artworkCenterX)
  );
  const portalLeft = portalX - (portalWidth / 2);
  const portalRight = portalX + (portalWidth / 2);
  const coreHalfHeight = Math.max(2, innerWidth * 0.0014);
  const shoulderExtent = Math.max(12, Math.min(34, haloHeight * 0.15));
  const sampledPortalLeft = portalLeft + (portalWidth * 0.15);
  const sampledPortalRight = portalRight - (portalWidth * 0.15);
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
  const coreRegion = clampRect({
    left: sampledPortalLeft,
    top: portalY - coreHalfHeight,
    right: sampledPortalRight,
    bottom: portalY + coreHalfHeight
  });
  const upperShoulder = clampRect({
    left: sampledPortalLeft,
    top: portalY - shoulderExtent,
    right: sampledPortalRight,
    bottom: portalY - coreHalfHeight
  });
  const lowerShoulder = clampRect({
    left: sampledPortalLeft,
    top: portalY + coreHalfHeight,
    right: sampledPortalRight,
    bottom: portalY + shoulderExtent
  });
  const inwardShoulder = expectedPortalSide === 'bottom' ? upperShoulder : lowerShoulder;
  const outwardShoulder = expectedPortalSide === 'bottom' ? lowerShoulder : upperShoulder;
  const backgroundWidth = Math.max(16, Math.min(72, innerWidth * 0.06));
  const backgroundTop = portalY - shoulderExtent;
  const backgroundBottom = portalY + shoulderExtent;
  const regions = {
    gate: coreRegion,
    gateContext: outwardShoulder,
    inwardShoulder,
    outwardShoulder,
    background: [
      clampRect({ left: 0, top: backgroundTop, right: backgroundWidth, bottom: backgroundBottom }),
      clampRect({
        left: innerWidth - backgroundWidth,
        top: backgroundTop,
        right: innerWidth,
        bottom: backgroundBottom
      })
    ]
  };
  return {
    clip,
    regions,
    portalSide: expectedPortalSide,
    expectedPortalCenterX: portalX,
    expectedPortalCenterY: portalY,
    expectedPortalWidth: portalWidth,
    expectedPortalHeight: portalHeight,
    artworkWidth,
    artworkHeight,
    artworkTop,
    artworkBottom,
    desiredGap,
    portalGap,
    portalIsHorizontal: portalWidth / portalHeight >= 2,
    portalWidthRatio: portalWidth / artworkWidth,
    portalCoreOutsideArtwork: expectedPortalSide === 'bottom'
      ? portalY > artworkBottom
      : portalY < artworkTop,
    haloPointsInward: expectedPortalSide === 'bottom'
      ? regions.inwardShoulder.bottom <= portalY && regions.outwardShoulder.top >= portalY
      : regions.inwardShoulder.top >= portalY && regions.outwardShoulder.bottom <= portalY,
    regionsAreNonempty: Object.values(regions).flat().every((region) => (
      region.right > region.left && region.bottom > region.top
    ))
  };
}, {
  expectedPortalSide: portalSide,
  thicknessMinimum: PORTAL_THICKNESS_MIN,
  thicknessMaximum: PORTAL_THICKNESS_MAX,
  aspectDivisor: PORTAL_ASPECT_DIVISOR,
  haloHeightRatio: PORTAL_HALO_HEIGHT_RATIO
});

const readLightAnimation = ({ phase, peakOffset, portalSide = null, portalPhase = null }) => {
  const root = document.querySelector('#loadingScreen');
  const final = phase === 'final';
  const slit = document.querySelector(
    `.loading-light-slit.is-lit${portalSide ? `[data-portal-side="${portalSide}"]` : ''}${portalPhase ? `[data-portal-phase="${portalPhase}"]` : ''}`
  )
    ?? (final ? document.querySelector('#loadingBottomPortal, #loadingTopPortal') : null);
  if (!root || !slit) return null;
  const animationName = final
    ? 'loading-final-ambient-converge'
    : 'loading-portal-luminance';
  const animationScope = final ? root : slit;
  const animation = animationScope?.getAnimations({ subtree: true }).find((candidate) => (
    candidate.animationName === animationName
  ));
  if (!animation) return null;
  const timing = animation.effect.getComputedTiming();
  const duration = Number(timing.duration);
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
  const primaryAmbient = getComputedStyle(stage, '::before');
  const secondaryAmbient = getComputedStyle(stage, '::after');
  const slitStyle = getComputedStyle(slit);
  const slitBounds = slit.getBoundingClientRect();
  const core = slit.querySelector('.loading-light-core');
  const coreStyle = getComputedStyle(core);
  const haloStyle = getComputedStyle(core, '::before');
  const warmStyle = getComputedStyle(slit.querySelector('.loading-light-edge.is-warm'));
  const coolStyle = getComputedStyle(slit.querySelector('.loading-light-edge.is-cool'));
  const primaryAmbientOpacity = Number.parseFloat(primaryAmbient.opacity) || 0;
  const durationMs = (style) => Number.parseFloat(style.animationDuration) * 1000;
  const gradientDirection = (gradientImage) => {
    const radial = gradientImage.startsWith('radial-gradient(');
    const prefix = radial ? 'radial-gradient(' : 'linear-gradient(';
    const firstArgument = gradientImage.slice(prefix.length).split(',')[0].trim();
    if (radial) return firstArgument;
    return /(?:deg|turn|rad|grad)$|^to\s/.test(firstArgument)
      ? firstArgument
      : 'to bottom';
  };
  const gradientStops = (gradientImage) => [...gradientImage.matchAll(/([-\d.]+)%/g)]
    .map(([, stop]) => Number.parseFloat(stop));
  const portalAnimationNames = ['loading-portal-stretch', 'loading-portal-luminance'];
  const portalAnimations = final ? [] : portalAnimationNames.map((name) => {
    const candidate = slit.getAnimations().find(({ animationName: candidateName }) => (
      candidateName === name
    ));
    const candidateTiming = candidate?.effect.getComputedTiming();
    const keyframes = candidate?.effect.getKeyframes() ?? [];
    return {
      name,
      duration: Number(candidateTiming?.duration) || 0,
      offsets: keyframes.map(({ computedOffset }) => computedOffset),
      animatedProperties: [...new Set(keyframes.flatMap((keyframe) => (
        Object.keys(keyframe).filter((property) => ![
          'offset',
          'computedOffset',
          'easing',
          'composite'
        ].includes(property))
      )))].sort()
    };
  });
  return {
    at,
    currentTime,
    duration,
    naturalPeakAt,
    animationName: animation.animationName,
    playState: animation.playState,
    playbackRate: animation.playbackRate,
    direction: final ? null : slit.dataset.direction,
    portalSide: final ? root.dataset.portalSide : slit.dataset.portalSide,
    portalPhase: final ? root.dataset.portalPhase : slit.dataset.portalPhase,
    parentOpacity: final ? primaryAmbientOpacity : opacity('.loading-light-slit.is-lit'),
    coreOpacity: final ? 0 : opacity('.loading-light-core'),
    warmOpacity: final ? 0 : opacity('.loading-light-edge.is-warm'),
    coolOpacity: final ? 0 : opacity('.loading-light-edge.is-cool'),
    slitDisplay: slitStyle.display,
    slitOpacity: Number.parseFloat(slitStyle.opacity) || 0,
    portalCenterX: slitBounds.left + (slitBounds.width / 2),
    portalCenterY: slitBounds.top + (slitBounds.height / 2),
    portalRenderedWidth: slitBounds.width,
    portalRenderedHeight: slitBounds.height,
    portalWidth: Number.parseFloat(slitStyle.width) || 0,
    portalHeight: Number.parseFloat(slitStyle.height) || 0,
    portalDuration: durationMs(slitStyle),
    coreWidth: Number.parseFloat(coreStyle.width) || 0,
    coreHeight: Number.parseFloat(coreStyle.height) || 0,
    coreFilter: coreStyle.filter,
    coreBlur: Number.parseFloat(coreStyle.filter.match(/blur\(([-\d.]+)px\)/)?.[1]) || 0,
    coreBackgroundImage: coreStyle.backgroundImage,
    coreBackgroundDirection: gradientDirection(coreStyle.backgroundImage),
    coreBackgroundStops: gradientStops(coreStyle.backgroundImage),
    coreBackgroundColor: coreStyle.backgroundColor,
    coreBoxShadow: coreStyle.boxShadow,
    coreAnimationName: coreStyle.animationName,
    coreDuration: durationMs(coreStyle),
    coreBorderRadius: Number.parseFloat(coreStyle.borderRadius) || 0,
    coreMaskImage: coreStyle.maskImage,
    coreWebkitMaskImage: coreStyle.webkitMaskImage,
    haloDisplay: haloStyle.display,
    haloOpacity: Number.parseFloat(haloStyle.opacity) || 0,
    haloWidth: Number.parseFloat(haloStyle.width) || 0,
    haloHeight: Number.parseFloat(haloStyle.height) || 0,
    haloFilter: haloStyle.filter,
    haloBlur: Number.parseFloat(haloStyle.filter.match(/blur\(([-\d.]+)px\)/)?.[1]) || 0,
    haloBackgroundImage: haloStyle.backgroundImage,
    haloBackgroundDirection: gradientDirection(haloStyle.backgroundImage),
    haloMaskImage: haloStyle.maskImage,
    haloWebkitMaskImage: haloStyle.webkitMaskImage,
    haloMaskDirection: gradientDirection(haloStyle.maskImage),
    haloMaskStops: gradientStops(haloStyle.maskImage),
    haloAnimationName: haloStyle.animationName,
    haloDuration: durationMs(haloStyle),
    warmFilter: warmStyle.filter,
    warmDisplay: warmStyle.display,
    warmAnimationName: warmStyle.animationName,
    warmDuration: durationMs(warmStyle),
    coolFilter: coolStyle.filter,
    coolDisplay: coolStyle.display,
    coolAnimationName: coolStyle.animationName,
    coolDuration: durationMs(coolStyle),
    coreDisplay: coreStyle.display,
    primaryAmbientOpacity,
    secondaryAmbientOpacity: Number.parseFloat(secondaryAmbient.opacity) || 0,
    secondaryAmbientDisplay: secondaryAmbient.display,
    primaryAmbientWidth: Number.parseFloat(primaryAmbient.width) || 0,
    primaryAmbientHeight: Number.parseFloat(primaryAmbient.height) || 0,
    primaryAmbientFilter: primaryAmbient.filter,
    primaryAmbientAnimationName: primaryAmbient.animationName,
    primaryAmbientDuration: durationMs(primaryAmbient),
    secondaryAmbientFilter: secondaryAmbient.filter,
    secondaryAmbientAnimationName: secondaryAmbient.animationName,
    secondaryAmbientDuration: durationMs(secondaryAmbient),
    portalAnimations,
    pausedAnimations: animations.filter(({ playState }) => playState === 'paused').length
  };
};

const captureBaseline = async (page, clip) => {
  const start = await page.evaluate(() => performance.now());
  const buffer = await page.screenshot({ clip });
  const end = await page.evaluate(() => performance.now());
  await page.evaluate(({ start, end }) => {
    window.__vinylProbeOverhead.push({ start, end, blocking: false });
  }, { start, end });
  return buffer;
};

const captureNaturalPeak = async (page, {
  clip,
  phase,
  portalSide = null,
  portalPhase = null
}) => {
  const peakOffset = LIGHT_PEAK_OFFSETS[phase];
  await page.waitForFunction(({ phase, peakOffset, portalSide, portalPhase }) => {
    const root = document.querySelector('#loadingScreen');
    const animationName = phase === 'final'
      ? 'loading-final-ambient-converge'
      : 'loading-portal-luminance';
    const scope = phase === 'final'
      ? root
      : root?.querySelector(
        `.loading-light-slit.is-lit${portalSide ? `[data-portal-side="${portalSide}"]` : ''}${portalPhase ? `[data-portal-phase="${portalPhase}"]` : ''}`
      );
    const animation = scope?.getAnimations({ subtree: true }).find(
      (candidate) => candidate.animationName === animationName
    );
    if (!animation) return false;
    const peakTime = Number(animation.effect.getComputedTiming().duration) * peakOffset;
    return animation.currentTime < peakTime - 100;
  }, { phase, peakOffset, portalSide, portalPhase });

  const before = await page.evaluate(readLightAnimation, {
    phase,
    peakOffset,
    portalSide,
    portalPhase
  });
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
  const overheadStart = await page.evaluate(() => performance.now());
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
    const overheadEnd = await page.evaluate(() => performance.now());
    await page.evaluate(({ start, end }) => {
      window.__vinylProbeOverhead.push({ start, end, blocking: false });
    }, { start: overheadStart, end: overheadEnd });
  }
  const after = await page.evaluate(readLightAnimation, {
    phase,
    peakOffset,
    portalSide,
    portalPhase
  });
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
      firstNontransparentActiveFrame: null,
      activeCanvasSamples: [],
      canvasPresentationFrame: 0,
      lastInspectedActiveFrameCount: null,
      maxActive: 0,
      activeIds: [],
      activeTimeline: [],
      currentActiveId: null,
      decodedNodeCount: 0,
      decodedNodeUniqueCount: 0,
      decodedAssetIds: [],
      posterGeometry: null,
      portalContractAtFirstActive: null,
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
      ignitionLeads: [],
      posterTrajectories: {},
      exitTrajectories: {},
      portalSequence: [],
      lastPortalKey: null,
      currentIgnitionAt: null,
      wasSlitLit: false,
      canvasPhases: [],
      idleCanvasSamples: [],
      stableCanvasSamples: [],
      settledFrameCount: null,
      lightPasses: [],
      activeLightPass: null,
      finalHandoffSamples: [],
      handoffFlightSeen: false,
      handoffReadySeen: false
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
      const sampledStableIds = new Set();
      const animationDescriptorCache = new WeakMap();

      const canvasPixelMetrics = () => {
        const overheadStart = performance.now();
        const canvas = probe.canvas;
        if (!canvas || canvas.width === 0 || canvas.height === 0) {
          window.__vinylProbeOverhead.push({
            start: overheadStart,
            end: performance.now(),
            blocking: true
          });
          return { count: 0, bounds: null };
        }
        const pixels = canvas.getContext('2d').getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;
        let count = 0;
        for (let index = 3; index < pixels.length; index += 4) {
          if (pixels[index] === 0) continue;
          count = 1;
          break;
        }
        const metrics = { count, bounds: null };
        window.__vinylProbeOverhead.push({
          start: overheadStart,
          end: performance.now(),
          blocking: true
        });
        return metrics;
      };

      const inspectCanvas = (presentationFrame = null) => {
        const canvas = probe.canvas;
        if (!canvas) return;
        const phase = canvas.dataset.phase;
        const frameCount = presentationFrame ?? (Number(canvas.dataset.frameCount) || 0);
        probe.phaseLeftIdle ||= Boolean(phase && phase !== 'idle');
        if (phase && probe.canvasPhases.at(-1) !== phase) probe.canvasPhases.push(phase);
        if (phase === 'idle') {
          if (frameCount > 0 && probe.settledFrameCount !== frameCount) {
            probe.settledFrameCount = frameCount;
            probe.idleCanvasSamples.push({ frameCount, ...canvasPixelMetrics() });
          }
        }
        if (
          probe.firstNontransparentActiveFrame
          || !['gather', 'scatter'].includes(phase)
          || frameCount === 0
          || probe.lastInspectedActiveFrameCount === frameCount
        ) return;

        probe.lastInspectedActiveFrameCount = frameCount;
        const sample = { phase, frameCount, ...canvasPixelMetrics() };
        probe.activeCanvasSamples.push(sample);
        const nontransparent = sample.count > 0;
        if (probe.firstRenderedFrameNontransparent === null) {
          probe.firstRenderedFrameNontransparent = nontransparent;
        }
        if (nontransparent) probe.firstNontransparentActiveFrame = sample;
      };

      const inspectActivePosters = () => {
        const active = [...document.querySelectorAll('.loading-frame.is-active')];
        const decodedNodes = [...document.querySelectorAll('.loading-artwork-viewport > .loading-image')];
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

        for (const slot of document.querySelectorAll('.loading-frame.is-active.is-stable')) {
          const id = slot.dataset.loadingSlot;
          if (sampledStableIds.has(id)) continue;
          const sample = {
            id,
            phase: probe.canvas?.dataset.phase ?? null,
            frameCount: Number(probe.canvas?.dataset.frameCount) || 0,
            ...canvasPixelMetrics()
          };
          const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
          const expectedStableCanvas = reduced
            ? sample.phase === 'idle' && sample.count === 0
            : sample.phase === 'hold' && sample.count > 0;
          if (!expectedStableCanvas) continue;
          sampledStableIds.add(id);
          probe.stableCanvasSamples.push(sample);
        }

        if (probe.posterGeometry || active.length !== 1) return;
        const image = active[0].querySelector('.loading-image');
        const stage = image?.closest('.loading-stage');
        if (!image || !stage || image.naturalWidth === 0) return;
        const imageRect = image.getBoundingClientRect();
        const imageStyle = getComputedStyle(image);
        const stageRect = stage.getBoundingClientRect();
        const rootRect = stage.closest('#loadingScreen')?.getBoundingClientRect() ?? stageRect;
        probe.posterGeometry = {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          objectFit: imageStyle.objectFit,
          insideStage: imageRect.width <= stageRect.width + 0.5 && imageRect.height <= stageRect.height + 0.5,
          maskImage: imageStyle.maskImage,
          webkitMaskImage: imageStyle.webkitMaskImage
        };
        const slit = document.querySelector('.loading-light-slit.is-lit');
        const core = slit?.querySelector('.loading-light-core');
        const warm = slit?.querySelector('.loading-light-edge.is-warm');
        const cool = slit?.querySelector('.loading-light-edge.is-cool');
        const slitStyle = slit ? getComputedStyle(slit) : null;
        const coreStyle = core ? getComputedStyle(core) : null;
        const haloStyle = core ? getComputedStyle(core, '::before') : null;
        const warmStyle = warm ? getComputedStyle(warm) : null;
        const coolStyle = cool ? getComputedStyle(cool) : null;
        const frameRect = active[0].getBoundingClientRect();
        const containRatio = Math.min(
          frameRect.width / image.naturalWidth,
          frameRect.height / image.naturalHeight
        );
        const artworkWidth = image.naturalWidth * containRatio;
        const artworkHeight = image.naturalHeight * containRatio;
        const artworkTop = frameRect.top + ((frameRect.height - artworkHeight) / 2);
        const artworkBottom = artworkTop + artworkHeight;
        const artworkLeft = frameRect.left + ((frameRect.width - artworkWidth) / 2);
        const artworkCenterX = artworkLeft + (artworkWidth / 2);
        const expectedWidth = Math.max(1, Math.min(artworkWidth * 1.08, rootRect.width - 24));
        const expectedHeight = Math.max(112, Math.min(168, expectedWidth / 4.4));
        const slitBounds = slit?.getBoundingClientRect();
        const portalCenterX = slitBounds ? slitBounds.left + (slitBounds.width / 2) : null;
        const portalCenterY = slitBounds ? slitBounds.top + (slitBounds.height / 2) : null;
        const portalSide = slit?.dataset.portalSide ?? null;
        const portalGap = portalSide === 'bottom'
          ? portalCenterY - artworkBottom
          : artworkTop - portalCenterY;
        const parseAnimationNames = (value) => value.split(',')
          .map((name) => name.trim())
          .filter((name) => name && name !== 'none');
        const parseAnimationDurations = (value) => value.split(',').map((duration) => {
          const token = duration.trim();
          const numeric = Number.parseFloat(token) || 0;
          return token.endsWith('ms') ? numeric : numeric * 1000;
        });
        const readBlur = (filter) => Number.parseFloat(
          filter.match(/blur\(([-\d.]+)px\)/)?.[1]
        ) || 0;
        const readGradientStops = (gradientImage) => [...gradientImage.matchAll(/([-\d.]+)%/g)]
          .map(([, stop]) => Number.parseFloat(stop));
        const readGradientDirection = (gradientImage) => {
          const radial = gradientImage.startsWith('radial-gradient(');
          const prefix = radial ? 'radial-gradient(' : 'linear-gradient(';
          const firstArgument = gradientImage.slice(prefix.length).split(',')[0].trim();
          if (radial) return firstArgument;
          return /(?:deg|turn|rad|grad)$|^to\s/.test(firstArgument)
            ? firstArgument
            : 'to bottom';
        };
        probe.portalContractAtFirstActive = {
          display: slitStyle?.display ?? null,
          opacity: Number.parseFloat(slitStyle?.opacity) || 0,
          width: Number.parseFloat(slitStyle?.width) || 0,
          height: Number.parseFloat(slitStyle?.height) || 0,
          direction: slit?.dataset.direction ?? null,
          portalCenterX,
          portalCenterY,
          artworkWidth,
          artworkHeight,
          artworkTop,
          artworkBottom,
          artworkCenterX,
          desiredGap: Math.max(20, Math.min(38, artworkHeight * 0.055)),
          portalGap,
          portalOutsideArtwork: portalSide === 'bottom'
            ? portalCenterY > artworkBottom
            : portalCenterY < artworkTop,
          expectedHeight,
          expectedWidth,
          expectedCoreHeight: Math.max(1.5, Math.min(2, innerWidth * 0.0014)),
          expectedHaloHeight: expectedHeight * 1.85,
          expectedHaloBlur: Math.max(14, Math.min(22, innerWidth * 0.014)),
          portalSide,
          animationNames: parseAnimationNames(slitStyle?.animationName ?? ''),
          animationDurations: parseAnimationDurations(slitStyle?.animationDuration ?? '0s'),
          coreOpacity: Number.parseFloat(coreStyle?.opacity) || 0,
          coreDisplay: coreStyle?.display ?? null,
          coreWidth: Number.parseFloat(coreStyle?.width) || 0,
          coreHeight: Number.parseFloat(coreStyle?.height) || 0,
          coreFilter: coreStyle?.filter ?? null,
          coreBlur: readBlur(coreStyle?.filter ?? ''),
          coreBorderRadius: Number.parseFloat(coreStyle?.borderRadius) || 0,
          coreMaskImage: coreStyle?.maskImage ?? null,
          coreWebkitMaskImage: coreStyle?.webkitMaskImage ?? null,
          coreBackgroundImage: coreStyle?.backgroundImage ?? null,
          coreBackgroundDirection: readGradientDirection(coreStyle?.backgroundImage ?? ''),
          coreBackgroundStops: readGradientStops(coreStyle?.backgroundImage ?? ''),
          coreBackgroundColor: coreStyle?.backgroundColor ?? null,
          coreBoxShadow: coreStyle?.boxShadow ?? null,
          coreDuration: Number.parseFloat(coreStyle?.animationDuration) * 1000,
          coreAnimationName: coreStyle?.animationName ?? null,
          haloDisplay: haloStyle?.display ?? null,
          haloOpacity: Number.parseFloat(haloStyle?.opacity) || 0,
          haloWidth: Number.parseFloat(haloStyle?.width) || 0,
          haloHeight: Number.parseFloat(haloStyle?.height) || 0,
          haloFilter: haloStyle?.filter ?? null,
          haloBlur: readBlur(haloStyle?.filter ?? ''),
          haloBackgroundImage: haloStyle?.backgroundImage ?? null,
          haloBackgroundDirection: readGradientDirection(haloStyle?.backgroundImage ?? ''),
          haloMaskImage: haloStyle?.maskImage ?? null,
          haloWebkitMaskImage: haloStyle?.webkitMaskImage ?? null,
          haloMaskDirection: readGradientDirection(haloStyle?.maskImage ?? ''),
          haloMaskStops: readGradientStops(haloStyle?.maskImage ?? ''),
          haloAnimationName: haloStyle?.animationName ?? null,
          haloDuration: Number.parseFloat(haloStyle?.animationDuration) * 1000,
          warmDisplay: warmStyle?.display ?? null,
          warmFilter: warmStyle?.filter ?? null,
          warmAnimationName: warmStyle?.animationName ?? null,
          warmDuration: Number.parseFloat(warmStyle?.animationDuration) * 1000,
          coolDisplay: coolStyle?.display ?? null,
          coolFilter: coolStyle?.filter ?? null,
          coolAnimationName: coolStyle?.animationName ?? null,
          coolDuration: Number.parseFloat(coolStyle?.animationDuration) * 1000
        };
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

      const sampleCanvasFrames = () => {
        probe.canvasPresentationFrame += 1;
        inspectCanvas(probe.canvasPresentationFrame);
        if (document.querySelector('#loadingScreen')) requestAnimationFrame(sampleCanvasFrames);
      };
      requestAnimationFrame(sampleCanvasFrames);

      const readClipGeometry = (clipPath, rect, renderScale = 1) => {
        if (!clipPath || clipPath === 'none' || !clipPath.startsWith('inset(')) {
          return {
            roundRadiusX: null,
            roundRadiusY: null,
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
        const visibleWidth = Math.max(0, rect.width - left - right);
        const visibleHeight = Math.max(0, rect.height - top - bottom);
        const [horizontalRadii, verticalRadii = horizontalRadii] = roundSource.split(/\s*\/\s*/);
        const firstRadius = (source) => source.trim().split(/\s+/)[0];
        const radiusToPixels = (token, percentBase) => {
          if (token.endsWith('%')) return (Number.parseFloat(token) / 100) * percentBase;
          if (token.endsWith('px')) return Number.parseFloat(token) * renderScale;
          return null;
        };
        return {
          roundRadiusX: radiusToPixels(firstRadius(horizontalRadii), visibleWidth),
          roundRadiusY: radiusToPixels(firstRadius(verticalRadii), visibleHeight),
          visibleLeft: rect.left + left,
          visibleTop: rect.top + top,
          visibleWidth,
          visibleHeight
        };
      };

      const readPosterSample = (frame, image, at) => {
        const frameStyle = getComputedStyle(frame);
        const imageStyle = getComputedStyle(image);
        const rect = image.getBoundingClientRect();
        const stageRect = image.closest('.loading-stage').getBoundingClientRect();
        const transform = imageStyle.transform;
        const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
        const independentScale = Number.parseFloat(imageStyle.scale);
        const frameOpacity = Number.parseFloat(frameStyle.opacity) || 0;
        const imageOpacity = Number.parseFloat(imageStyle.opacity) || 0;
        const glide = image.getAnimations().find(({ animationName }) => (
          animationName === 'loading-poster-glide-in'
        ));
        const glideTiming = glide?.effect?.getComputedTiming?.();
        return {
          at,
          centerY: rect.top + (rect.height / 2),
          stageCenterY: stageRect.top + (stageRect.height / 2),
          stageWidth: stageRect.width,
          stageHeight: stageRect.height,
          scale: Number.isFinite(independentScale)
            ? independentScale
            : (matrix ? Math.hypot(matrix.a, matrix.b) : 1),
          opacity: frameStyle.visibility === 'visible' ? frameOpacity * imageOpacity : 0,
          glidePlayState: glide?.playState ?? null,
          glideDuration: Number(glideTiming?.duration) || null,
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
          if (probe.activeLightPass) {
            probe.activeLightPass.endedAt = performance.now();
            probe.lightPasses.push(probe.activeLightPass);
            probe.activeLightPass = null;
          }
          return;
        }
        const visualFrames = [...loading.querySelectorAll('.loading-frame.is-active, .loading-frame.is-outgoing')];
        probe.continuityArmed ||= Boolean(loading.querySelector('.loading-frame.is-stable'));
        probe.handoffFlightSeen ||= Boolean(loading.querySelector('.loading-handoff-flight'));

        const now = performance.now();
        const litSlit = loading.querySelector('.loading-light-slit.is-lit');
        const finalResolving = loading.classList.contains('is-final-resolving');
        const slit = litSlit
          ?? (finalResolving ? loading.querySelector('#loadingBottomPortal, #loadingTopPortal') : null);
        const slitLit = Boolean(litSlit?.classList.contains('is-lit'));
        const lightPhase = finalResolving ? 'final' : (slitLit ? 'ordinary' : null);
        const portalSide = finalResolving
          ? loading.dataset.portalSide
          : (slit?.dataset.portalSide ?? null);
        const portalPhase = finalResolving
          ? loading.dataset.portalPhase
          : (slit?.dataset.portalPhase ?? null);
        const portalKey = lightPhase ? `${lightPhase}:${portalSide}:${portalPhase}` : null;
        if (lightPhase) {
          if (!probe.activeLightPass || probe.activeLightPass.key !== portalKey) {
            if (probe.activeLightPass) {
              probe.activeLightPass.endedAt = now;
              probe.lightPasses.push(probe.activeLightPass);
            }
            probe.activeLightPass = {
              key: portalKey,
              phase: lightPhase,
              direction: finalResolving ? null : slit.dataset.direction,
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
          const coreStyle = getComputedStyle(loading.querySelector('.loading-light-core'));
          const warmStyle = getComputedStyle(loading.querySelector('.loading-light-edge.is-warm'));
          const coolStyle = getComputedStyle(loading.querySelector('.loading-light-edge.is-cool'));
          const portalAnimation = slit.getAnimations().find(({ animationName }) => (
            animationName === 'loading-portal-luminance'
          ));
          const portalTiming = portalAnimation?.effect?.getComputedTiming?.();
          const stage = loading.querySelector('.loading-stage');
          const primaryAmbientOpacity = Number.parseFloat(
            getComputedStyle(stage, '::before').opacity
          ) || 0;
          const secondaryAmbientStyle = getComputedStyle(stage, '::after');
          const secondaryAmbientOpacity = Number.parseFloat(secondaryAmbientStyle.opacity) || 0;
          probe.activeLightPass.samples.push({
            at: now,
            centerX: bounds.left + (bounds.width / 2),
            centerY: bounds.top + (bounds.height / 2),
            portalRenderedWidth: bounds.width,
            portalLayoutWidth: Number.parseFloat(getComputedStyle(slit).width) || 0,
            portalRenderedHeight: bounds.height,
            portalLayoutHeight: Number.parseFloat(getComputedStyle(slit).height) || 0,
            portalAnimationDuration: Number(portalTiming?.duration) || null,
            portalAnimationPlayState: portalAnimation?.playState ?? null,
            parentOpacity: finalResolving ? primaryAmbientOpacity : opacity('.loading-light-slit.is-lit'),
            coreOpacity: finalResolving ? 0 : opacity('.loading-light-core'),
            warmOpacity: finalResolving ? 0 : opacity('.loading-light-edge.is-warm'),
            coolOpacity: finalResolving ? 0 : opacity('.loading-light-edge.is-cool'),
            coreDisplay: coreStyle.display,
            warmDisplay: warmStyle.display,
            coolDisplay: coolStyle.display,
            slitDisplay: getComputedStyle(slit).display,
            primaryAmbientOpacity,
            secondaryAmbientOpacity,
            secondaryAmbientDisplay: secondaryAmbientStyle.display
          });
          if (finalResolving) {
            const poster = loading.querySelector('.loading-frame.is-active .loading-image');
            const handoff = loading.querySelector('.loading-image[data-loading-handoff="true"]');
            const target = document.querySelector('.vinyl-sticker');
            const targetCover = document.querySelector('#vinylCoverA');
            if (poster && handoff && target && targetCover) {
              const handoffStyle = getComputedStyle(handoff);
              const handoffRect = handoff.getBoundingClientRect();
              const sourceFrameRect = handoff.closest('.loading-frame').getBoundingClientRect();
              const transform = handoffStyle.transform;
              const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
              const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1;
              const clip = readClipGeometry(handoffStyle.clipPath, handoffRect, scale);
              const targetRect = target.getBoundingClientRect();
              const visibleCenterX = clip.visibleLeft + (clip.visibleWidth / 2);
              const visibleCenterY = clip.visibleTop + (clip.visibleHeight / 2);
              const targetCenterX = targetRect.left + (targetRect.width / 2);
              const targetCenterY = targetRect.top + (targetRect.height / 2);
              const artworkSource = handoff.currentSrc || handoff.src;
              const readAnimationState = (element, name) => {
                const animation = element.getAnimations().find(
                  ({ animationName }) => animationName === name
                );
                if (!animation) return null;
                const animationTiming = animation.effect.getComputedTiming();
                let descriptor = animationDescriptorCache.get(animation);
                if (!descriptor) {
                  const animationKeyframes = animation.effect.getKeyframes();
                  descriptor = {
                    name: animation.animationName,
                    duration: Number(animationTiming.duration) || 0,
                    animatedProperties: [...new Set(animationKeyframes.flatMap((keyframe) => (
                      Object.keys(keyframe).filter((property) => ![
                        'offset',
                        'computedOffset',
                        'easing',
                        'composite'
                      ].includes(property))
                    )))].sort(),
                    keyframes: animationKeyframes.map((keyframe) => ({
                      offset: keyframe.computedOffset,
                      easing: keyframe.easing,
                      opacity: keyframe.opacity ?? null,
                      clipPath: keyframe.clipPath ?? null,
                      transform: keyframe.transform ?? null
                    }))
                  };
                  animationDescriptorCache.set(animation, descriptor);
                }
                return {
                  ...descriptor,
                  progress: Number.isFinite(animationTiming.progress)
                    ? Number(animationTiming.progress)
                    : null
                };
              };
              const motion = readAnimationState(handoff, 'loading-poster-to-player-motion');
              const shape = readAnimationState(handoff, 'loading-poster-to-player-shape');
              probe.handoffReadySeen ||= loading.dataset.handoffReady === 'true';
              probe.finalHandoffSamples.push({
                at: now,
                centerX: visibleCenterX,
                centerY: visibleCenterY,
                centerDistance: Math.hypot(
                  visibleCenterX - targetCenterX,
                  visibleCenterY - targetCenterY
                ),
                visibleWidth: clip.visibleWidth,
                visibleHeight: clip.visibleHeight,
                opacity: Number.parseFloat(handoffStyle.opacity) || 0,
                scale,
                clipPath: handoffStyle.clipPath,
                roundRadiusX: clip.roundRadiusX,
                roundRadiusY: clip.roundRadiusY,
                motion,
                shape,
                sourceIsActivePoster: handoff === poster,
                handoffSourceCount: loading.querySelectorAll(
                  '.loading-image[data-loading-handoff="true"]'
                ).length,
                loadingImageCount: loading.querySelectorAll('.loading-image').length,
                sourceFrameRect: {
                  left: sourceFrameRect.left,
                  top: sourceFrameRect.top,
                  width: sourceFrameRect.width,
                  height: sourceFrameRect.height
                },
                targetWidth: targetRect.width,
                targetHeight: targetRect.height,
                targetCoverLoadingHandoff: targetCover?.dataset.loadingHandoff === 'true',
                targetCoverActive: Boolean(targetCover?.classList.contains('is-active')),
                targetCoverOpacity: Number.parseFloat(getComputedStyle(targetCover).opacity) || 0,
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
              if (
                opacity > 0.05
                && probe.activeLightPass?.portalSide === 'top'
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

const installCallbackBudgetProbe = async (page) => {
  await page.addInitScript(() => {
    const samples = [];
    const record = (kind, callback) => function measuredCallback(...args) {
      const startedAt = performance.now();
      try {
        return Reflect.apply(callback, this, args);
      } finally {
        samples.push({
          kind,
          startedAt,
          duration: performance.now() - startedAt
        });
      }
    };

    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeSetTimeout = window.setTimeout.bind(window);
    const nativeSetInterval = window.setInterval.bind(window);

    window.__vinylCallbackBudget = samples;
    window.requestAnimationFrame = (callback) => (
      nativeRequestAnimationFrame(record('animation-frame', callback))
    );
    window.setTimeout = (callback, delay = 0, ...args) => (
      typeof callback === 'function'
        ? nativeSetTimeout(record('timeout', callback), delay, ...args)
        : nativeSetTimeout(callback, delay, ...args)
    );
    window.setInterval = (callback, delay = 0, ...args) => (
      typeof callback === 'function'
        ? nativeSetInterval(record('interval', callback), delay, ...args)
        : nativeSetInterval(callback, delay, ...args)
    );
  });
};

test('single-poster loading sequence is bounded and settles', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
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
  const activeMotionProfile = await page.evaluate(() => (
    document.documentElement.dataset.motionProfile
  ));
  const expectedHandoffDuration = FINAL_HANDOFF_DURATION_MS[activeMotionProfile];

  const loading = page.locator('#loadingScreen');
  const canvasJsHandle = await page.evaluateHandle(() => window.__vinylLoadingProbe.canvas);
  const canvasHandle = canvasJsHandle.asElement();
  expect(canvasHandle).not.toBeNull();

  const initialProbe = await page.evaluate(() => ({
    effectStart: window.__vinylLoadingProbe.effectStart,
    loadingSeen: window.__vinylLoadingProbe.loadingSeen,
    maxActive: window.__vinylLoadingProbe.maxActive,
    posterGeometry: window.__vinylLoadingProbe.posterGeometry,
    portalContractAtFirstActive: window.__vinylLoadingProbe.portalContractAtFirstActive
  }));
  expect(Number.isFinite(initialProbe.effectStart)).toBe(true);
  expect(initialProbe.loadingSeen).toBe(true);
  expect(initialProbe.maxActive).toBe(1);
  expect(initialProbe.posterGeometry).toMatchObject({
    naturalWidth: 600,
    naturalHeight: 800,
    objectFit: 'contain',
    insideStage: true
  });

  if (reduce) {
    expect(initialProbe.portalContractAtFirstActive).toMatchObject({
      display: null,
      portalSide: null,
      animationNames: []
    });
  } else {
    const poster = initialProbe.posterGeometry;
    expect(poster.maskImage).toBe('none');
    expect(poster.webkitMaskImage).toBe('none');

    const portal = initialProbe.portalContractAtFirstActive;
    expect(portal.portalSide).toBe('top');
    expect(portal.direction).toBe('horizontal');
    expect(portal.portalOutsideArtwork).toBe(true);
    expect(portal.portalGap).toBeGreaterThan(0);
    expect(portal.portalGap).toBeGreaterThanOrEqual(20);
    expect(portal.portalGap).toBeLessThanOrEqual(38);
    expect(Math.abs(portal.portalGap - portal.desiredGap))
      .toBeLessThanOrEqual(AMBIENT_POSTER_DRIFT_MAX);
    expect(Math.abs(portal.portalCenterX - portal.artworkCenterX)).toBeLessThanOrEqual(1);
    expect(portal.display).not.toBe('none');
    expect(portal.opacity).toBeGreaterThanOrEqual(0.5);
    expect(portal.coreOpacity).toBeGreaterThanOrEqual(0.58);
    expect(portal.animationNames).toEqual([
      'loading-portal-stretch',
      'loading-portal-luminance'
    ]);
    expect(portal.animationDurations).toEqual([PORTAL_DURATION_MS, PORTAL_DURATION_MS]);
    expect(portal.width).toBeCloseTo(portal.expectedWidth, 0);
    expect(portal.height).toBeCloseTo(portal.expectedHeight, 0);
    expect(portal.coreWidth).toBeCloseTo(portal.width, 1);
    expect(Math.abs(portal.coreHeight - portal.expectedCoreHeight)).toBeLessThanOrEqual(0.02);
    expect(portal.coreDisplay).toBe('block');
    expect(portal.coreAnimationName).toBe('none');
    expect(portal.coreDuration).toBe(0);
    expect(portal.coreBlur).toBeCloseTo(0.2, 2);
    expect(portal.coreBorderRadius).toBe(0);
    expect(portal.coreMaskImage).toBe('none');
    expect(portal.coreWebkitMaskImage).toBe('none');
    expect(portal.coreBackgroundImage).toContain('linear-gradient');
    expect(portal.coreBackgroundDirection).toBe('90deg');
    expect(portal.coreBackgroundStops).toEqual([0, 6, 14, 24, 36, 50, 64, 76, 86, 94, 100]);
    expect(portal.coreBackgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(portal.coreBoxShadow).toBe('none');
    expect(portal.coreFilter).toContain('drop-shadow');
    expect(portal.haloDisplay).not.toBe('none');
    expect(portal.haloOpacity).toBe(1);
    expect(portal.haloWidth).toBeCloseTo(portal.width * 1.32, 1);
    expect(portal.haloHeight).toBeCloseTo(portal.expectedHaloHeight, 1);
    expect(portal.haloBlur).toBeCloseTo(portal.expectedHaloBlur, 2);
    expect(portal.haloAnimationName).toBe('none');
    expect(portal.haloDuration).toBe(0);
    expect(portal.haloBackgroundImage).toContain('radial-gradient');
    expect(portal.haloBackgroundDirection).toMatch(/^104% 100% at 50% 0(?:px|%)$/);
    expect(portal.haloBackgroundImage).toContain('rgba(255, 252, 243, 0.92)');
    expect(portal.haloMaskImage.match(/linear-gradient/g) ?? []).toHaveLength(1);
    expect(portal.haloWebkitMaskImage).toBe(portal.haloMaskImage);
    expect(portal.haloMaskDirection).toBe('90deg');
    expect(portal.haloMaskStops).toEqual([0, 6, 14, 28, 42, 58, 72, 86, 94, 100]);
    expect(portal.warmDisplay).toBe('none');
    expect(portal.coolDisplay).toBe('none');
    expect(portal.warmAnimationName).toBe('none');
    expect(portal.coolAnimationName).toBe('none');
    expect(portal.warmDuration).toBe(0);
    expect(portal.coolDuration).toBe(0);
    expect(portal.haloBackgroundImage.match(/rgba\(0, 0, 0, 0\)/g)?.length ?? 0)
      .toBeLessThanOrEqual(2);
  }
  let ordinaryLightMetrics = null;
  let ordinaryCapture = null;
  let ordinaryLightOracle = null;
  let finalLightMetrics = null;
  let finalCapture = null;
  let performanceProbeEnd = null;
  if (!reduce) {
    await page.waitForFunction(() => {
      const loading = document.querySelector('#loadingScreen');
      return loading
        && !loading.classList.contains('is-final-resolving')
        && document.querySelector('.loading-frame.is-active.is-stable')
        && !document.querySelector('.loading-light-slit.is-lit');
    });
    ordinaryLightOracle = await getLightOracleRegions(page, 'bottom');
    expect(ordinaryLightOracle.portalSide).toBe('bottom');
    expect(ordinaryLightOracle.portalIsHorizontal).toBe(true);
    expect(ordinaryLightOracle.portalWidthRatio).toBeCloseTo(1.08, 2);
    expect(ordinaryLightOracle.portalCoreOutsideArtwork).toBe(true);
    expect(ordinaryLightOracle.portalGap).toBeGreaterThanOrEqual(20);
    expect(ordinaryLightOracle.portalGap).toBeLessThanOrEqual(38);
    expect(Math.abs(ordinaryLightOracle.portalGap - ordinaryLightOracle.desiredGap))
      .toBeLessThanOrEqual(AMBIENT_POSTER_DRIFT_MAX);
    expect(ordinaryLightOracle.haloPointsInward).toBe(true);
    expect(ordinaryLightOracle.regionsAreNonempty).toBe(true);
    await page.addStyleTag({ content: `
      #loadingScreen[data-light-oracle-isolated="true"] .loading-poster-stack,
      #loadingScreen[data-light-oracle-isolated="true"] #loadingParticles,
      #loadingScreen[data-light-oracle-isolated="true"] .loading-status {
        opacity: 0 !important;
      }
      #loadingScreen[data-light-baseline-isolated="true"] .loading-light-slit,
      #loadingScreen[data-light-baseline-isolated="true"] .loading-stage::before,
      #loadingScreen[data-light-baseline-isolated="true"] .loading-stage::after {
        opacity: 0 !important;
      }
    ` });
    const setLightOracleIsolation = (isolated) => page.evaluate((nextIsolated) => {
      const root = document.querySelector('#loadingScreen');
      if (!root) return;
      if (nextIsolated) root.dataset.lightOracleIsolated = 'true';
      else delete root.dataset.lightOracleIsolated;
    }, isolated);
    const setLightBaselineIsolation = (isolated) => page.evaluate((nextIsolated) => {
      const root = document.querySelector('#loadingScreen');
      if (!root) return;
      if (nextIsolated) root.dataset.lightBaselineIsolated = 'true';
      else delete root.dataset.lightBaselineIsolated;
    }, isolated);
    performanceProbeEnd = await page.evaluate(() => performance.now());
    await setLightOracleIsolation(true);
    await setLightBaselineIsolation(true);
    const ordinaryBaseline = await captureBaseline(page, ordinaryLightOracle.clip);
    await setLightBaselineIsolation(false);
    await writeFile(
      testInfo.outputPath(`ordinary-baseline-${testInfo.project.name}.png`),
      ordinaryBaseline
    );
    const ordinaryPeak = await captureNaturalPeak(page, {
      clip: ordinaryLightOracle.clip,
      phase: 'ordinary',
      portalSide: 'bottom',
      portalPhase: 'exit'
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
      oracleClip: ordinaryLightOracle.clip,
      oracleRegions: ordinaryLightOracle.regions
    };
    ordinaryLightMetrics = await measureSemanticLightDelta(
      page,
      ordinaryBaseline,
      ordinaryPeak,
      ordinaryLightOracle.clip,
      ordinaryLightOracle.regions
    );
    await writeFile(
      testInfo.outputPath(`ordinary-natural-peak-${testInfo.project.name}.png`),
      Buffer.from(ordinaryLightMetrics.croppedPng, 'base64')
    );
    delete ordinaryLightMetrics.croppedPng;
    await setLightOracleIsolation(false);

    await page.waitForFunction(() => (
      window.__vinylLoadingProbe.activeIds.includes('archive-10')
    ), null, { timeout: LOADING_SETTLE_TIMEOUT_MS });
    await page.waitForFunction(() => {
      const final = document.querySelector('[data-loading-slot="archive-10"].is-active.is-stable');
      return final && !document.querySelector('#loadingScreen')?.classList.contains('is-final-resolving');
    });
    await setLightOracleIsolation(true);
    await setLightBaselineIsolation(true);
    const finalBaseline = await captureBaseline(page, ordinaryLightOracle.clip);
    await setLightBaselineIsolation(false);
    await writeFile(
      testInfo.outputPath(`final-baseline-${testInfo.project.name}.png`),
      finalBaseline
    );
    const finalPeak = await captureNaturalPeak(page, {
      clip: ordinaryLightOracle.clip,
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
      oracleClip: ordinaryLightOracle.clip,
      oracleRegions: ordinaryLightOracle.regions
    };
    finalLightMetrics = await measureSemanticLightDelta(
      page,
      finalBaseline,
      finalPeak,
      ordinaryLightOracle.clip,
      ordinaryLightOracle.regions
    );
    await writeFile(
      testInfo.outputPath(`final-natural-peak-${testInfo.project.name}.png`),
      Buffer.from(finalLightMetrics.croppedPng, 'base64')
    );
    delete finalLightMetrics.croppedPng;
    await setLightOracleIsolation(false);

    for (const [phase, capture] of Object.entries({ ordinary: ordinaryCapture, final: finalCapture })) {
      expect(capture.before.playState).toBe('running');
      expect(capture.before.playbackRate).toBe(1);
      expect(capture.before.pausedAnimations).toBe(0);
      expect(capture.after, `${phase} light remains inspectable after its natural peak`)
        .not.toBeNull();
      expect(['running', 'finished']).toContain(capture.after.playState);
      expect(capture.after.playbackRate).toBe(1);
      expect(capture.after.pausedAnimations).toBe(0);
      if (capture.after.playState === 'finished') {
        expect(capture.after.currentTime).toBeGreaterThanOrEqual(capture.after.duration);
      }
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
    expect(ordinaryCapture.before.direction).toBe('horizontal');
    expect(finalCapture.before.direction).toBeNull();
    expect(ordinaryCapture.before.portalSide).toBe('bottom');
    expect(ordinaryCapture.before.portalPhase).toBe('exit');
    expect(finalCapture.before.portalSide).toBe('center');
    expect(finalCapture.before.portalPhase).toBe('final-handoff');
    expect(ordinaryCapture.before.animationName).toBe('loading-portal-luminance');
    expect(finalCapture.before.animationName).toBe('loading-final-ambient-converge');
    expect(ordinaryCapture.before.duration).toBe(PORTAL_DURATION_MS);
    expect(ordinaryCapture.before.portalDuration).toBe(PORTAL_DURATION_MS);
    expect(ordinaryCapture.before.portalAnimations).toEqual([
      {
        name: 'loading-portal-stretch',
        duration: PORTAL_DURATION_MS,
        offsets: [0, 0.4, 0.78, 1],
        animatedProperties: ['transform']
      },
      {
        name: 'loading-portal-luminance',
        duration: PORTAL_DURATION_MS,
        offsets: [0, 0.12, 0.4, 0.78, 1],
        animatedProperties: ['opacity']
      }
    ]);
    expect(ordinaryCapture.before.coreDuration).toBe(0);
    expect(ordinaryCapture.before.warmDuration).toBe(0);
    expect(ordinaryCapture.before.coolDuration).toBe(0);
    expect(Math.abs(
      ordinaryCapture.before.portalWidth - ordinaryLightOracle.expectedPortalWidth
    )).toBeLessThanOrEqual(0.1);
    expect(ordinaryCapture.before.portalHeight)
      .toBeCloseTo(ordinaryLightOracle.expectedPortalHeight, 0);
    expect(ordinaryCapture.before.portalCenterX)
      .toBeCloseTo(ordinaryLightOracle.expectedPortalCenterX, 0);
    expect(Math.abs(
      ordinaryCapture.before.portalCenterY - ordinaryLightOracle.expectedPortalCenterY
    )).toBeLessThanOrEqual(AMBIENT_POSTER_DRIFT_MAX);
    expect(Math.abs(
      (ordinaryCapture.before.portalCenterY - ordinaryLightOracle.artworkBottom)
      - ordinaryLightOracle.portalGap
    )).toBeLessThanOrEqual(AMBIENT_POSTER_DRIFT_MAX);
    expect(ordinaryCapture.before.coreWidth)
      .toBeCloseTo(ordinaryCapture.before.portalWidth, 1);
    expect(Math.abs(
      ordinaryCapture.before.coreHeight
      - Math.max(1.5, Math.min(2, ordinaryCapture.viewportState.innerWidth * 0.0014))
    )).toBeLessThanOrEqual(0.02);
    expect(ordinaryCapture.before.coreDisplay).toBe('block');
    expect(ordinaryCapture.before.coreBlur).toBeCloseTo(0.2, 2);
    expect(ordinaryCapture.before.haloWidth)
      .toBeCloseTo(ordinaryCapture.before.portalWidth * 1.32, 1);
    expect(ordinaryCapture.before.haloHeight).toBeCloseTo(
      ordinaryCapture.before.portalHeight * PORTAL_HALO_HEIGHT_RATIO,
      1
    );
    expect(ordinaryCapture.before.haloBlur).toBeCloseTo(
      Math.max(14, Math.min(22, ordinaryCapture.viewportState.innerWidth * 0.014)),
      2
    );
    expect(ordinaryCapture.before.haloAnimationName).toBe('none');
    expect(ordinaryCapture.before.haloDuration).toBe(0);
    expect(ordinaryCapture.before.coreBorderRadius).toBe(0);
    expect(ordinaryCapture.before.coreMaskImage).toBe('none');
    expect(ordinaryCapture.before.coreWebkitMaskImage).toBe('none');
    expect(ordinaryCapture.before.coreBackgroundImage).toContain('linear-gradient');
    expect(ordinaryCapture.before.coreBackgroundDirection).toBe('90deg');
    expect(ordinaryCapture.before.coreBackgroundStops).toEqual([0, 6, 14, 24, 36, 50, 64, 76, 86, 94, 100]);
    expect(ordinaryCapture.before.coreBackgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(ordinaryCapture.before.haloBackgroundImage).toContain('radial-gradient');
    expect(ordinaryCapture.before.haloBackgroundDirection)
      .toBe('104% 100% at 50% 100%');
    expect(ordinaryCapture.before.haloMaskDirection).toBe('90deg');
    expect(ordinaryCapture.before.haloMaskStops).toEqual([0, 6, 14, 28, 42, 58, 72, 86, 94, 100]);
    expect(ordinaryCapture.before.haloWebkitMaskImage).toBe(
      ordinaryCapture.before.haloMaskImage
    );
    expect(ordinaryCapture.before.coreAnimationName).toBe('none');
    expect(ordinaryCapture.before.warmDisplay).toBe('none');
    expect(ordinaryCapture.before.coolDisplay).toBe('none');
    expect(ordinaryCapture.before.warmAnimationName).toBe('none');
    expect(ordinaryCapture.before.coolAnimationName).toBe('none');
    const finalAmbientAspect = Math.min(
      finalCapture.before.primaryAmbientWidth,
      finalCapture.before.primaryAmbientHeight
    ) / Math.max(
      finalCapture.before.primaryAmbientWidth,
      finalCapture.before.primaryAmbientHeight
    );
    expect(finalAmbientAspect).toBeGreaterThanOrEqual(0.42);
    expect(Math.abs(
      finalCapture.before.primaryAmbientDuration - finalCapture.before.duration
    )).toBeLessThanOrEqual(1);
    expect(finalCapture.before.primaryAmbientFilter).toBe('blur(24px)');
    expect(finalCapture.before.secondaryAmbientDisplay).toBe('none');
    expect(finalCapture.before.primaryAmbientAnimationName)
      .toBe('loading-final-ambient-converge');
    for (const state of [finalCapture.before, finalCapture.after]) {
      expect(state.slitDisplay).toBe('none');
      expect(state.slitOpacity).toBe(0);
      expect(state.parentOpacity).toBeLessThanOrEqual(0.30);
      expect(state.coreOpacity).toBe(0);
      expect(state.warmOpacity).toBe(0);
      expect(state.coolOpacity).toBe(0);
    }
  }
  await expect(loading).toHaveCount(0, { timeout: LOADING_SETTLE_TIMEOUT_MS });
  const effectEnd = await page.evaluate(() => performance.now());
  if (!reduce) {
    for (const [phase, { capture, metrics }] of Object.entries({
      ordinary: { capture: ordinaryCapture, metrics: ordinaryLightMetrics }
    })) {
      const lightLimits = SEMANTIC_LIGHT_LIMITS;
      expect(metrics.frameMapping.croppedWidth).toBe(capture.oracleClip.width);
      expect(metrics.frameMapping.croppedHeight).toBe(capture.oracleClip.height);
      expect(metrics.frameMapping.regions).toEqual(capture.oracleRegions);
      expect(metrics.gate.netMean).toBeGreaterThanOrEqual(lightLimits.gateNetMeanMin);
      expect(metrics.gate.litRatio).toBeGreaterThanOrEqual(lightLimits.gateLitRatioMin);
      expect(metrics.gateProminence).toBeGreaterThanOrEqual(lightLimits.gateProminenceMin);
      expect(metrics.gate.p90).toBeLessThanOrEqual(lightLimits.gateP90Max);
      expect(metrics.inwardShoulder.netMean)
        .toBeGreaterThanOrEqual(lightLimits.inwardShoulderNetMeanMin);
      expect(metrics.inwardShoulderDominance)
        .toBeGreaterThanOrEqual(lightLimits.inwardShoulderDominanceMin);
      expect(metrics.outwardShoulder.p90)
        .toBeLessThanOrEqual(lightLimits.outwardShoulderP90Max);
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
    firstNontransparentActiveFrame: window.__vinylLoadingProbe.firstNontransparentActiveFrame,
    activeCanvasSamples: window.__vinylLoadingProbe.activeCanvasSamples,
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
    ignitionLeads: window.__vinylLoadingProbe.ignitionLeads,
    posterTrajectories: window.__vinylLoadingProbe.posterTrajectories,
    exitTrajectories: window.__vinylLoadingProbe.exitTrajectories,
    portalSequence: window.__vinylLoadingProbe.portalSequence,
    canvasPhases: window.__vinylLoadingProbe.canvasPhases,
    idleCanvasSamples: window.__vinylLoadingProbe.idleCanvasSamples,
    stableCanvasSamples: window.__vinylLoadingProbe.stableCanvasSamples,
    lightPasses: window.__vinylLoadingProbe.lightPasses,
    finalHandoffSamples: window.__vinylLoadingProbe.finalHandoffSamples,
    handoffFlightSeen: window.__vinylLoadingProbe.handoffFlightSeen,
    handoffReadySeen: window.__vinylLoadingProbe.handoffReadySeen
  }));
  expect(finalProbe.maxActive).toBe(1);
  expect(finalProbe.decodedNodeCount).toBe(EXPECTED_ARCHIVE_IDS.length);
  expect(finalProbe.decodedNodeUniqueCount).toBe(EXPECTED_ARCHIVE_IDS.length);
  expect(finalProbe.decodedAssetIds).toEqual(EXPECTED_ARCHIVE_IDS);
  expect(finalProbe.highVisibilityPosterOpacity).toBe(HIGH_VISIBILITY_POSTER_OPACITY);
  expect(finalProbe.maxHighVisibilityPosters).toBeLessThanOrEqual(1);
  expect(finalProbe.highVisibilityPosterViolations).toEqual([]);
  if (reduce) {
    expect(framesAtExit).toBe(0);
    expect(finalProbe.phaseLeftIdle).toBe(false);
    expect(finalProbe.firstRenderedFrameNontransparent).toBeNull();
    expect(finalProbe.firstNontransparentActiveFrame).toBeNull();
    expect(finalProbe.activeCanvasSamples).toEqual([]);
  } else {
    expect(finalProbe.phaseLeftIdle).toBe(true);
    expect(typeof finalProbe.firstRenderedFrameNontransparent).toBe('boolean');
    expect(finalProbe.activeCanvasSamples.length).toBeGreaterThan(0);
    expect(finalProbe.firstNontransparentActiveFrame).toMatchObject({
      count: expect.any(Number),
      frameCount: expect.any(Number)
    });
    expect(finalProbe.firstNontransparentActiveFrame.count).toBeGreaterThan(0);
    expect(['gather', 'scatter']).toContain(finalProbe.firstNontransparentActiveFrame.phase);
    if (!finalProbe.firstRenderedFrameNontransparent) {
      expect(finalProbe.firstNontransparentActiveFrame.frameCount)
        .toBeGreaterThan(finalProbe.activeCanvasSamples[0].frameCount);
    }
    expect(finalProbe.canvasPhases).toContain('gather');
    expect(finalProbe.canvasPhases).toContain('scatter');
    expect(finalProbe.canvasPhases).toContain('hold');
    expect(finalProbe.canvasPhases.every((phase) => (
      ['idle', 'gather', 'scatter', 'hold', 'tail', 'mixed'].includes(phase)
    )))
      .toBe(true);
    expect(finalProbe.idleCanvasSamples.length).toBeGreaterThan(0);
    expect(finalProbe.idleCanvasSamples.every(({ count }) => count === 0)).toBe(true);
  }
  expect(finalProbe.stableCanvasSamples.map(({ id }) => id)).toEqual(EXPECTED_ARCHIVE_IDS);
  expect(finalProbe.stableCanvasSamples.every(({ phase, count }) => (
    reduce ? phase === 'idle' && count === 0 : phase === 'hold' && count > 0
  ))).toBe(true);
  if (!reduce) {
    expect(finalProbe.continuitySamples).toBeGreaterThan(3);
    expect(finalProbe.maxVisualLayers).toBeLessThanOrEqual(1);
    const ordinaryPosterCount = EXPECTED_ARCHIVE_IDS.length - 1;
    const expectedPortalSequence = EXPECTED_ARCHIVE_IDS.flatMap((_, index) => (
      index === ordinaryPosterCount
        ? [['top', 'enter'], ['center', 'final-handoff']]
        : [['top', 'enter'], ['bottom', 'exit']]
    ));
    expect(finalProbe.portalSequence.map(({ side, phase }) => [side, phase]))
      .toEqual(expectedPortalSequence);
    expect(finalProbe.ignitionLeads).toHaveLength(ordinaryPosterCount);
    expect(
      finalProbe.ignitionLeads.every(({ leadMs }) => (
        leadMs >= PORTAL_POSTER_LEAD_RANGE_MS.minimum
        && leadMs <= PORTAL_POSTER_LEAD_RANGE_MS.maximum
      )),
      JSON.stringify(finalProbe.ignitionLeads)
    ).toBe(true);
    const posterTrajectories = Object.entries(finalProbe.posterTrajectories);
    expect(posterTrajectories).toHaveLength(ordinaryPosterCount);
    for (const [id, samples] of posterTrajectories) {
      expect(samples.length, `${id} trajectory samples`).toBeGreaterThanOrEqual(4);
      const firstVisible = samples.find(({ opacity }) => opacity >= 0.05);
      expect(firstVisible, `${id} becomes visible at the top portal`).toBeTruthy();
      expect(
        firstVisible.stageCenterY - firstVisible.centerY,
        `${id} first appears above center`
      ).toBeGreaterThan(firstVisible.stageHeight * 0.08);
      expect(firstVisible.scale, `${id} starts slightly compressed by the portal`).toBeLessThanOrEqual(0.95);

      const crossing = samples.find((sample) => (
        sample.at >= firstVisible.at
        && sample.centerY >= sample.stageCenterY - AMBIENT_POSTER_DRIFT_MAX
        && sample.opacity >= 0.85
      ));
      expect(crossing, `${id} settles at center at high visibility`).toBeTruthy();
      expect(crossing.scale, `${id} restores full scale near center`).toBeGreaterThanOrEqual(0.97);
      expect(firstVisible.glidePlayState, `${id} starts with a running glide`).toBe('running');
      expect(firstVisible.glideDuration, `${id} uses the bounded portal envelope`)
        .toBeLessThanOrEqual(POSTER_TRAVERSAL_LIMIT_MS);
      const approach = samples.filter(({ at }) => at >= firstVisible.at && at <= crossing.at);
      const centerDeltas = approach.slice(1).map((sample, index) => (
        sample.centerY - approach[index].centerY
      ));
      expect(centerDeltas.every((delta) => delta >= -1), `${id} moves from top to center`).toBe(true);
    }
    const exitTrajectories = Object.entries(finalProbe.exitTrajectories);
    expect(exitTrajectories).toHaveLength(ordinaryPosterCount);
    for (const [id, samples] of exitTrajectories) {
      expect(samples.length, `${id} exit trajectory samples`).toBeGreaterThanOrEqual(3);
      const visible = samples.filter(({ opacity }) => opacity >= 0.08);
      expect(visible.length, `${id} remains visible while leaving`).toBeGreaterThanOrEqual(2);
      expect(
        visible.at(-1).centerY - visible[0].centerY,
        `${id} exits toward the bottom portal`
      ).toBeGreaterThan(visible[0].stageHeight * 0.08);
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
    const naturalPeak = (pass) => pass.samples.reduce((peak, sample) => (
      sample.parentOpacity > peak.parentOpacity ? sample : peak
    ));
    const ordinaryNaturalPeak = naturalPeak(ordinaryPass);
    const finalNaturalPeak = naturalPeak(finalPass);
    expect(ordinaryNaturalPeak.at).toBeGreaterThanOrEqual(ordinaryPass.startedAt);
    expect(ordinaryNaturalPeak.parentOpacity).toBeGreaterThanOrEqual(0.60);
    expect(finalNaturalPeak.parentOpacity).toBeGreaterThanOrEqual(0.10);
    expect(finalNaturalPeak.parentOpacity).toBeLessThanOrEqual(0.16);
    expect(finalNaturalPeak.coreOpacity).toBeLessThanOrEqual(0.52);
    expect(finalNaturalPeak.warmOpacity).toBeLessThanOrEqual(0.22);
    expect(finalNaturalPeak.coolOpacity).toBeLessThanOrEqual(0.20);
    const ordinaryPasses = finalProbe.lightPasses.filter(({ phase, samples }) => (
      phase === 'ordinary'
      && samples.some(({ portalAnimationDuration }) => (
        portalAnimationDuration === PORTAL_DURATION_MS
      ))
    ));
    expect(ordinaryPasses.length).toBeGreaterThanOrEqual(9);
    for (const pass of ordinaryPasses) {
      expect([...new Set(pass.samples.flatMap(({ portalAnimationDuration }) => (
        portalAnimationDuration === null ? [] : [portalAnimationDuration]
      )))])
        .toEqual([PORTAL_DURATION_MS]);
      expect(pass.samples.every(({ portalAnimationPlayState }) => (
        portalAnimationPlayState !== 'paused'
      ))).toBe(true);
      expect(pass.samples.some(({ portalAnimationPlayState }) => (
        portalAnimationPlayState === 'running'
      ))).toBe(true);
      const widthRatios = pass.samples.map((sample) => (
        sample.portalRenderedWidth / sample.portalLayoutWidth
      ));
      expect(Math.min(...widthRatios)).toBeLessThanOrEqual(0.36);
      expect(Math.max(...widthRatios)).toBeGreaterThanOrEqual(0.98);
    }
    expect(finalProbe.handoffFlightSeen).toBe(false);
    expect(finalProbe.handoffReadySeen).toBe(true);
    expect(finalProbe.finalContinuitySamples).toBeGreaterThanOrEqual(8);
    expect(finalProbe.maxFinalHighVisibilityPosters).toBe(1);
    expect(finalProbe.finalHighVisibilityPosterViolations).toEqual([]);
    expect(finalProbe.finalHandoffSamples.length).toBeGreaterThanOrEqual(8);
    const handoffSamples = finalProbe.finalHandoffSamples;
    expect(handoffSamples.every((sample) => (
      sample.sourceIsActivePoster
      && sample.handoffSourceCount === 1
      && sample.loadingImageCount === EXPECTED_ARCHIVE_IDS.length
      && Math.abs(sample.opacity - 1) <= 0.01
    ))).toBe(true);
    const frameGeometry = ['left', 'top', 'width', 'height'];
    for (const property of frameGeometry) {
      const values = handoffSamples.map(({ sourceFrameRect }) => sourceFrameRect[property]);
      expect(Math.max(...values) - Math.min(...values), `source frame ${property} is fixed`)
        .toBeLessThanOrEqual(0.5);
    }
    const animatedHandoffSamples = handoffSamples.filter(({ motion, shape }) => (
      motion?.name === 'loading-poster-to-player-motion'
      && shape?.name === 'loading-poster-to-player-shape'
    ));
    expect(animatedHandoffSamples.length).toBeGreaterThanOrEqual(8);
    expect([...new Set(animatedHandoffSamples.map(({ motion }) => (
      JSON.stringify(motion.animatedProperties)
    )))])
      .toEqual([JSON.stringify(['transform'])]);
    expect([...new Set(animatedHandoffSamples.map(({ shape }) => (
      JSON.stringify(shape.animatedProperties)
    )))])
      .toEqual([JSON.stringify(['clipPath'])]);
    expect(
      animatedHandoffSamples.every(({ motion, shape }) => (
        motion.duration === expectedHandoffDuration
        && shape.duration === expectedHandoffDuration
      )),
      JSON.stringify(animatedHandoffSamples.map(({ motion, shape }) => ({
        motion: motion.duration,
        shape: shape.duration
      })))
    ).toBe(true);

    const motionKeyframes = animatedHandoffSamples[0].motion.keyframes;
    expect(motionKeyframes.map(({ offset }) => offset)).toEqual([0, 0.82, 1]);
    expect(motionKeyframes[0].easing).toBe('cubic-bezier(0.4, 0.14, 0.3, 1)');
    expect(motionKeyframes.every(({ transform }) => transform !== null)).toBe(true);
    const shapeKeyframes = animatedHandoffSamples[0].shape.keyframes;
    expect(shapeKeyframes.map(({ offset }) => offset)).toEqual([0, 0.82, 1]);
    expect(shapeKeyframes[0].easing).toBe('cubic-bezier(0, 0, 0.3, 1)');
    expect(shapeKeyframes[0].clipPath).toMatch(/inset\(.+round 0%\)/);
    for (const keyframe of shapeKeyframes.slice(1)) {
      expect(keyframe.clipPath).toMatch(/inset\(.+round [\d.]+px\)/);
    }
    const finalKeyframeRadii = shapeKeyframes.slice(1).map(({ clipPath }) => (
      Number.parseFloat(clipPath.match(/round ([\d.]+)px/)?.[1])
    ));
    expect(finalKeyframeRadii.every((radius) => Number.isFinite(radius) && radius > 0)).toBe(true);
    expect(finalKeyframeRadii[0]).toBeCloseTo(finalKeyframeRadii[1], 4);
    const hasCircularClip = ({
      visibleWidth,
      visibleHeight,
      roundRadiusX,
      roundRadiusY
    }) => (
      Number.isFinite(roundRadiusX)
      && Number.isFinite(roundRadiusY)
      && Math.abs(visibleWidth - visibleHeight) <= 2
      && roundRadiusX >= (visibleWidth / 2) - 1
      && roundRadiusY >= (visibleHeight / 2) - 1
    );
    const circularAtAlignment = animatedHandoffSamples.find(({ shape, ...sample }) => (
      shape.progress >= 0.82 && shape.progress <= 0.94 && hasCircularClip(sample)
    ));
    expect(circularAtAlignment).toBeTruthy();
    const alignedHandoff = animatedHandoffSamples.find(({ motion }) => motion.progress >= 0.82);
    expect(alignedHandoff).toBeTruthy();
    expect(alignedHandoff.motion.progress).toBeLessThanOrEqual(0.94);
    expect(hasCircularClip(alignedHandoff)).toBe(true);
    expect(alignedHandoff.targetCoverLoadingHandoff).toBe(true);
    expect(alignedHandoff.targetCoverActive).toBe(false);
    expect(alignedHandoff.targetCoverArtworkMatches).toBe(true);
    expect(alignedHandoff.targetCoverOpacity).toBe(0);
    expect(alignedHandoff.centerDistance).toBeLessThanOrEqual(1);
    expect(Math.abs(alignedHandoff.visibleWidth - alignedHandoff.targetWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(alignedHandoff.visibleHeight - alignedHandoff.targetHeight)).toBeLessThanOrEqual(1);
    expect(alignedHandoff.scale).toBeLessThan(1);

    expect(animatedHandoffSamples.every(({ targetCoverActive, targetCoverOpacity }) => (
      !targetCoverActive && targetCoverOpacity === 0
    ))).toBe(true);
    const settledHandoff = animatedHandoffSamples.at(-1);
    expect(settledHandoff).toBeTruthy();
    expect(settledHandoff.motion.progress).toBeGreaterThanOrEqual(0.82);
    expect(settledHandoff.opacity).toBeGreaterThanOrEqual(0.99);
    expect(settledHandoff.targetCoverOpacity).toBe(0);
    expect(hasCircularClip(settledHandoff)).toBe(true);
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
      expect(presentedSample.parentOpacity).toBeGreaterThanOrEqual(
        PARENT_PEAK_LOWER_BOUNDS[phase]
      );
      expect(presentedSample.parentOpacity).toBeLessThanOrEqual(
        PARENT_PEAK_UPPER_BOUNDS[phase]
      );
    }
    for (const pass of [ordinaryPass, finalPass]) {
      const deltas = pass.samples.slice(1).map((sample, index) => (
        sample.centerY - pass.samples[index].centerY
      ));
      expect(deltas.every((delta) => delta >= -0.5)).toBe(true);
    }
    const ordinaryCorePeak = Math.max(...ordinaryPass.samples.map(({ coreOpacity }) => coreOpacity));
    expect(ordinaryCorePeak).toBeGreaterThanOrEqual(0.95);
    expect(ordinaryPass.samples.every(({ coreDisplay }) => coreDisplay === 'block')).toBe(true);
    expect(ordinaryPass.samples.every(({ warmDisplay }) => warmDisplay === 'none')).toBe(true);
    expect(ordinaryPass.samples.every(({ coolDisplay }) => coolDisplay === 'none')).toBe(true);

    const finalAmbientPeak = Math.max(...finalPass.samples.map(
      ({ primaryAmbientOpacity }) => primaryAmbientOpacity
    ));
    expect(finalAmbientPeak).toBeGreaterThanOrEqual(0.10);
    expect(finalAmbientPeak).toBeLessThanOrEqual(0.16);
    expect(finalPass.samples.every(({ secondaryAmbientDisplay }) => (
      secondaryAmbientDisplay === 'none'
    ))).toBe(true);
    expect(finalPass.samples.every(({ slitDisplay }) => slitDisplay === 'none')).toBe(true);
  }
  expect(finalProbe.activeIds).toEqual([
    'archive-01',
    'archive-02',
    'archive-03',
    'archive-04',
    'archive-05',
    'archive-06',
    'archive-07',
    'archive-08',
    'archive-09',
    'archive-10'
  ]);

  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#appRoot')).not.toHaveAttribute('aria-hidden', 'true');
  expectExactCoverRequests(stats, { expectFinalPrewarm: reduce });

  const effectLongTasks = await page.evaluate(({ end }) => (
    window.__vinylLongTasks.filter((entry) => (
      entry.startTime >= window.__vinylLoadingProbe.effectStart
      && entry.startTime <= end
      && !window.__vinylProbeOverhead.some((overhead) => (
        entry.startTime <= overhead.end
        && (entry.startTime + entry.duration) >= overhead.start
      ))
    ))
  ), { end: performanceProbeEnd ?? effectEnd });
  // This visual oracle performs continuous layout/style reads and Canvas sampling.
  // Keep browser Long Tasks as diagnostics; the lightweight callback test below
  // owns the 50ms product-code budget without that observer overhead.
  expect(await canvasHandle.evaluate((canvas) => {
    if (canvas.width === 0 || canvas.height === 0) return true;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) return false;
    }
    return true;
  })).toBe(true);

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

test('mobile loading callbacks stay within the 50ms animation budget', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  test.setTimeout(90_000);
  await installDeterministicCovers(page);
  await installCallbackBudgetProbe(page);
  await page.goto('./', { waitUntil: 'commit' });

  await expect(page.locator('#loadingScreen')).toHaveCount(0, {
    timeout: LOADING_SETTLE_TIMEOUT_MS
  });

  const callbackSamples = await page.evaluate(() => window.__vinylCallbackBudget);
  expect(callbackSamples.length).toBeGreaterThan(100);
  expect(callbackSamples.filter(({ duration }) => duration > 50)).toEqual([]);
});

test('failed cover loading clears particles and retry restarts from an empty Canvas', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
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
    total: EXPECTED_ARCHIVE_IDS.length + 4,
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

  await expect(loading).toHaveCount(0, { timeout: LOADING_SETTLE_TIMEOUT_MS });
  await expect.poll(() => routeControl.stats.retry.active).toBe(0);
  expectExactCoverRequests(routeControl.stats.retry, {
    expectFinalPrewarm: true
  });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#appRoot')).not.toHaveAttribute('aria-hidden', 'true');
});

test('out-of-order image completion still presents the manifest sequence with end.jpg last', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  test.setTimeout(LOADING_SETTLE_TIMEOUT_MS);
  const completionOrder = await installOutOfOrderCovers(page);
  await installActivePosterSequenceProbe(page);
  await page.goto('./', { waitUntil: 'commit' });

  await expect(page.locator('#loadingScreen')).toHaveCount(0, {
    timeout: LOADING_SETTLE_TIMEOUT_MS
  });

  const delayedPathname = new URL(
    CRITICAL_IMAGE_MANIFEST.find(({ id }) => id === 'archive-09').source
  ).pathname;
  expect(completionOrder.indexOf(FINAL_COVER_PATHNAME))
    .toBeLessThan(completionOrder.indexOf(delayedPathname));
  expect(await page.evaluate(() => window.__vinylActivePosterSequence))
    .toEqual(EXPECTED_ARCHIVE_IDS);
  await expect(page.locator('#vinylCoverA')).toHaveAttribute(
    'style',
    /\/covers\/end\.jpg/
  );
});

test('skip preserves the in-flight poster and hands end.jpg to the player without a seam', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'mobile-chromium'].includes(testInfo.project.name));
  test.setTimeout(30_000);
  const delayedFinal = await installDelayedFinalCover(page);
  await installSkipHandoffContinuityProbe(page);

  try {
    await page.goto('./', { waitUntil: 'commit' });
    await page.waitForFunction(() => {
      const current = document.querySelector(
        '[data-loading-slot="archive-01"].loading-frame.is-active.is-entering'
      );
      const image = current?.querySelector('.loading-image');
      const animation = image?.getAnimations().find(
        ({ animationName }) => animationName === 'loading-poster-glide-in'
      );
      const progress = animation?.effect?.getComputedTiming?.().progress;
      const skip = document.querySelector('#loadingSkip');
      return skip
        && !skip.hidden
        && !skip.disabled
        && Number.isFinite(progress)
        && progress >= 0.22
        && progress <= 0.32;
    }, null, { timeout: 8_000 });

    await page.locator('#loadingSkip').click();
    await expect(page.locator('#loadingScreen')).toHaveAttribute('data-state', 'skipping');
    const skipSnapshot = await page.evaluate(() => window.__vinylSkipHandoffProbe.skipSnapshot);
    expect(skipSnapshot).toMatchObject({
      activeId: 'archive-01',
      activeOpacity: 1,
      glide: {
        playState: 'running',
        startTime: expect.any(Number)
      }
    });
    expect(skipSnapshot.glide.progress).toBeGreaterThanOrEqual(0.2);
    expect(skipSnapshot.glide.progress).toBeLessThan(0.9);

    await page.waitForFunction((skippedId) => {
      const active = document.querySelector(
        `[data-loading-slot="${skippedId}"].loading-frame.is-active.is-stable`
      );
      return active
        && !active.classList.contains('is-outgoing')
        && Number.parseFloat(getComputedStyle(active.querySelector('.loading-image')).opacity) >= 0.99;
    }, skipSnapshot.activeId, { timeout: 8_000 });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

    const waitingProbe = await page.evaluate(() => window.__vinylSkipHandoffProbe);
    const skippedSamples = waitingProbe.samples.filter((sample) => (
      sample.activeId === waitingProbe.skippedId
      && sample.at >= waitingProbe.skipAt
    ));
    const stableIndex = skippedSamples.findIndex(({ activeStable }) => activeStable);
    expect(stableIndex).toBeGreaterThanOrEqual(2);
    const arrivalSamples = skippedSamples.slice(0, stableIndex);
    const glideSamples = arrivalSamples.filter(({ glide }) => glide);
    expect(glideSamples.length).toBeGreaterThanOrEqual(2);
    expect(arrivalSamples.every(({ activeCount, activeClassName }) => (
      activeCount === 1
      && !activeClassName.includes('is-outgoing')
      && !activeClassName.includes('is-exiting')
    ))).toBe(true);
    expect(glideSamples.every(({ glide }) => (
      Math.abs(glide.startTime - skipSnapshot.glide.startTime) <= 0.01
      && ['running', 'finished'].includes(glide.playState)
    ))).toBe(true);

    const trajectorySamples = [skipSnapshot, ...glideSamples];
    const progressDeltas = trajectorySamples.slice(1).map((sample, index) => (
      sample.glide.progress - trajectorySamples[index].glide.progress
    ));
    const centerDeltas = trajectorySamples.slice(1).map((sample, index) => (
      sample.activeCenterY - trajectorySamples[index].activeCenterY
    ));
    const scaleDeltas = trajectorySamples.slice(1).map((sample, index) => (
      sample.activeScale - trajectorySamples[index].activeScale
    ));
    expect(progressDeltas.every((delta) => delta >= -0.005)).toBe(true);
    expect(centerDeltas.every((delta) => delta >= -0.5)).toBe(true);
    expect(scaleDeltas.every((delta) => delta >= -0.002)).toBe(true);
    expect(skippedSamples[stableIndex]).toMatchObject({
      activeId: skipSnapshot.activeId,
      activeCount: 1,
      activeStable: true
    });
    expect(delayedFinal.stats.pathnames.filter(
      (pathname) => pathname === FINAL_COVER_PATHNAME
    )).toHaveLength(1);

    delayedFinal.releaseFinal();
    await expect(page.locator('#loadingScreen')).toHaveCount(0, {
      timeout: LOADING_SETTLE_TIMEOUT_MS
    });
    await page.waitForFunction(() => (
      window.__vinylSkipHandoffProbe?.settledFrames >= 4
    ), null, { timeout: 5_000 });

    const finalProbe = await page.evaluate(() => window.__vinylSkipHandoffProbe);
    const settledTarget = finalProbe.samples.findLast((sample) => (
      !sample.rootConnected
      && sample.targetVisible
      && sample.targetActive
    ));
    expect(settledTarget).toBeTruthy();
    const handoffSamples = finalProbe.samples.filter(({ motion, sourceClip, targetRect }) => (
      motion && sourceClip && targetRect
    ));
    expect(handoffSamples.length).toBeGreaterThanOrEqual(8);
    const settledSource = handoffSamples.findLast(({ motion }) => motion.progress >= 0.82);
    expect(settledSource).toBeTruthy();
    expect(Math.hypot(
      settledSource.sourceClip.centerX - settledTarget.targetRect.centerX,
      settledSource.sourceClip.centerY - settledTarget.targetRect.centerY
    )).toBeLessThanOrEqual(1);
    expect(Math.abs(
      settledSource.sourceClip.width - settledTarget.targetRect.width
    )).toBeLessThanOrEqual(1);
    expect(Math.abs(
      settledSource.sourceClip.height - settledTarget.targetRect.height
    )).toBeLessThanOrEqual(1);

    expect(settledSource.sourceCrop).toBeTruthy();
    expect(settledTarget.targetCrop).toBeTruthy();
    const naturalDimensions = {
      left: finalProbe.finalNaturalWidth,
      top: finalProbe.finalNaturalHeight,
      width: finalProbe.finalNaturalWidth,
      height: finalProbe.finalNaturalHeight
    };
    for (const property of ['left', 'top', 'width', 'height']) {
      expect(
        Math.abs(settledSource.sourceCrop[property] - settledTarget.targetCrop[property])
          * naturalDimensions[property],
        `${property} crop changes during handoff`
      ).toBeLessThanOrEqual(1);
    }

    expect(finalProbe.samples.filter(({ overlap }) => overlap).length).toBeLessThanOrEqual(1);
    const firstVisibleTarget = finalProbe.samples.findIndex(({ targetVisible }) => targetVisible);
    expect(firstVisibleTarget).toBeGreaterThanOrEqual(0);
    expect(finalProbe.samples.slice(firstVisibleTarget + 1).every(({ sourceVisible }) => (
      !sourceVisible
    ))).toBe(true);

    expect(settledTarget.targetOpacity).toBeGreaterThanOrEqual(0.99);
    expect(settledTarget.targetArtwork).toContain(FINAL_COVER_PATHNAME);
    expect(settledTarget.targetBackgroundPosition).toBe('50% 50%');
    expect(settledTarget.targetBackgroundSize).toBe('cover');
    expect(new URL(settledSource.sourceArtwork).pathname).toBe(FINAL_COVER_PATHNAME);
    expect(delayedFinal.stats.pathnames.filter(
      (pathname) => pathname === FINAL_COVER_PATHNAME
    )).toHaveLength(1);
    await expect.poll(() => delayedFinal.stats.active).toBe(0);
  } finally {
    delayedFinal.releaseFinal();
  }
});

test('reduced handoff never exposes the source poster and target cover together', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-reduce');
  test.setTimeout(30_000);
  const delayedFinal = await installDelayedFinalCover(page);
  await installSkipHandoffContinuityProbe(page);

  try {
    await page.goto('./', { waitUntil: 'commit' });
    await expect(page.locator('#loadingSkip')).toBeVisible();
    await page.locator('#loadingSkip').click();
    delayedFinal.releaseFinal();
    await expect(page.locator('#loadingScreen')).toHaveCount(0, {
      timeout: LOADING_SETTLE_TIMEOUT_MS
    });
    await page.waitForFunction(() => window.__vinylSkipHandoffProbe?.settledFrames >= 4);

    const samples = await page.evaluate(() => window.__vinylSkipHandoffProbe.samples);
    expect(samples.filter(({ overlap }) => overlap)).toHaveLength(0);
    const firstVisibleTarget = samples.findIndex(({ targetVisible }) => targetVisible);
    expect(firstVisibleTarget).toBeGreaterThanOrEqual(0);
    expect(samples.slice(firstVisibleTarget).every(({ sourceVisible }) => !sourceVisible)).toBe(true);
  } finally {
    delayedFinal.releaseFinal();
  }
});

test('skip stays bottom-centered and clear of the fixed lower portal', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'mobile-chromium'].includes(testInfo.project.name));
  test.setTimeout(30_000);
  await installDeterministicCovers(page);
  await page.goto('./', { waitUntil: 'commit' });

  const loading = page.locator('#loadingScreen');
  const skip = page.locator('#loadingSkip');
  await expect(skip).toBeVisible();
  await expect(page.locator('#loadingCopy')).toHaveText('讯号接入中');
  await page.waitForFunction(() => {
    const root = document.querySelector('#loadingScreen');
    return root?.dataset.portalSide === 'bottom' && root.dataset.portalPhase === 'exit';
  });

  const readGeometry = () => page.evaluate(() => {
    const root = document.querySelector('#loadingScreen');
    const button = document.querySelector('#loadingSkip').getBoundingClientRect();
    const slit = document.querySelector('.loading-light-slit.is-lit').getBoundingClientRect();
    const copyStyle = getComputedStyle(document.querySelector('#loadingCopy'));
    const value = (name) => Number.parseFloat(root.style.getPropertyValue(name));
    return {
      button: {
        centerX: button.left + (button.width / 2),
        top: button.top,
        bottom: button.bottom,
        width: button.width,
        height: button.height
      },
      portal: {
        x: value('--gate-x'),
        y: value('--gate-y'),
        width: value('--gate-width'),
        height: value('--gate-height'),
        centerY: slit.top + (slit.height / 2)
      },
      viewport: { width: innerWidth, height: innerHeight },
      copyOpacity: Number.parseFloat(copyStyle.opacity)
    };
  });

  const firstBottom = await readGeometry();
  expect(Math.abs(firstBottom.button.centerX - (firstBottom.viewport.width / 2))).toBeLessThanOrEqual(1);
  expect(firstBottom.button.width).toBeGreaterThanOrEqual(88);
  expect(firstBottom.button.height).toBeGreaterThanOrEqual(44);
  expect(firstBottom.viewport.height - firstBottom.button.bottom).toBeGreaterThanOrEqual(17);
  expect(firstBottom.button.top - firstBottom.portal.centerY).toBeGreaterThanOrEqual(32);
  expect(firstBottom.copyOpacity).toBeGreaterThanOrEqual(0.5);

  await page.waitForFunction(() => document.querySelector('#loadingScreen')?.dataset.portalSide === 'top');
  await page.waitForFunction(() => document.querySelector('#loadingScreen')?.dataset.portalSide === 'bottom');
  const secondBottom = await readGeometry();
  for (const property of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(secondBottom.portal[property] - firstBottom.portal[property]), property)
      .toBeLessThanOrEqual(0.5);
  }

  await skip.click();
  await expect(loading).toHaveCount(0, { timeout: LOADING_SETTLE_TIMEOUT_MS });
});

test('skip jumps to end.jpg before handing off to the turntable', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'mobile-reduce'].includes(testInfo.project.name));
  test.setTimeout(30_000);
  const stats = await installDeterministicCovers(page);
  await page.goto('./', { waitUntil: 'commit' });

  const loading = page.locator('#loadingScreen');
  const skip = page.locator('#loadingSkip');
  await expect(skip).toBeVisible();
  await expect(page.locator('#loadingCopy')).toHaveText('讯号接入中');
  await skip.click();
  await expect(skip).toBeHidden();
  await expect(page.locator('#loadingCopy')).toHaveText('讯号接入中');

  await page.waitForFunction(() => {
    const final = document.querySelector('[data-loading-slot="archive-10"].is-active');
    const image = final?.querySelector('.loading-image');
    if (!image) return false;
    return new URL(image.currentSrc || image.src).pathname === '/covers/end.jpg';
  }, null, { timeout: 12_000 });

  await expect(loading).toHaveCount(0, { timeout: LOADING_SETTLE_TIMEOUT_MS });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#vinylCoverA')).toHaveAttribute(
    'style',
    /\/covers\/end\.jpg/
  );
  await expect(page.locator('#vinylCoverA')).toHaveCSS('opacity', '1');
  await expect.poll(() => stats.active).toBe(0);
  expect(stats.pathnames).toContain(FINAL_COVER_PATHNAME);
  expect(stats.pathnames.filter((pathname) => pathname !== FINAL_COVER_PATHNAME).length)
    .toBeLessThan(EXPECTED_ARCHIVE_IDS.length - 1);
  expect(stats.unknownPathnames).toEqual([]);
});

test('captures the loading poster visual', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
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

  await expect(loading).toHaveCount(0, { timeout: LOADING_SETTLE_TIMEOUT_MS });
  await expect.poll(() => stats.active).toBe(0);
  expectExactCoverRequests(stats, {
    expectFinalPrewarm: testInfo.project.name === 'mobile-reduce'
  });
});
