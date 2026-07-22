export const POSTER_TIMING = Object.freeze({
  normal: Object.freeze({ gather: 160, scatter: 160, reveal: 180, hold: 300 }),
  fast: Object.freeze({ gather: 80, scatter: 100, reveal: 100, hold: 160 }),
  finalHold: 520,
  finalExposure: 360,
  reduceFade: 120
});

const PROFILES = Object.freeze(['full', 'compact', 'reduce']);

const defaultScheduler = Object.freeze({
  sleep(ms, signal) {
    if (signal.aborted) return Promise.resolve(false);
    if (ms === 0) return Promise.resolve(true);

    return new Promise((resolve) => {
      let settled = false;
      let timer = null;
      const finish = (completed) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        resolve(completed);
      };
      const abort = () => finish(false);

      timer = setTimeout(() => finish(true), ms);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
});

const assertProfile = (profile) => {
  if (!PROFILES.includes(profile)) {
    throw new RangeError(`Unknown poster transition profile: ${profile}`);
  }
};

const hasMethods = (value, methods) => (
  value && methods.every((method) => typeof value[method] === 'function')
);

export function createPosterTransition({
  root,
  slit,
  particleField,
  profile = 'compact',
  scheduler = defaultScheduler,
  onError = () => {}
} = {}) {
  if (!hasMethods(root, ['contains', 'querySelectorAll']) || !root.classList || !root.dataset) {
    throw new TypeError('Poster transition root is required');
  }
  if (!slit?.classList || !slit.dataset) {
    throw new TypeError('Poster transition slit is required');
  }
  if (!hasMethods(particleField, ['gather', 'scatter', 'finish', 'setProfile'])) {
    throw new TypeError('Poster transition particle field is required');
  }
  if (!hasMethods(scheduler, ['sleep'])) {
    throw new TypeError('Poster transition scheduler is required');
  }
  if (typeof onError !== 'function') {
    throw new TypeError('Poster transition onError callback must be a function');
  }
  assertProfile(profile);

  let currentProfile = profile;
  let queue = [];
  let accepted = new Set();
  let activeItem = null;
  let generation = 0;
  let processingToken = null;
  let abortController = new AbortController();
  let sealed = false;
  let destroyed = false;
  let lastError = null;
  let errorReported = false;
  let finishPromise = null;
  const idleWaiters = new Set();

  const slots = () => [...root.querySelectorAll('[data-loading-slot]')];

  const imageFor = (slot) => {
    if (!slot || !root.contains(slot) || typeof slot.querySelectorAll !== 'function') return null;
    const images = slot.querySelectorAll('img');
    return images.length === 1 ? images[0] : null;
  };

  const isCurrent = (token) => (
    !destroyed
    && token === generation
    && !abortController.signal.aborted
  );

  const sleep = async (ms, token) => {
    if (!isCurrent(token)) return false;
    const completed = await scheduler.sleep(ms, abortController.signal);
    return completed === true && isCurrent(token);
  };

  const setActive = (item, value) => {
    if (!item) return;
    item.slot.classList.toggle('is-active', value);
    if (value) item.image.removeAttribute('aria-hidden');
    else item.image.setAttribute('aria-hidden', 'true');
  };

  const stabilize = (item) => {
    if (!item) return;
    item.slot.classList.remove('is-revealing', 'is-scattering');
    item.slot.classList.add('is-stable');
    setActive(item, true);
  };

  const notifyIdle = () => {
    if (queue.length > 0 || processingToken !== null) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const timingFor = () => (
    queue.length > 2 ? POSTER_TIMING.fast : POSTER_TIMING.normal
  );

  const runReduceItem = async (item, token) => {
    await Promise.resolve(particleField.finish());
    if (!isCurrent(token)) return;

    if (activeItem) {
      setActive(activeItem, false);
      activeItem.slot.classList.remove('is-revealing', 'is-scattering', 'is-stable');
    }

    activeItem = item;
    setActive(activeItem, true);
    activeItem.slot.classList.add('is-revealing');
    if (!await sleep(POSTER_TIMING.reduceFade, token)) return;
    activeItem.slot.classList.remove('is-revealing');
    activeItem.slot.classList.add('is-stable');
  };

  const runAnimatedItem = async (item, token, timing) => {
    const bounds = item.slot.getBoundingClientRect();
    slit.dataset.direction = item.direction;

    const [, gathered] = await Promise.all([
      Promise.resolve(particleField.gather(bounds)),
      sleep(timing.gather, token)
    ]);
    if (!isCurrent(token) || gathered === false) return;

    if (activeItem) {
      const outgoing = activeItem;
      outgoing.slot.classList.remove('is-stable');
      outgoing.slot.classList.add('is-scattering');
      const [, scattered] = await Promise.all([
        Promise.resolve(particleField.scatter(outgoing.slot.getBoundingClientRect())),
        sleep(timing.scatter, token)
      ]);
      if (!isCurrent(token) || scattered === false) return;
      setActive(outgoing, false);
      outgoing.slot.classList.remove('is-scattering');
    }

    activeItem = item;
    slit.classList.add('is-lit');
    setActive(activeItem, true);
    activeItem.slot.classList.add('is-revealing');
    if (!await sleep(timing.reveal, token)) return;
    activeItem.slot.classList.remove('is-revealing');
    activeItem.slot.classList.add('is-stable');
    slit.classList.remove('is-lit');

    const finalItem = sealed && queue.length === 0;
    const hold = finalItem ? POSTER_TIMING.finalHold : timing.hold;
    await sleep(hold, token);
  };

  const runItem = async (item, token) => {
    const timing = timingFor();
    const reveal = currentProfile === 'reduce' ? POSTER_TIMING.reduceFade : timing.reveal;
    item.slot.style.setProperty('--poster-reveal-ms', `${reveal}ms`);

    if (currentProfile === 'reduce') {
      await runReduceItem(item, token);
      return;
    }
    await runAnimatedItem(item, token, timing);
  };

  const safelyFinishParticles = () => {
    try {
      particleField.finish();
    } catch {
      // Cancellation and error cleanup must preserve the original outcome.
    }
  };

  const fail = (error, token) => {
    if (token !== generation || errorReported) return;
    lastError = error;
    errorReported = true;
    sealed = true;
    queue = [];
    abortController.abort();
    abortController = new AbortController();
    safelyFinishParticles();
    slit.classList.remove('is-lit');
    stabilize(activeItem);
    try {
      onError(error);
    } catch {
      // Observer failures do not replace the animation failure.
    }
  };

  const ensurePump = () => {
    if (destroyed || processingToken !== null || queue.length === 0) return;
    const token = generation;
    processingToken = token;

    void (async () => {
      try {
        while (isCurrent(token) && queue.length > 0) {
          const item = queue.shift();
          await runItem(item, token);
        }
      } catch (error) {
        fail(error, token);
      } finally {
        if (processingToken === token) processingToken = null;
        notifyIdle();
        if (queue.length > 0) ensurePump();
      }
    })();
  };

  const clearSlotState = () => {
    for (const slot of slots()) {
      slot.classList.remove('is-active', 'is-revealing', 'is-scattering', 'is-stable');
      delete slot.dataset.transitionOrder;
      delete slot.dataset.slitDirection;
      slot.style.removeProperty('--poster-reveal-ms');
      for (const image of slot.querySelectorAll('img')) {
        image.setAttribute('aria-hidden', 'true');
      }
    }
    activeItem = null;
  };

  const cancelWork = ({ preserveActive }) => {
    generation += 1;
    abortController.abort();
    abortController = new AbortController();
    processingToken = null;
    queue = [];
    slit.classList.remove('is-lit');
    delete slit.dataset.direction;
    root.classList.remove('is-final-exposure');
    delete root.dataset.transitionSettled;
    safelyFinishParticles();

    if (preserveActive) stabilize(activeItem);
    else clearSlotState();

    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const waitForIdle = () => {
    if (queue.length === 0 && processingToken === null) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  };

  clearSlotState();
  root.dataset.motionProfile = currentProfile;
  particleField.setProfile(currentProfile);

  return {
    enqueue(slot) {
      const image = imageFor(slot);
      if (destroyed || sealed || !image || accepted.has(slot)) return false;

      const order = accepted.size + 1;
      const direction = order % 2 === 1 ? 'ltr' : 'rtl';
      const item = { slot, image, order, direction };
      accepted.add(slot);
      image.setAttribute('aria-hidden', 'true');
      slot.dataset.transitionOrder = String(order);
      slot.dataset.slitDirection = direction;
      queue.push(item);
      ensurePump();
      return true;
    },

    waitForIdle,

    finish() {
      if (finishPromise) return finishPromise;
      sealed = true;
      const token = generation;
      ensurePump();
      finishPromise = (async () => {
        await waitForIdle();
        if (!isCurrent(token)) return;
        if (lastError) throw lastError;

        root.classList.add('is-final-exposure');
        const duration = currentProfile === 'reduce' ? 0 : POSTER_TIMING.finalExposure;
        if (!await sleep(duration, token)) return;
        root.dataset.transitionSettled = 'true';
      })();
      return finishPromise;
    },

    freeze() {
      if (destroyed) return;
      cancelWork({ preserveActive: true });
      sealed = true;
    },

    reset() {
      if (destroyed) return;
      cancelWork({ preserveActive: false });
      accepted = new Set();
      sealed = false;
      lastError = null;
      errorReported = false;
      finishPromise = null;
    },

    setProfile(nextProfile) {
      assertProfile(nextProfile);
      if (destroyed) return;
      currentProfile = nextProfile;
      root.dataset.motionProfile = nextProfile;
      particleField.setProfile(nextProfile);
    },

    destroy() {
      if (destroyed) return;
      cancelWork({ preserveActive: false });
      accepted.clear();
      destroyed = true;
    },

    getState() {
      return {
        profile: currentProfile,
        queued: queue.length,
        activeId: activeItem?.slot.dataset.loadingSlot ?? null,
        processing: processingToken !== null,
        sealed,
        destroyed
      };
    }
  };
}
