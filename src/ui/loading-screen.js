import { CriticalAssetError } from '../media/asset-loader.js';
import { createLightParticleField } from './light-particle-field.js';
import { POSTER_TIMING, createPosterTransition } from './poster-transition.js';

export const LOADING_PRELUDE_TIMING = Object.freeze({
  full: 1200,
  compact: 900,
  reduce: 120
});

export const FINAL_HANDOFF_TIMING = Object.freeze({
  full: Object.freeze({ morph: 1280, revealAt: 486, playerReveal: 794, backdropExit: 1280 }),
  compact: Object.freeze({ morph: 920, revealAt: 350, playerReveal: 570, backdropExit: 920 }),
  reduce: Object.freeze({ finalHold: 500, crossfade: 120 })
});

const twoDigits = (value) => String(value).padStart(2, '0');

const VISUAL_SLOT_CLASSES = Object.freeze([
  'is-ready',
  'is-failed',
  'is-active',
  'is-outgoing',
  'is-revealing',
  'is-scattering',
  'is-entering',
  'is-entering-from-portal',
  'is-exiting',
  'is-exiting-to-portal',
  'is-stable'
]);
const LOADING_COPY = '讯号接入中';

export class VisualTransitionError extends Error {
  constructor(cause) {
    super('Loading visual transition failed');
    this.name = 'VisualTransitionError';
    this.cause = cause;
  }
}

const createNoopParticleField = (initialProfile) => {
  let profile = initialProfile;
  let destroyed = false;
  const settle = () => Promise.resolve();

  return {
    gather: settle,
    scatter: settle,
    finish: settle,
    resize() {},
    setProfile(nextProfile) {
      if (!destroyed) profile = nextProfile;
    },
    clear() {},
    destroy() {
      destroyed = true;
    },
    getState: () => ({ profile, particleCount: 0, animating: false, destroyed })
  };
};

const waitForTransition = (element, {
  propertyName = 'opacity',
  timeoutMs = 560,
  signal,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;

  const cleanup = () => {
    clearTimer(timer);
    element.removeEventListener('transitionend', handleTransitionEnd);
    signal?.removeEventListener('abort', handleAbort);
  };
  const finish = (completed) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(completed);
  };
  const handleTransitionEnd = (event) => {
    if (event.target !== element || event.propertyName !== propertyName) return;
    finish(true);
  };
  const handleAbort = () => finish(false);

  if (signal?.aborted) {
    finish(false);
    return;
  }
  timer = setTimer(() => finish(true), timeoutMs);
  element.addEventListener('transitionend', handleTransitionEnd);
  signal?.addEventListener('abort', handleAbort, { once: true });
});

const waitForDelay = (delay, {
  signal,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;

  const cleanup = () => {
    clearTimer(timer);
    signal?.removeEventListener('abort', handleAbort);
  };
  const finish = (completed) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(completed);
  };
  const handleAbort = () => finish(false);

  if (signal?.aborted) {
    finish(false);
    return;
  }
  if (delay <= 0) {
    finish(true);
    return;
  }
  timer = setTimer(() => finish(true), delay);
  signal?.addEventListener('abort', handleAbort, { once: true });
});

const waitForAnimation = (element, animationName, {
  timeoutMs,
  signal,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;
  const cleanup = () => {
    clearTimer(timer);
    element.removeEventListener('animationend', handleAnimationEnd);
    signal?.removeEventListener('abort', handleAbort);
  };
  const finish = (completed) => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve(completed);
  };
  const handleAnimationEnd = (event) => {
    if (event.target !== element || event.animationName !== animationName) return;
    finish(true);
  };
  const handleAbort = () => finish(false);

  if (signal?.aborted) {
    finish(false);
    return;
  }
  element.addEventListener('animationend', handleAnimationEnd);
  signal?.addEventListener('abort', handleAbort, { once: true });
  timer = setTimer(() => finish(true), timeoutMs);
});

const waitForPortalOpacityZero = (root, portal, {
  profile,
  windowRef,
  signal,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;
  const opacityIsZero = () => {
    const style = windowRef?.getComputedStyle?.(portal);
    return (Number.parseFloat(style?.opacity ?? portal.style?.opacity) || 0) <= 0.001;
  };
  const cleanup = () => {
    clearTimer(timer);
    portal.removeEventListener('animationend', handleAnimationEnd);
    signal?.removeEventListener('abort', handleAbort);
  };
  const finish = (completed) => {
    if (!completed) {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(false);
      return;
    }
    if (settled || !opacityIsZero()) return;
    settled = true;
    cleanup();
    resolve(true);
  };
  const handleAnimationEnd = (event) => {
    if (
      event.target !== portal
      || event.animationName !== 'loading-final-tunnel'
    ) return;
    finish(true);
  };
  const handleAbort = () => finish(false);

  if (signal?.aborted) {
    finish(false);
    return;
  }
  portal.addEventListener('animationend', handleAnimationEnd);
  signal?.addEventListener('abort', handleAbort, { once: true });
  if (opacityIsZero() && !root.classList.contains('is-final-resolving')) {
    finish(true);
    return;
  }

  const timing = POSTER_TIMING[profile];
  const finalTail = timing.finalResolve - timing.exitLead;
  timer = setTimer(() => {
    if (signal?.aborted) return;
    portal.style.animation = 'none';
    portal.style.opacity = '0';
    finish(true);
  }, finalTail + 80);
});

export function createLoadingScreen(documentRef = document, {
  motionProfile = 'compact',
  particleFactory = createLightParticleField,
  transitionFactory = createPosterTransition,
  loadingPrelude = true,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onSkip = () => {}
} = {}) {
  const root = documentRef.querySelector('#loadingScreen');
  const progress = documentRef.querySelector('#loadingProgress');
  const copy = documentRef.querySelector('#loadingCopy');
  const retry = documentRef.querySelector('#loadingRetry');
  const skip = documentRef.querySelector('#loadingSkip');
  const canvas = documentRef.querySelector('#loadingParticles');
  const topPortal = documentRef.querySelector('#loadingTopPortal, #loadingLightSlit');
  const bottomPortal = documentRef.querySelector('#loadingLightSlit, #loadingBottomPortal') ?? topPortal;
  const requiredNodes = {
    loadingScreen: root,
    loadingProgress: progress,
    loadingCopy: copy,
    loadingRetry: retry,
    loadingSkip: skip,
    loadingParticles: canvas,
    loadingTopPortal: topPortal,
    loadingBottomPortal: bottomPortal
  };
  const missingNodes = Object.entries(requiredNodes)
    .filter(([, node]) => !node)
    .map(([name]) => `#${name}`);
  if (missingNodes.length > 0) {
    throw new TypeError(`Loading screen is missing required nodes: ${missingNodes.join(', ')}`);
  }
  const slotNodes = [...root.querySelectorAll('[data-loading-slot]')];
  if (slotNodes.length === 0) {
    throw new TypeError('Loading screen requires at least one loading slot');
  }
  const totalSlots = slotNodes.length;
  const finalSlot = slotNodes.at(-1);
  const slots = new Map(
    slotNodes
      .map((slot) => [slot.dataset.loadingSlot, slot])
  );
  let visualQueueError = null;
  const windowRef = documentRef.defaultView;
  const requestFrame = windowRef?.requestAnimationFrame?.bind(windowRef)
    ?? ((callback) => setTimer(callback, 16));
  const cancelFrame = windowRef?.cancelAnimationFrame?.bind(windowRef) ?? clearTimer;
  let handoffFrame = null;
  let committedCoverFrame = null;
  let handoffGeneration = 0;
  let handoffRun = null;
  let pendingFallbackCompletion = null;

  const measureRevealedTarget = (target, appShell) => {
    if (
      !appShell?.classList
      || !appShell?.style
      || typeof appShell.getBoundingClientRect !== 'function'
    ) return target.getBoundingClientRect();

    const wasRevealed = appShell.classList.contains('is-loading-reveal');
    if (wasRevealed) return target.getBoundingClientRect();

    const inlineTransition = appShell.style.transition;
    appShell.style.transition = 'none';
    appShell.classList.add('is-loading-reveal');
    const revealedRect = target.getBoundingClientRect();

    appShell.classList.remove('is-loading-reveal');
    appShell.getBoundingClientRect();
    if (inlineTransition) appShell.style.transition = inlineTransition;
    else appShell.style.removeProperty('transition');
    return revealedRect;
  };

  const clearHandoffGeometry = () => {
    delete root.dataset.handoffPhase;
    handoffGeneration += 1;
    if (handoffFrame !== null) {
      cancelFrame(handoffFrame);
      handoffFrame = null;
    }
    if (committedCoverFrame !== null) {
      cancelFrame(committedCoverFrame);
      committedCoverFrame = null;
    }
    delete root.dataset.handoffReady;
    delete root.dataset.handoffSettled;
    root.style.removeProperty('--loading-handoff-morph-ms');
    root.style.removeProperty('--loading-player-reveal-delay-ms');
    root.style.removeProperty('--loading-player-reveal-ms');
    root.style.removeProperty('--poster-final-x');
    root.style.removeProperty('--poster-final-y');
    root.style.removeProperty('--poster-final-scale');
    root.style.removeProperty('--poster-final-radius');
    root.style.removeProperty('--poster-source-inset-top');
    root.style.removeProperty('--poster-source-inset-right');
    root.style.removeProperty('--poster-source-inset-bottom');
    root.style.removeProperty('--poster-source-inset-left');
    root.style.removeProperty('--poster-final-inset-top');
    root.style.removeProperty('--poster-final-inset-right');
    root.style.removeProperty('--poster-final-inset-bottom');
    root.style.removeProperty('--poster-final-inset-left');
  };

  const clearPlayerReveal = ({ preserveTarget = false, targetCover = null } = {}) => {
    const appShell = documentRef.querySelector('#appShell');
    appShell?.classList.remove('is-loading-reveal');
    if (appShell) {
      delete appShell.dataset.loadingHandoff;
      appShell.style.removeProperty('--loading-player-reveal-ms');
      appShell.style.removeProperty('--loading-player-reveal-delay-ms');
    }

    const targetCovers = new Set(documentRef.querySelectorAll(
      '.vinyl-cover[data-loading-handoff="true"], .vinyl-cover[data-loading-prewarm="true"]'
    ));
    if (targetCover) targetCovers.add(targetCover);
    targetCovers.forEach((cover) => {
      delete cover.dataset.loadingHandoff;
      delete cover.dataset.loadingPrewarm;
      if (preserveTarget && cover === targetCover && cover.classList.contains('is-active')) {
        const cleanupGeneration = handoffGeneration;
        committedCoverFrame = requestFrame(() => {
          committedCoverFrame = null;
          if (
            cleanupGeneration !== handoffGeneration
            || !cover.isConnected
            || !cover.classList.contains('is-active')
          ) return;
          cover.style.removeProperty('animation');
          cover.style.removeProperty('transition');
          cover.style.removeProperty('opacity');
          cover.style.removeProperty('transform');
        });
        return;
      }
      cover.style.removeProperty('animation');
      cover.style.removeProperty('transition');
      cover.style.removeProperty('opacity');
      cover.style.removeProperty('transform');
      cover.classList.remove('is-active');
      cover.style.removeProperty('background-image');
    });
  };

  const clearFinalHandoff = () => {
    const activeRun = handoffRun;
    handoffRun = null;
    activeRun?.controller.abort();
    activeRun?.settle(false);
    clearHandoffGeometry();

    root.querySelectorAll('.loading-image[data-loading-handoff="true"]')
      .forEach((source) => delete source.dataset.loadingHandoff);
    clearPlayerReveal({ targetCover: activeRun?.targetCover });
  };

  const completeFinalHandoff = () => {
    const completedRun = handoffRun;
    if (!completedRun) return;
    handoffRun = null;
    clearHandoffGeometry();
    delete completedRun.source.dataset.loadingHandoff;
    clearPlayerReveal({ preserveTarget: true, targetCover: completedRun.targetCover });
  };

  const completeFallbackHandoff = (targetCover) => {
    clearHandoffGeometry();
    root.querySelectorAll('.loading-image[data-loading-handoff="true"]')
      .forEach((source) => delete source.dataset.loadingHandoff);
    clearPlayerReveal({
      preserveTarget: Boolean(targetCover?.classList.contains('is-active')),
      targetCover
    });
  };

  const prewarmTargetCover = (source) => {
    const targetCover = documentRef.querySelector('#vinylCoverA');
    const artworkSource = source?.currentSrc || source?.src;
    if (!targetCover || !artworkSource) return;
    targetCover.style.backgroundImage = `url(${JSON.stringify(artworkSource)})`;
    targetCover.dataset.loadingPrewarm = 'true';
  };

  const createHandoffRun = ({
    profile,
    source,
    sourceFrame,
    sourceFrameRect,
    targetRect,
    finalGeometry,
    targetCover,
    appShell,
    timing
  }) => {
    const controller = new AbortController();
    let settled = false;
    let resolveBarrier;
    const barrier = new Promise((resolve) => { resolveBarrier = resolve; });
    const run = {
      profile,
      source,
      sourceFrame,
      sourceFrameRect,
      targetRect,
      finalGeometry,
      targetCover,
      appShell,
      timing,
      controller,
      barrier,
      settle(completed) {
        if (settled) return;
        settled = true;
        resolveBarrier(completed);
      }
    };
    return run;
  };

  // Keep the same decoded <img> node after the loading root is removed so the
  // player never exposes a second rasterization of the final artwork.
  const createResidentPoster = (run) => {
    if (
      !run
      || run.profile === 'reduce'
      || !run.source
      || !run.sourceFrameRect
      || !run.targetRect
      || run.sourceFrameRect.width <= 0
      || run.sourceFrameRect.height <= 0
    ) return null;

    documentRef.querySelector('#loadingHandoffResident')?.remove();

    const source = run.source;
    const frameRect = run.sourceFrameRect;
    const targetRect = run.targetRect;
    const centerX = targetRect.left + (targetRect.width / 2);
    const centerY = targetRect.top + (targetRect.height / 2);
    const radius = Math.min(targetRect.width, targetRect.height) / 2;
    const computed = windowRef?.getComputedStyle?.(source);
    const geometry = run.finalGeometry || {};
    const readComputed = (property, fallback = '') => {
      const value = computed?.[property];
      return value && value !== 'normal' ? value : fallback;
    };
    const fallbackTransform = geometry.transform
      || 'translate3d(0, 0, 0) scale(1)';
    const fallbackClipPath = geometry.clipPath || 'inset(0 round 999px)';
    const fallbackOpacity = readComputed('opacity', '1');

    const layer = documentRef.createElement('div');
    layer.id = 'loadingHandoffResident';
    layer.className = 'loading-handoff-resident';
    layer.setAttribute('aria-hidden', 'true');
    layer.dataset.ringState = 'entering';
    layer.dataset.centerX = String(centerX);
    layer.dataset.centerY = String(centerY);
    layer.dataset.radius = String(radius);
    layer.dataset.sourceCenterX = String(frameRect.left + (frameRect.width / 2));
    layer.dataset.sourceCenterY = String(frameRect.top + (frameRect.height / 2));
    layer.dataset.handoffSquare = String(geometry.handoffSquare || (radius * 2));
    layer.style.setProperty('--handoff-center-x', `${centerX}px`);
    layer.style.setProperty('--handoff-center-y', `${centerY}px`);
    layer.style.setProperty('--handoff-radius', `${radius}px`);
    layer.style.setProperty('--handoff-diameter', `${radius * 2}px`);
    layer.style.clipPath = `circle(${radius}px at ${centerX}px ${centerY}px)`;

    const hole = documentRef.createElement('span');
    hole.className = 'loading-handoff-resident-hole';
    hole.setAttribute('aria-hidden', 'true');
    layer.append(hole);

    const sourceStyles = {
      objectFit: readComputed('objectFit', 'contain'),
      objectPosition: readComputed('objectPosition', '50% 50%'),
      borderRadius: readComputed('borderRadius', '0px'),
      filter: readComputed('filter', 'none'),
      transformOrigin: readComputed('transformOrigin', '50% 50%'),
      backfaceVisibility: readComputed('backfaceVisibility', 'hidden'),
      opacity: fallbackOpacity,
      transform: readComputed('transform', fallbackTransform),
      clipPath: readComputed('clipPath', fallbackClipPath)
    };

    source.classList.remove('loading-image');
    source.classList.add('loading-handoff-resident-image');
    source.style.position = 'fixed';
    source.style.inset = 'auto';
    source.style.left = `${frameRect.left}px`;
    source.style.top = `${frameRect.top}px`;
    source.style.width = `${frameRect.width}px`;
    source.style.height = `${frameRect.height}px`;
    source.style.zIndex = '1';
    source.style.margin = '0';
    source.style.objectFit = sourceStyles.objectFit;
    source.style.objectPosition = sourceStyles.objectPosition;
    source.style.borderRadius = sourceStyles.borderRadius;
    source.style.filter = sourceStyles.filter;
    source.style.transformOrigin = sourceStyles.transformOrigin;
    source.style.backfaceVisibility = sourceStyles.backfaceVisibility;
    source.style.opacity = sourceStyles.opacity;
    source.style.transform = sourceStyles.transform;
    source.style.clipPath = sourceStyles.clipPath;
    source.style.animation = 'none';
    source.style.transition = 'none';
    layer.append(source);

    const host = documentRef.body || root.parentElement;
    if (!host) return null;
    host.append(layer);
    documentRef.body?.setAttribute('data-loading-handoff-resident', 'true');
    return { element: layer, source, initialClipPath: layer.style.clipPath };
  };

  const beginPlayerReveal = (run) => {
    if (
      handoffRun !== run
      || run.controller.signal.aborted
      || !root.isConnected
    ) return false;

    root.dataset.handoffPhase = run.profile === 'reduce' ? 'player-reveal' : 'morphing';
    run.appShell.dataset.loadingHandoff = 'true';
    run.appShell.classList.add('is-loading-reveal');
    if (run.profile !== 'reduce') return true;

    root.classList.add('is-final-resolving', 'is-exiting');
    return true;
  };

  const startAnimatedHandoff = (run) => {
    const { signal } = run.controller;
    const { timing } = run;
    root.style.setProperty('--final-resolve-ms', `${timing.morph}ms`);
    root.style.setProperty('--loading-handoff-morph-ms', `${timing.morph}ms`);
    root.style.setProperty('--loading-player-reveal-delay-ms', `${timing.revealAt}ms`);
    root.style.setProperty('--loading-player-reveal-ms', `${timing.playerReveal}ms`);
    run.appShell.style.setProperty('--loading-player-reveal-delay-ms', `${timing.revealAt}ms`);
    run.appShell.style.setProperty('--loading-player-reveal-ms', `${timing.playerReveal}ms`);

    // Start the player reveal before exposing the source so both layers share
    // the same composited handoff frame.
    if (!beginPlayerReveal(run)) {
      run.settle(false);
      return;
    }
    run.source.dataset.loadingHandoff = 'true';
    root.dataset.handoffReady = 'true';
    root.dataset.handoffPhase = 'morphing';

    const options = { signal, setTimer, clearTimer };
    const morphWork = waitForAnimation(
      run.source,
      'loading-poster-to-player-motion',
      { ...options, timeoutMs: timing.morph + 80 }
    );
    const backdropWork = waitForDelay(timing.backdropExit, options);
    const playerWork = waitForDelay(timing.morph, options);

    void Promise.all([morphWork, playerWork, backdropWork])
      .then((results) => {
        const completed = results.every(Boolean)
          && handoffRun === run
          && !signal.aborted
          && root.isConnected;
        if (completed) {
          root.dataset.handoffSettled = 'true';
          root.dataset.handoffPhase = 'settled';
        }
        run.settle(completed);
      });
  };

  const prepareReducedHandoff = () => {
    clearFinalHandoff();
    const source = finalSlot.querySelector('img');
    const targetCover = documentRef.querySelector('#vinylCoverA');
    const appShell = documentRef.querySelector('#appShell');
    const artworkSource = source?.currentSrc || source?.src;
    if (!source || !targetCover || !appShell || !artworkSource) return null;

    const timing = FINAL_HANDOFF_TIMING.reduce;
    source.dataset.loadingHandoff = 'true';
    targetCover.classList.remove('is-active');
    targetCover.style.backgroundImage = `url(${JSON.stringify(artworkSource)})`;
    targetCover.dataset.loadingPrewarm = 'true';
    targetCover.dataset.loadingHandoff = 'true';
    appShell.style.setProperty('--loading-player-reveal-ms', `${timing.crossfade}ms`);
    root.style.setProperty('--loading-player-reveal-ms', `${timing.crossfade}ms`);
    root.dataset.handoffReady = 'true';
    root.dataset.handoffPhase = 'final-hold';

    const run = createHandoffRun({
      profile: 'reduce', source, targetCover, appShell, timing
    });
    handoffRun = run;
    const options = { signal: run.controller.signal, setTimer, clearTimer };
    void (async () => {
      if (!await waitForDelay(timing.finalHold, options)) {
        run.settle(false);
        return;
      }
      if (!beginPlayerReveal(run)) {
        run.settle(false);
        return;
      }
      const results = await Promise.all([
        waitForDelay(timing.crossfade, options),
        waitForDelay(timing.crossfade, options),
        waitForDelay(timing.crossfade, options)
      ]);
      const completed = results.every(Boolean)
        && handoffRun === run
        && !run.controller.signal.aborted
        && root.isConnected;
      if (completed) {
        root.dataset.handoffSettled = 'true';
        root.dataset.handoffPhase = 'settled';
      }
      run.settle(completed);
    })();
    return run;
  };

  const commitFinalHandoff = (run) => {
    if (!run || handoffRun !== run || run.controller.signal.aborted || !root.isConnected) {
      return false;
    }
    run.targetCover.style.animation = 'none';
    run.targetCover.style.transition = 'none';
    run.targetCover.style.opacity = '1';
    run.targetCover.style.transform = 'scale(1) rotate(0deg)';
    run.targetCover.style.backgroundPosition = 'center';
    run.targetCover.style.backgroundSize = 'cover';
    run.targetCover.classList.add('is-active');
    createResidentPoster(run);
    delete run.targetCover.dataset.loadingHandoff;
    delete run.targetCover.dataset.loadingPrewarm;
    delete run.source.dataset.loadingHandoff;
    root.dataset.handoffPhase = 'complete';
    return true;
  };

  const prepareFinalHandoff = (profile, source) => {
    clearFinalHandoff();
    skip.disabled = true;
    skip.hidden = true;
    if (!source) return;
    prewarmTargetCover(source);
    if (profile === 'reduce') return;

    const sourceFrame = source.closest?.('.loading-frame') ?? source;
    const target = documentRef.querySelector('.vinyl-sticker');
    const targetCover = documentRef.querySelector('#vinylCoverA');
    const appShell = documentRef.querySelector('#appShell');
    const timing = FINAL_HANDOFF_TIMING[profile];
    if (!target || !targetCover || !appShell || !timing) return;

    const sourceRect = sourceFrame.getBoundingClientRect();
    const targetRect = measureRevealedTarget(target, appShell);
    const naturalWidth = Number(source.naturalWidth);
    const naturalHeight = Number(source.naturalHeight);
    if (
      sourceRect.width <= 0
      || sourceRect.height <= 0
      || targetRect.width <= 0
      || targetRect.height <= 0
      || naturalWidth <= 0
      || naturalHeight <= 0
    ) return;

    const containRatio = Math.min(
      sourceRect.width / naturalWidth,
      sourceRect.height / naturalHeight
    );
    const artworkWidth = naturalWidth * containRatio;
    const artworkHeight = naturalHeight * containRatio;
    const handoffSquare = Math.min(artworkWidth, artworkHeight);

    const sourceCenterX = sourceRect.left + (sourceRect.width / 2);
    const sourceCenterY = sourceRect.top + (sourceRect.height / 2);
    const targetCenterX = targetRect.left + (targetRect.width / 2);
    const targetCenterY = targetRect.top + (targetRect.height / 2);
    const scale = Math.max(0.08, Math.min(
      0.82,
      targetRect.width / handoffSquare,
      targetRect.height / handoffSquare
    ));

    const asPercent = (value, total) => `${((value / total) * 100).toFixed(4)}%`;
    const sourceInsetX = Math.max(0, (sourceRect.width - artworkWidth) / 2);
    const sourceInsetY = Math.max(0, (sourceRect.height - artworkHeight) / 2);
    const finalInsetX = Math.max(0, (sourceRect.width - handoffSquare) / 2);
    const finalInsetY = Math.max(0, (sourceRect.height - handoffSquare) / 2);

    root.style.setProperty('--poster-final-x', `${targetCenterX - sourceCenterX}px`);
    root.style.setProperty('--poster-final-y', `${targetCenterY - sourceCenterY}px`);
    root.style.setProperty('--poster-final-scale', String(scale));
    root.style.setProperty('--poster-final-radius', `${handoffSquare / 2}px`);
    root.style.setProperty('--poster-source-inset-top', asPercent(sourceInsetY, sourceRect.height));
    root.style.setProperty('--poster-source-inset-right', asPercent(sourceInsetX, sourceRect.width));
    root.style.setProperty('--poster-source-inset-bottom', asPercent(sourceInsetY, sourceRect.height));
    root.style.setProperty('--poster-source-inset-left', asPercent(sourceInsetX, sourceRect.width));
    root.style.setProperty('--poster-final-inset-top', asPercent(finalInsetY, sourceRect.height));
    root.style.setProperty('--poster-final-inset-right', asPercent(finalInsetX, sourceRect.width));
    root.style.setProperty('--poster-final-inset-bottom', asPercent(finalInsetY, sourceRect.height));
    root.style.setProperty('--poster-final-inset-left', asPercent(finalInsetX, sourceRect.width));

    const artworkSource = source.currentSrc || source.src;
    if (!artworkSource) return;

    targetCover.classList.remove('is-active');
    targetCover.style.backgroundImage = `url(${JSON.stringify(artworkSource)})`;
    targetCover.dataset.loadingPrewarm = 'true';
    targetCover.dataset.loadingHandoff = 'true';
    appShell.style.setProperty('--loading-player-reveal-ms', `${timing.playerReveal}ms`);
    const run = createHandoffRun({
      profile,
      source,
      sourceFrame,
      sourceFrameRect: sourceRect,
      targetRect,
      finalGeometry: {
        transform: `translate3d(${targetCenterX - sourceCenterX}px, ${targetCenterY - sourceCenterY}px, 0) scale(${scale})`,
        clipPath: `inset(${asPercent(finalInsetY, sourceRect.height)} ${asPercent(finalInsetX, sourceRect.width)} ${asPercent(finalInsetY, sourceRect.height)} ${asPercent(finalInsetX, sourceRect.width)} round ${handoffSquare / 2}px)`,
        handoffSquare
      },
      targetCover,
      appShell,
      timing
    });
    handoffRun = run;
    const generation = ++handoffGeneration;
    handoffFrame = requestFrame(() => {
      handoffFrame = null;
      if (
        generation !== handoffGeneration
        || handoffRun !== run
        || run.controller.signal.aborted
        || !root.isConnected
      ) {
        run.settle(false);
        return;
      }
      startAnimatedHandoff(run);
    });
  };

  let particleField;
  try {
    particleField = particleFactory({
      canvas,
      documentRef,
      windowRef: documentRef.defaultView,
      profile: motionProfile
    });
  } catch (error) {
    if (!(error instanceof TypeError) || !/2D canvas context/i.test(error.message)) throw error;
    particleField = createNoopParticleField(motionProfile);
  }
  const transition = transitionFactory({
    root,
    portals: { top: topPortal, bottom: bottomPortal },
    particleField,
    profile: motionProfile,
    onFinalScene({ image, profile }) {
      prepareFinalHandoff(profile, image);
    },
    onError(error) {
      visualQueueError ||= error;
    }
  });
  let resizeFrame = null;
  let resizeObserver = null;
  let exitGeneration = 0;
  let exitController = null;
  let controllersDestroyed = false;
  let destroyed = false;
  let currentMotionProfile = motionProfile;
  let transitionRevision = 0;
  let skipRequested = false;
  let nextVisualSlotIndex = 0;
  const admittedSlots = new Set();
  let preludeGeneration = 0;
  let preludeTimer = null;
  let preludeSettled = true;
  let preludeMinimumElapsed = true;
  let resolvePrelude = () => {};
  let preludeReady = Promise.resolve();

  const cancelLoadingPrelude = ({ settle = false } = {}) => {
    preludeGeneration += 1;
    if (preludeTimer !== null) clearTimer(preludeTimer);
    preludeTimer = null;
    resolvePrelude();
    resolvePrelude = () => {};
    if (settle) {
      preludeSettled = true;
      preludeMinimumElapsed = true;
    }
  };

  const settleLoadingPrelude = () => {
    if (
      preludeSettled
      || !preludeMinimumElapsed
      || !slotNodes[0]?.querySelector('img')
      || root.dataset.state === 'error'
    ) return false;
    preludeSettled = true;
    root.dataset.preludeState = 'settled';
    root.classList.remove('is-loading-prelude');
    root.classList.add('is-prelude-settled');
    if (!skipRequested) skip.disabled = false;
    resolvePrelude();
    resolvePrelude = () => {};
    enqueueReadyVisuals();
    return true;
  };

  const beginLoadingPrelude = (profile = currentMotionProfile) => {
    cancelLoadingPrelude();
    preludeSettled = false;
    preludeMinimumElapsed = false;
    preludeReady = new Promise((resolve) => { resolvePrelude = resolve; });
    root.classList.remove('is-prelude-settled');

    if (!loadingPrelude) {
      preludeSettled = true;
      preludeMinimumElapsed = true;
      root.dataset.preludeState = 'settled';
      root.classList.remove('is-loading-prelude');
      root.classList.add('is-prelude-settled');
      if (!skipRequested) skip.disabled = false;
      resolvePrelude();
      resolvePrelude = () => {};
      return;
    }

    const duration = LOADING_PRELUDE_TIMING[profile] ?? LOADING_PRELUDE_TIMING.compact;
    const generation = preludeGeneration;
    root.dataset.preludeState = 'playing';
    root.classList.add('is-loading-prelude');
    skip.disabled = true;
    preludeTimer = setTimer(() => {
      if (destroyed || generation !== preludeGeneration || root.dataset.state === 'error') return;
      preludeTimer = null;
      preludeMinimumElapsed = true;
      settleLoadingPrelude();
    }, duration);
  };

  const applyMotionProfile = (nextProfile) => {
    const profileChanged = nextProfile !== currentMotionProfile;
    transition.setProfile(nextProfile);
    currentMotionProfile = nextProfile;
    if (profileChanged && !preludeSettled) beginLoadingPrelude(nextProfile);
    if (profileChanged && nextProfile === 'reduce') {
      clearFinalHandoff();
      if (skipRequested) {
        prewarmTargetCover(finalSlot.querySelector('img'));
      }
    }
  };

  const cancelExit = ({ clearFallback = false } = {}) => {
    exitGeneration += 1;
    exitController?.abort();
    exitController = null;
    root.classList.remove('is-exiting');
    if (!clearFallback) return;
    pendingFallbackCompletion = null;
    for (const portal of [topPortal, bottomPortal]) {
      portal.style.removeProperty('animation');
      portal.style.removeProperty('opacity');
    }
  };

  const destroyControllers = () => {
    if (controllersDestroyed) return;
    controllersDestroyed = true;
    try {
      transition.destroy();
    } catch {}
    try {
      particleField.destroy();
    } catch {}
  };

  const scheduleParticleResize = () => {
    if (destroyed || resizeFrame !== null) return;
    resizeFrame = requestFrame(() => {
      resizeFrame = null;
      if (destroyed) return;
      particleField.resize();
      transition.resize?.();
    });
  };
  const connectResizeObserver = () => {
    if (destroyed || resizeObserver || typeof windowRef?.ResizeObserver !== 'function') return;
    resizeObserver = new windowRef.ResizeObserver(scheduleParticleResize);
    resizeObserver.observe(canvas);
  };
  const disconnectResizeObserver = () => {
    resizeObserver?.disconnect();
    resizeObserver = null;
    if (resizeFrame === null) return;
    cancelFrame(resizeFrame);
    resizeFrame = null;
  };
  connectResizeObserver();

  const mountImage = (result) => {
    const slot = slots.get(result.id);
    if (!slot) return null;
    const existingImage = slot.querySelector('img');
    if (skipRequested && slot !== finalSlot) return slot;
    if (existingImage && (admittedSlots.has(slot) || skipRequested)) {
      if (slot === finalSlot) {
        prewarmTargetCover(existingImage);
      }
      return slot;
    }
    slot.querySelector('img')?.remove();
    let artworkViewport = slot.querySelector('.loading-artwork-viewport');
    if (!artworkViewport) {
      artworkViewport = documentRef.createElement('span');
      artworkViewport.className = 'loading-artwork-viewport';
      artworkViewport.setAttribute('aria-hidden', 'true');
      slot.insertBefore(artworkViewport, slot.firstChild);
    }
    result.image.alt = result.alt;
    result.image.className = 'loading-image';
    result.image.dataset.assetId = result.id;
    result.image.setAttribute('aria-hidden', 'true');
    artworkViewport.replaceChildren(result.image);
    if (slot === finalSlot) {
      prewarmTargetCover(result.image);
    }
    return slot;
  };

  const enqueueVisual = (slot) => {
    if (!slot || admittedSlots.has(slot)) return;
    admittedSlots.add(slot);
    try {
      transition.enqueue(slot);
    } catch (error) {
      visualQueueError ||= error;
    }
  };

  const enqueueReadyVisuals = () => {
    if (!preludeSettled) return;
    if (skipRequested) {
      if (finalSlot.querySelector('img')) enqueueVisual(finalSlot);
      return;
    }

    while (nextVisualSlotIndex < slotNodes.length) {
      const slot = slotNodes[nextVisualSlotIndex];
      if (slot.dataset.status !== 'ready' || !slot.querySelector('img')) return;
      enqueueVisual(slot);
      nextVisualSlotIndex += 1;
    }
  };

  const requestSkip = () => {
    if (destroyed || skipRequested || root.dataset.state === 'error') return;
    const finalImage = finalSlot.querySelector('img');
    const activeId = transition.getState?.().activeId;
    const activeSlot = slots.get(activeId)
      ?? root.querySelector('.loading-frame.is-active, .loading-frame.is-outgoing');
    const finalIsCurrent = activeSlot === finalSlot;
    skipRequested = true;
    transitionRevision += 1;
    root.dataset.state = 'skipping';
    root.dataset.skipRequested = 'true';
    copy.textContent = LOADING_COPY;
    skip.disabled = true;
    skip.hidden = true;
    cancelExit({ clearFallback: true });
    if (!finalIsCurrent) clearFinalHandoff();
    nextVisualSlotIndex = slotNodes.length;
    admittedSlots.clear();
    if (activeSlot) admittedSlots.add(activeSlot);
    const finalQueued = transition.skipTo(finalSlot);
    if (finalQueued) admittedSlots.add(finalSlot);
    onSkip();
    if (finalImage) {
      prewarmTargetCover(finalImage);
      if (!finalIsCurrent) enqueueReadyVisuals();
    }
  };

  skip.onclick = requestSkip;

  const view = {
    reset() {
      if (destroyed) return;
      transitionRevision += 1;
      skipRequested = false;
      nextVisualSlotIndex = 0;
      admittedSlots.clear();
      cancelExit({ clearFallback: true });
      disconnectResizeObserver();
      transition.reset();
      particleField.clear();
      visualQueueError = null;
      root.dataset.state = 'loading';
      root.dataset.preludeState = 'playing';
      delete root.dataset.skipRequested;
      delete root.dataset.errorKind;
      delete root.dataset.transitionSettled;
      delete root.dataset.finalSettled;
      clearFinalHandoff();
      root.classList.remove('is-exiting', 'is-final-resolving');
      root.style.removeProperty('--final-resolve-ms');
      root.style.setProperty('--loading-progress', '0');
      retry.hidden = true;
      retry.onclick = null;
      skip.hidden = false;
      skip.disabled = false;
      skip.onclick = requestSkip;
      copy.textContent = LOADING_COPY;
      progress.textContent = `00 / ${twoDigits(totalSlots)}`;
      for (const slot of slots.values()) {
        delete slot.dataset.status;
        delete slot.dataset.transitionOrder;
        delete slot.dataset.slitDirection;
        delete slot.dataset.motionProfile;
        delete slot.dataset.portalSide;
        delete slot.dataset.portalPhase;
        slot.style.removeProperty('--poster-handoff-ms');
        slot.style.removeProperty('--poster-enter-ms');
        slot.style.removeProperty('--poster-exit-ms');
        slot.classList.remove(...VISUAL_SLOT_CLASSES);
        slot.querySelector('figcaption')?.setAttribute('aria-hidden', 'true');
        slot.querySelector('img')?.remove();
      }
      connectResizeObserver();
      beginLoadingPrelude(currentMotionProfile);
    },
    setProgress({ id, status, completed, total, result }) {
      if (destroyed) return;
      progress.textContent = `${twoDigits(completed)} / ${twoDigits(total)}`;
      const progressTotal = Math.max(totalSlots, Math.trunc(Number(total) || 0));
      const progressValue = Math.min(
        progressTotal,
        Math.max(0, Math.trunc(Number(completed) || 0))
      );
      root.style.setProperty('--loading-progress', String(progressValue));
      const slot = slots.get(id);
      if (slot) {
        slot.dataset.status = status;
        slot.classList.toggle('is-ready', status === 'ready');
        slot.classList.toggle('is-failed', status === 'failed');
        if (status === 'failed') slot.querySelector('figcaption')?.removeAttribute('aria-hidden');
        else slot.querySelector('figcaption')?.setAttribute('aria-hidden', 'true');
      }
      if (status === 'ready' && result) {
        mountImage(result);
        settleLoadingPrelude();
        enqueueReadyVisuals();
      }
      if (status === 'ready') copy.textContent = LOADING_COPY;
    },
    showError(error, onRetry) {
      if (destroyed) return;
      cancelLoadingPrelude({ settle: true });
      root.classList.remove('is-loading-prelude', 'is-prelude-settled');
      cancelExit({ clearFallback: true });
      disconnectResizeObserver();
      transition.freeze();
      particleField.clear();
      root.dataset.state = 'error';
      skip.disabled = true;
      skip.hidden = true;
      clearFinalHandoff();
      const isVisualError = error instanceof VisualTransitionError;
      root.dataset.errorKind = isVisualError ? 'visual' : 'asset';
      const failures = error instanceof CriticalAssetError || Array.isArray(error.failures)
        ? error.failures
        : [];
      for (const failure of failures) {
        const slot = slots.get(failure.id);
        if (slot) {
          slot.dataset.status = 'failed';
          slot.classList.remove('is-ready');
          slot.classList.add('is-failed');
          slot.querySelector('figcaption')?.removeAttribute('aria-hidden');
        }
      }
      const failureIds = failures.map(({ id }) => id).join('、');
      copy.textContent = isVisualError
        ? '影像呈现失败，请重新载入'
        : `影像读取失败：${failureIds || error.message}`;
      retry.hidden = false;
      retry.onclick = () => {
        if (destroyed) return;
        retry.onclick = null;
        view.reset();
        onRetry();
      };
      retry.focus();
    },
    setProfile(nextProfile) {
      if (destroyed) return;
      applyMotionProfile(nextProfile);
    },
    async playReadySequence(profile) {
      if (destroyed) return;
      root.dataset.state = 'ready';
      copy.textContent = LOADING_COPY;
      try {
        applyMotionProfile(profile ?? currentMotionProfile);
        do {
          const ready = preludeReady;
          await ready;
        } while (!destroyed && !preludeSettled);
        if (destroyed) return;
        enqueueReadyVisuals();
        let completedRevision;
        do {
          completedRevision = transitionRevision;
          await transition.finish();
        } while (!destroyed && completedRevision !== transitionRevision);
        if (destroyed) return;
        root.dataset.state = 'ready';
        copy.textContent = LOADING_COPY;
        if (visualQueueError) throw visualQueueError;
      } catch (error) {
        if (destroyed) return;
        root.dataset.state = 'error';
        root.dataset.errorKind = 'visual';
        copy.textContent = '影像呈现失败，请重新载入';
        transition.freeze();
        particleField.clear();
        throw new VisualTransitionError(visualQueueError || error);
      }
    },
    async exit(profile = currentMotionProfile) {
      if (destroyed) return false;
      skip.disabled = true;
      skip.hidden = true;
      cancelExit();
      const exitToken = exitGeneration;
      const controller = new AbortController();
      exitController = controller;
      disconnectResizeObserver();

      let activeHandoff = handoffRun;
      if (profile === 'reduce' && activeHandoff?.profile !== 'reduce') {
        activeHandoff = prepareReducedHandoff();
      }
      if (activeHandoff) {
        const completed = await activeHandoff.barrier;
        if (
          !completed
          || controller.signal.aborted
          || exitToken !== exitGeneration
          || exitController !== controller
          || handoffRun !== activeHandoff
          || destroyed
          || !commitFinalHandoff(activeHandoff)
        ) return false;
        exitController = null;
        root.remove();
        destroyControllers();
        return true;
      }

      const appShell = documentRef.querySelector('#appShell');
      if (appShell) {
        appShell.dataset.loadingHandoff = 'true';
        appShell.classList.add('is-loading-reveal');
      }
      const fallbackCover = documentRef.querySelector(
        '#vinylCoverA[data-loading-prewarm="true"]'
      );
      if (fallbackCover) {
        fallbackCover.style.animation = 'none';
        fallbackCover.style.transition = 'none';
        fallbackCover.style.opacity = '1';
        fallbackCover.style.transform = 'scale(1) rotate(0deg)';
        fallbackCover.classList.add('is-active');
      }
      root.classList.add('is-exiting');
      const timing = POSTER_TIMING[profile];
      let completed;
      if (profile === 'reduce') {
        completed = await waitForTransition(root, {
          timeoutMs: timing.fade + 80,
          signal: controller.signal,
          setTimer,
          clearTimer
        });
      } else {
        const results = await Promise.all([
          waitForTransition(root, {
            timeoutMs: timing.rootFade + 80,
            signal: controller.signal,
            setTimer,
            clearTimer
          }),
          waitForPortalOpacityZero(root, bottomPortal, {
            profile,
            windowRef,
            signal: controller.signal,
            setTimer,
            clearTimer
          })
        ]);
        completed = results.every(Boolean);
      }
      if (
        !completed
        || controller.signal.aborted
        || exitToken !== exitGeneration
        || exitController !== controller
        || destroyed
      ) return false;
      exitController = null;
      root.remove();
      pendingFallbackCompletion = { targetCover: fallbackCover };
      destroyControllers();
      return true;
    },
    completeHandoff() {
      if (handoffRun) completeFinalHandoff();
      if (pendingFallbackCompletion) {
        completeFallbackHandoff(pendingFallbackCompletion.targetCover);
        pendingFallbackCompletion = null;
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      retry.onclick = null;
      skip.onclick = null;
      cancelExit({ clearFallback: true });
      cancelLoadingPrelude({ settle: true });
      disconnectResizeObserver();
      clearFinalHandoff();
      root.remove();
      destroyControllers();
    }
  };

  return view;
}
