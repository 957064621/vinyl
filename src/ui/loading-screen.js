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
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;

  const cleanup = () => {
    clearTimer(timer);
    element.removeEventListener('transitionend', handleTransitionEnd);
  };
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanup();
    resolve();
  };
  const handleTransitionEnd = (event) => {
    if (event.target !== element || event.propertyName !== propertyName) return;
    finish();
  };

  timer = setTimer(finish, timeoutMs);
  element.addEventListener('transitionend', handleTransitionEnd);
});

const waitForSlitOpacityZero = (root, slit, {
  windowRef,
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
  };
  const finish = () => {
    if (settled || !opacityIsZero()) return;
    settled = true;
    cleanup();
    resolve();
  };
  const handleAnimationEnd = (event) => {
    if (event.target !== slit || event.animationName !== 'loading-final-exposure') return;
    finish();
  };

  slit.addEventListener('animationend', handleAnimationEnd);
  if (opacityIsZero() && !root.classList.contains('is-final-exposure')) {
    finish();
    return;
  }

  const exposureTail = POSTER_TIMING.finalExposure - POSTER_TIMING.exitLead;
  timer = setTimer(() => {
    slit.style.animation = 'none';
    slit.style.opacity = '0';
    finish();
  }, exposureTail + 80);
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
    onError(error) {
      visualQueueError ||= error;
    }
  });

  const mountImage = (result) => {
    const slot = slots.get(result.id);
    if (!slot) return null;
    slot.querySelector('img')?.remove();
    result.image.alt = result.alt;
    result.image.className = 'loading-image';
    result.image.dataset.assetId = result.id;
    result.image.setAttribute('aria-hidden', 'true');
    slot.insertBefore(result.image, slot.firstChild);
    try {
      transition.enqueue(slot);
    } catch (error) {
      visualQueueError ||= error;
    }
    return slot;
  };

  const view = {
    reset() {
      transition.reset();
      particleField.clear();
      visualQueueError = null;
      root.dataset.state = 'loading';
      delete root.dataset.errorKind;
      delete root.dataset.transitionSettled;
      root.classList.remove('is-exiting', 'is-final-exposure');
      root.style.setProperty('--loading-progress', '0');
      retry.hidden = true;
      retry.onclick = null;
      copy.textContent = '影像读取中';
      progress.textContent = '00 / 05';
      for (const slot of slots.values()) {
        delete slot.dataset.status;
        delete slot.dataset.transitionOrder;
        delete slot.dataset.slitDirection;
        slot.style.removeProperty('--poster-reveal-ms');
        slot.classList.remove(...VISUAL_SLOT_CLASSES);
        slot.querySelector('figcaption')?.setAttribute('aria-hidden', 'true');
        slot.querySelector('img')?.remove();
      }
    },
    setProgress({ id, status, completed, total, result }) {
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
      transition.freeze();
      particleField.clear();
      root.dataset.state = 'error';
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
        retry.onclick = null;
        view.reset();
        onRetry();
      };
      retry.focus();
    },
    async playReadySequence(profile) {
      root.dataset.state = 'ready';
      copy.textContent = '档案接入完成';
      try {
        transition.setProfile(profile ?? motionProfile);
        await transition.finish();
        if (visualQueueError) throw visualQueueError;
      } catch (error) {
        root.dataset.state = 'error';
        root.dataset.errorKind = 'visual';
        copy.textContent = '影像呈现失败，请重新载入';
        transition.freeze();
        particleField.clear();
        throw new VisualTransitionError(visualQueueError || error);
      }
    },
    async exit(profile) {
      root.classList.add('is-exiting');
      if (profile === 'reduce') {
        await waitForTransition(root, {
          timeoutMs: 180,
          setTimer,
          clearTimer
        });
      } else {
        await Promise.all([
          waitForTransition(root, { setTimer, clearTimer }),
          waitForSlitOpacityZero(root, slit, {
            windowRef: documentRef.defaultView,
            setTimer,
            clearTimer
          })
        ]);
      }
      root.remove();
      try {
        transition.destroy();
      } catch {}
      try {
        particleField.destroy();
      } catch {}
    }
  };

  return view;
}
