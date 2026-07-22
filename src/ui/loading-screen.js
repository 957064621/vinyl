import { CriticalAssetError } from '../media/asset-loader.js';
import { createLightParticleField } from './light-particle-field.js';
import { createPosterTransition } from './poster-transition.js';

const twoDigits = (value) => String(value).padStart(2, '0');

const VISUAL_SLOT_CLASSES = Object.freeze([
  'is-ready',
  'is-failed',
  'is-active',
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

const waitForTransition = (element, {
  propertyName = 'opacity',
  timeoutMs = 900
} = {}) => new Promise((resolve) => {
  let settled = false;
  let timer;

  const cleanup = () => {
    clearTimeout(timer);
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

  timer = setTimeout(finish, timeoutMs);
  element.addEventListener('transitionend', handleTransitionEnd);
});

export function createLoadingScreen(documentRef = document, {
  motionProfile = 'compact',
  particleFactory = createLightParticleField,
  transitionFactory = createPosterTransition
} = {}) {
  const root = documentRef.querySelector('#loadingScreen');
  const progress = documentRef.querySelector('#loadingProgress');
  const copy = documentRef.querySelector('#loadingCopy');
  const retry = documentRef.querySelector('#loadingRetry');
  const canvas = documentRef.querySelector('#loadingParticles');
  const slit = documentRef.querySelector('#loadingLightSlit');
  const slots = new Map(
    [...root.querySelectorAll('[data-loading-slot]')]
      .map((slot) => [slot.dataset.loadingSlot, slot])
  );
  let visualQueueError = null;

  const particleField = particleFactory({
    canvas,
    documentRef,
    windowRef: documentRef.defaultView,
    profile: motionProfile
  });
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
      if (profile !== 'reduce') {
        await waitForTransition(root, { timeoutMs: 900 });
      }
      try {
        transition.destroy();
      } finally {
        try {
          particleField.destroy();
        } finally {
          root.remove();
        }
      }
    }
  };

  return view;
}
