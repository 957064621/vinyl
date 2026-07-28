import { CriticalAssetError } from '../media/asset-loader.js';
import { createLightParticleField } from './light-particle-field.js';
import { POSTER_TIMING, createPosterTransition } from './poster-transition.js';

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

const waitForSlitOpacityZero = (root, slit, {
  profile,
  windowRef,
  signal,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;
  const opacityIsZero = () => {
    const style = windowRef?.getComputedStyle?.(slit);
    return (Number.parseFloat(style?.opacity ?? slit.style?.opacity) || 0) <= 0.001;
  };
  const cleanup = () => {
    clearTimer(timer);
    slit.removeEventListener('animationend', handleAnimationEnd);
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
      event.target !== slit
      || event.animationName !== 'loading-final-tunnel'
    ) return;
    finish(true);
  };
  const handleAbort = () => finish(false);

  if (signal?.aborted) {
    finish(false);
    return;
  }
  slit.addEventListener('animationend', handleAnimationEnd);
  signal?.addEventListener('abort', handleAbort, { once: true });
  if (opacityIsZero() && !root.classList.contains('is-final-resolving')) {
    finish(true);
    return;
  }

  const timing = POSTER_TIMING[profile];
  const finalTail = timing.finalResolve - timing.exitLead;
  timer = setTimer(() => {
    if (signal?.aborted) return;
    slit.style.animation = 'none';
    slit.style.opacity = '0';
    finish(true);
  }, finalTail + 80);
});

export function createLoadingScreen(documentRef = document, {
  motionProfile = 'compact',
  particleFactory = createLightParticleField,
  transitionFactory = createPosterTransition,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  const root = documentRef.querySelector('#loadingScreen');
  const progress = documentRef.querySelector('#loadingProgress');
  const copy = documentRef.querySelector('#loadingCopy');
  const retry = documentRef.querySelector('#loadingRetry');
  const canvas = documentRef.querySelector('#loadingParticles');
  const slit = documentRef.querySelector('#loadingLightSlit');
  const requiredNodes = {
    loadingScreen: root,
    loadingProgress: progress,
    loadingCopy: copy,
    loadingRetry: retry,
    loadingParticles: canvas,
    loadingLightSlit: slit
  };
  const missingNodes = Object.entries(requiredNodes)
    .filter(([, node]) => !node)
    .map(([name]) => `#${name}`);
  if (missingNodes.length > 0) {
    throw new TypeError(`Loading screen is missing required nodes: ${missingNodes.join(', ')}`);
  }
  const slotNodes = [...root.querySelectorAll('[data-loading-slot]')];
  if (slotNodes.length !== 5) {
    throw new TypeError(`Loading screen requires exactly 5 loading slots; found ${slotNodes.length}`);
  }
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
  let handoffGeneration = 0;

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

  const clearFinalHandoff = () => {
    handoffGeneration += 1;
    if (handoffFrame !== null) {
      cancelFrame(handoffFrame);
      handoffFrame = null;
    }
    delete root.dataset.handoffReady;
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

    const source = root.querySelector('.loading-image[data-loading-handoff="true"]');
    if (source) delete source.dataset.loadingHandoff;
    documentRef.querySelector('#appShell')?.classList.remove('is-loading-reveal');

    const targetCover = documentRef.querySelector(
      '.vinyl-cover[data-loading-handoff="true"], .vinyl-cover[data-loading-prewarm="true"]'
    );
    if (targetCover) {
      targetCover.classList.remove('is-active');
      targetCover.style.removeProperty('background-image');
      delete targetCover.dataset.loadingHandoff;
      delete targetCover.dataset.loadingPrewarm;
    }
  };

  const settleFinalHandoff = () => {
    handoffGeneration += 1;
    if (handoffFrame !== null) {
      cancelFrame(handoffFrame);
      handoffFrame = null;
    }
    const source = root.querySelector('.loading-image[data-loading-handoff="true"]');
    if (source) delete source.dataset.loadingHandoff;
    documentRef.querySelectorAll(
      '.vinyl-cover[data-loading-handoff="true"], .vinyl-cover[data-loading-prewarm="true"]'
    ).forEach((targetCover) => {
      delete targetCover.dataset.loadingHandoff;
      delete targetCover.dataset.loadingPrewarm;
    });
  };

  const prepareFinalHandoff = (profile, source) => {
    clearFinalHandoff();
    if (profile === 'reduce' || !source) return;

    const sourceFrame = source.closest?.('.loading-frame') ?? source;
    const target = documentRef.querySelector('.vinyl-sticker');
    if (!target) return;

    const sourceRect = sourceFrame.getBoundingClientRect();
    const appShell = documentRef.querySelector('#appShell');
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

    const targetCover = documentRef.querySelector('#vinylCoverA');
    const artworkSource = source.currentSrc || source.src;
    if (!targetCover || !artworkSource) return;

    source.dataset.loadingHandoff = 'true';
    targetCover.style.backgroundImage = `url(${JSON.stringify(artworkSource)})`;
    targetCover.dataset.loadingHandoff = 'true';
    appShell?.classList.add('is-loading-reveal');
    const generation = ++handoffGeneration;
    handoffFrame = requestFrame(() => {
      handoffFrame = null;
      if (generation !== handoffGeneration || !root.isConnected) return;
      root.dataset.handoffReady = 'true';
      targetCover.classList.add('is-active');
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
    slit,
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

  const applyMotionProfile = (nextProfile) => {
    transition.setProfile(nextProfile);
    currentMotionProfile = nextProfile;
    if (nextProfile === 'reduce') clearFinalHandoff();
  };

  const cancelExit = ({ clearFallback = false } = {}) => {
    exitGeneration += 1;
    exitController?.abort();
    exitController = null;
    root.classList.remove('is-exiting');
    if (!clearFallback) return;
    slit.style.removeProperty('animation');
    slit.style.removeProperty('opacity');
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
    if (slot.dataset.loadingSlot === 'archive-05') {
      const targetCover = documentRef.querySelector('#vinylCoverA');
      const artworkSource = result.image.currentSrc || result.image.src;
      if (targetCover && artworkSource) {
        targetCover.style.backgroundImage = `url(${JSON.stringify(artworkSource)})`;
        targetCover.dataset.loadingPrewarm = 'true';
      }
    }
    try {
      transition.enqueue(slot);
    } catch (error) {
      visualQueueError ||= error;
    }
    return slot;
  };

  const view = {
    reset() {
      if (destroyed) return;
      cancelExit({ clearFallback: true });
      disconnectResizeObserver();
      transition.reset();
      particleField.clear();
      visualQueueError = null;
      root.dataset.state = 'loading';
      delete root.dataset.errorKind;
      delete root.dataset.transitionSettled;
      delete root.dataset.finalSettled;
      clearFinalHandoff();
      root.classList.remove('is-exiting', 'is-final-resolving');
      root.style.removeProperty('--final-resolve-ms');
      root.style.setProperty('--loading-progress', '0');
      retry.hidden = true;
      retry.onclick = null;
      copy.textContent = '影像读取中';
      progress.textContent = '00 / 05';
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
    },
    setProgress({ id, status, completed, total, result }) {
      if (destroyed) return;
      progress.textContent = `${twoDigits(completed)} / ${twoDigits(total)}`;
      const progressValue = Math.min(5, Math.max(0, Math.trunc(Number(completed) || 0)));
      root.style.setProperty('--loading-progress', String(progressValue));
      const slot = slots.get(id);
      if (slot) {
        slot.dataset.status = status;
        slot.classList.toggle('is-ready', status === 'ready');
        slot.classList.toggle('is-failed', status === 'failed');
        if (status === 'failed') slot.querySelector('figcaption')?.removeAttribute('aria-hidden');
        else slot.querySelector('figcaption')?.setAttribute('aria-hidden', 'true');
      }
      if (status === 'ready' && result) mountImage(result);
      if (status === 'ready') copy.textContent = `已归档 ${completed} / ${total}`;
    },
    showError(error, onRetry) {
      if (destroyed) return;
      cancelExit({ clearFallback: true });
      disconnectResizeObserver();
      transition.freeze();
      particleField.clear();
      root.dataset.state = 'error';
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
      copy.textContent = '档案接入完成';
      try {
        applyMotionProfile(profile ?? currentMotionProfile);
        await transition.finish();
        if (destroyed) return;
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
      if (destroyed) return;
      cancelExit();
      const exitToken = exitGeneration;
      const controller = new AbortController();
      exitController = controller;
      disconnectResizeObserver();
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
          waitForSlitOpacityZero(root, slit, {
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
      ) return;
      exitController = null;
      settleFinalHandoff();
      documentRef.querySelector('#appShell')?.classList.remove('is-loading-reveal');
      root.remove();
      destroyControllers();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      retry.onclick = null;
      cancelExit({ clearFallback: true });
      disconnectResizeObserver();
      clearFinalHandoff();
      root.remove();
      destroyControllers();
    }
  };

  return view;
}
