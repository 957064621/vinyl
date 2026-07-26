export const POSTER_TIMING = Object.freeze({
  full: Object.freeze({
    normal: Object.freeze({ gather: 90, handoff: 420, exit: 340, hold: 500 }),
    compressed: Object.freeze({ gather: 60, handoff: 340, exit: 280, hold: 440 }),
    finalHold: 840,
    finalResolve: 1100,
    exitLead: 620,
    rootFade: 680
  }),
  compact: Object.freeze({
    normal: Object.freeze({ gather: 70, handoff: 360, exit: 300, hold: 440 }),
    compressed: Object.freeze({ gather: 50, handoff: 300, exit: 240, hold: 380 }),
    finalHold: 720,
    finalResolve: 920,
    exitLead: 520,
    rootFade: 560
  }),
  reduce: Object.freeze({ fade: 120 })
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

const defaultScheduleMicrotask = globalThis.queueMicrotask?.bind(globalThis)
  ?? ((callback) => { void Promise.resolve().then(callback); });

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
  onError = () => {},
  onFinalScene = () => {},
  scheduleMicrotask = defaultScheduleMicrotask
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
  if (typeof onFinalScene !== 'function') {
    throw new TypeError('Poster transition onFinalScene callback must be a function');
  }
  if (typeof scheduleMicrotask !== 'function') {
    throw new TypeError('Poster transition microtask scheduler must be a function');
  }
  assertProfile(profile);

  let currentProfile = profile;
  let queue = [];
  let accepted = new Set();
  let activeItem = null;
  let currentItem = null;
  let completedReadableHold = 0;
  let compressedDrain = false;
  let generation = 0;
  let processingToken = null;
  let scheduledPump = null;
  let abortController = new AbortController();
  let sealed = false;
  let destroyed = false;
  let lastError = null;
  let errorReported = false;
  let finishPromise = null;
  let runToken = {};
  const portalOrientation = 'vertical';
  const idleWaiters = new Set();

  const slots = () => [...root.querySelectorAll('[data-loading-slot]')];

  const imageFor = (slot) => {
    try {
      if (
        !slot
        || slot.nodeType !== 1
        || typeof slot.matches !== 'function'
        || typeof slot.querySelectorAll !== 'function'
        || !root.contains(slot)
        || !slot.matches('[data-loading-slot]')
      ) return null;
      const images = slot.querySelectorAll('img');
      return images.length === 1 ? images[0] : null;
    } catch {
      return null;
    }
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

  const clearSlotPortalState = (slot) => {
    if (!slot) return;
    slot.classList.remove(
      'is-entering',
      'is-entering-from-portal',
      'is-exiting',
      'is-exiting-to-portal'
    );
    delete slot.dataset.portalSide;
    delete slot.dataset.portalPhase;
    slot.style.removeProperty('--poster-enter-ms');
    slot.style.removeProperty('--poster-exit-ms');
  };

  const clearPortalState = () => {
    root.classList.remove('is-scanning', 'is-portal-active');
    slit.classList.remove('is-lit');
    delete root.dataset.portalSide;
    delete root.dataset.portalPhase;
    delete slit.dataset.portalSide;
    delete slit.dataset.portalPhase;
    root.style.removeProperty('--slit-duration');
    root.style.removeProperty('--portal-phase-ms');
  };

  const activatePortal = (side, phase, sceneProfile, duration) => {
    root.dataset.portalSide = side;
    root.dataset.portalPhase = phase;
    slit.dataset.direction = portalOrientation;
    slit.dataset.portalSide = side;
    slit.dataset.portalPhase = phase;
    slit.dataset.motionProfile = sceneProfile;
    root.style.setProperty('--slit-duration', `${duration}ms`);
    root.style.setProperty('--portal-phase-ms', `${duration}ms`);
    root.classList.add('is-scanning', 'is-portal-active');
    slit.classList.add('is-lit');
  };

  const stabilize = (item) => {
    if (!item) return;
    item.slot.classList.remove('is-outgoing', 'is-revealing', 'is-scattering');
    clearSlotPortalState(item.slot);
    item.slot.classList.add('is-stable');
    setActive(item, true);
  };

  const notifyIdle = () => {
    if (queue.length > 0 || processingToken !== null || scheduledPump !== null) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const timingFor = (sceneProfile) => {
    if (queue.length > 2) compressedDrain = true;
    return POSTER_TIMING[sceneProfile][compressedDrain ? 'compressed' : 'normal'];
  };

  const runReduceItem = async (item, token) => {
    await Promise.resolve(particleField.finish());
    if (!isCurrent(token)) return;

    if (activeItem) {
      setActive(activeItem, false);
      activeItem.slot.classList.remove('is-revealing', 'is-scattering', 'is-stable');
      clearSlotPortalState(activeItem.slot);
    }

    activeItem = item;
    completedReadableHold = 0;
    setActive(activeItem, true);
    activeItem.slot.classList.add('is-revealing');
    if (!await sleep(POSTER_TIMING.reduce.fade, token)) return;
    activeItem.slot.classList.remove('is-revealing');
    activeItem.slot.classList.add('is-stable');
  };

  const runAnimatedItem = async (item, token, timing, sceneProfile) => {
    item.slot.dataset.motionProfile = sceneProfile;
    const outgoing = activeItem;
    if (outgoing) {
      const exitDuration = timing.gather + timing.exit;
      activatePortal('right', 'exit', sceneProfile, exitDuration);
      if (!await sleep(timing.gather, token)) return;
      if (!isCurrent(token)) return;

      setActive(outgoing, false);
      outgoing.slot.dataset.motionProfile = sceneProfile;
      outgoing.slot.dataset.portalSide = 'right';
      outgoing.slot.dataset.portalPhase = 'exit';
      outgoing.slot.style.setProperty('--poster-exit-ms', `${timing.exit}ms`);
      outgoing.slot.style.setProperty('--poster-handoff-ms', `${timing.exit}ms`);
      outgoing.slot.classList.remove('is-stable');
      outgoing.slot.classList.add(
        'is-outgoing',
        'is-scattering',
        'is-exiting',
        'is-exiting-to-portal'
      );

      const [, exited] = await Promise.all([
        Promise.resolve(particleField.scatter(
          outgoing.slot.getBoundingClientRect(),
          timing.exit,
          { portalSide: 'right' }
        )),
        sleep(timing.exit, token)
      ]);
      if (!isCurrent(token) || exited === false) return;
      outgoing.slot.classList.remove('is-outgoing', 'is-scattering');
      outgoing.slot.style.removeProperty('--poster-handoff-ms');
      clearSlotPortalState(outgoing.slot);
      clearPortalState();
    }

    const enterDuration = timing.gather + timing.handoff;
    activatePortal('left', 'enter', sceneProfile, enterDuration);
    if (!await sleep(timing.gather, token)) return;
    if (!isCurrent(token)) return;

    activeItem = item;
    completedReadableHold = 0;
    setActive(activeItem, true);
    activeItem.slot.dataset.portalSide = 'left';
    activeItem.slot.dataset.portalPhase = 'enter';
    activeItem.slot.style.setProperty('--poster-enter-ms', `${timing.handoff}ms`);
    activeItem.slot.style.setProperty('--poster-handoff-ms', `${timing.handoff}ms`);
    activeItem.slot.classList.add('is-revealing', 'is-entering', 'is-entering-from-portal');
    const [, entered] = await Promise.all([
      Promise.resolve(particleField.gather(
        activeItem.slot.getBoundingClientRect(),
        timing.handoff,
        { portalSide: 'left' }
      )),
      sleep(timing.handoff, token)
    ]);
    if (!isCurrent(token) || entered === false) return;
    activeItem.slot.classList.remove('is-revealing');
    clearSlotPortalState(activeItem.slot);
    activeItem.slot.classList.add('is-stable');
    activeItem.slot.style.removeProperty('--poster-handoff-ms');
    clearPortalState();

    const finalItem = sealed && queue.length === 0;
    const profileTiming = POSTER_TIMING[sceneProfile];
    const hold = finalItem ? profileTiming.finalHold : timing.hold;
    if (await sleep(hold, token) && activeItem === item) {
      completedReadableHold = Math.min(
        profileTiming.finalHold,
        completedReadableHold + hold
      );
    }
  };

  const runItem = async (item, token) => {
    const sceneProfile = currentProfile;
    if (sceneProfile === 'reduce') {
      item.slot.style.setProperty('--poster-handoff-ms', `${POSTER_TIMING.reduce.fade}ms`);
      await runReduceItem(item, token);
      return;
    }
    const timing = timingFor(sceneProfile);
    item.slot.style.setProperty('--poster-handoff-ms', `${timing.handoff}ms`);
    await runAnimatedItem(item, token, timing, sceneProfile);
  };

  const settleParticleField = () => {
    try {
      void Promise.resolve(particleField.finish()).catch(() => {});
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
    compressedDrain = false;
    abortController.abort();
    abortController = new AbortController();
    settleParticleField();
    clearPortalState();
    for (const slot of slots()) {
      slot.classList.remove('is-outgoing', 'is-revealing', 'is-scattering');
      clearSlotPortalState(slot);
      slot.style.removeProperty('--poster-handoff-ms');
    }
    stabilize(activeItem);
    try {
      onError(error);
    } catch {
      // Observer failures do not replace the animation failure.
    }
  };

  const runPump = (token) => {
    processingToken = token;

    void (async () => {
      let item = null;
      try {
        while (isCurrent(token) && queue.length > 0) {
          item = queue.shift();
          currentItem = item;
          await runItem(item, token);
          if (isCurrent(token) && currentItem === item) currentItem = null;
          item = null;
        }
      } catch (error) {
        if (isCurrent(token) && currentItem === item) currentItem = null;
        fail(error, token);
      } finally {
        if (processingToken === token) {
          processingToken = null;
          if (currentItem === item) currentItem = null;
          if (queue.length === 0) compressedDrain = false;
        }
        notifyIdle();
        if (queue.length > 0) ensurePump();
      }
    })();
  };

  function ensurePump() {
    if (
      destroyed
      || processingToken !== null
      || scheduledPump !== null
      || queue.length === 0
    ) return;

    const reservation = { generation };
    scheduledPump = reservation;
    scheduleMicrotask(() => {
      if (scheduledPump !== reservation) return;
      scheduledPump = null;
      if (!isCurrent(reservation.generation) || queue.length === 0) {
        notifyIdle();
        return;
      }
      runPump(reservation.generation);
    });
  }

  const clearSlotState = () => {
    for (const slot of slots()) {
      slot.classList.remove('is-active', 'is-outgoing', 'is-revealing', 'is-scattering', 'is-stable');
      clearSlotPortalState(slot);
      delete slot.dataset.transitionOrder;
      delete slot.dataset.slitDirection;
      delete slot.dataset.motionProfile;
      slot.style.removeProperty('--poster-handoff-ms');
      for (const image of slot.querySelectorAll('img')) {
        image.setAttribute('aria-hidden', 'true');
      }
    }
    activeItem = null;
    completedReadableHold = 0;
  };

  const cancelWork = ({ preserveActive }) => {
    generation += 1;
    runToken = {};
    abortController.abort();
    abortController = new AbortController();
    processingToken = null;
    scheduledPump = null;
    currentItem = null;
    queue = [];
    compressedDrain = false;
    clearPortalState();
    delete slit.dataset.direction;
    delete slit.dataset.motionProfile;
    root.style.removeProperty('--slit-duration');
    root.style.removeProperty('--final-resolve-ms');
    root.classList.remove('is-final-resolving');
    delete root.dataset.transitionSettled;
    delete root.dataset.finalSettled;
    settleParticleField();

    if (preserveActive) {
      for (const slot of slots()) {
        slot.classList.remove('is-outgoing', 'is-revealing', 'is-scattering', 'is-stable');
        clearSlotPortalState(slot);
        slot.style.removeProperty('--poster-handoff-ms');
      }
      stabilize(activeItem);
    }
    else clearSlotState();

    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const switchRunningWorkToReduce = () => {
    const interruptedItem = currentItem;
    generation += 1;
    abortController.abort();
    abortController = new AbortController();
    processingToken = null;
    scheduledPump = null;
    currentItem = null;
    compressedDrain = false;
    if (interruptedItem && !queue.includes(interruptedItem)) {
      queue.unshift(interruptedItem);
    }

    clearPortalState();
    delete slit.dataset.direction;
    delete slit.dataset.motionProfile;
    root.style.removeProperty('--slit-duration');
    root.style.removeProperty('--final-resolve-ms');
    root.classList.remove('is-final-resolving');
    delete root.dataset.transitionSettled;
    delete root.dataset.finalSettled;
    for (const slot of slots()) {
      slot.classList.remove('is-outgoing', 'is-revealing', 'is-scattering');
      clearSlotPortalState(slot);
      slot.style.removeProperty('--poster-handoff-ms');
      if (activeItem?.slot === slot) slot.classList.add('is-stable');
    }
    settleParticleField();
    ensurePump();
    notifyIdle();
  };

  const waitForIdle = () => {
    if (
      queue.length === 0
      && processingToken === null
      && scheduledPump === null
    ) return Promise.resolve();
    return new Promise((resolve) => idleWaiters.add(resolve));
  };

  clearSlotState();
  root.dataset.motionProfile = currentProfile;
  particleField.setProfile(currentProfile);

  return {
    enqueue(slot) {
      if (destroyed || sealed) return false;
      const image = imageFor(slot);
      if (!image || accepted.has(slot)) return false;

      const order = accepted.size + 1;
      const direction = portalOrientation;
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
      const finishingRun = runToken;
      ensurePump();
      finishPromise = (async () => {
        while (!destroyed && runToken === finishingRun) {
          await waitForIdle();
          if (destroyed || runToken !== finishingRun) return;
          if (lastError) throw lastError;

          const token = generation;
          const finalSceneProfile = currentProfile;
          if (finalSceneProfile !== 'reduce' && activeItem) {
            const profileTiming = POSTER_TIMING[finalSceneProfile];
            const remainingHold = Math.max(
              0,
              profileTiming.finalHold - completedReadableHold
            );
            if (remainingHold > 0) {
              if (!await sleep(remainingHold, token)) {
                if (generation !== token) continue;
                return;
              }
              completedReadableHold += remainingHold;
            }
          }

          if (finalSceneProfile !== 'reduce') {
            const profileTiming = POSTER_TIMING[finalSceneProfile];
            onFinalScene({
              slot: activeItem?.slot ?? null,
              image: activeItem?.image ?? null,
              profile: finalSceneProfile
            });
            root.dataset.portalSide = 'center';
            root.dataset.portalPhase = 'final-handoff';
            slit.dataset.direction = portalOrientation;
            slit.dataset.portalSide = 'center';
            slit.dataset.portalPhase = 'final-handoff';
            slit.dataset.motionProfile = finalSceneProfile;
            root.style.setProperty('--final-resolve-ms', `${profileTiming.finalResolve}ms`);
            root.style.setProperty('--portal-phase-ms', `${profileTiming.finalResolve}ms`);
            root.classList.add('is-final-resolving');
            const gateWork = sleep(profileTiming.exitLead, token);
            const finalWork = sleep(profileTiming.finalResolve, token);
            void finalWork.then((completed) => {
              if (
                completed
                && isCurrent(token)
                && runToken === finishingRun
              ) root.dataset.finalSettled = 'true';
            }).catch(() => {});
            if (!await gateWork) {
              if (generation !== token) continue;
              return;
            }
          }
          root.dataset.transitionSettled = 'true';
          return;
        }
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
      const switchingToReduce = nextProfile === 'reduce' && currentProfile !== 'reduce';
      const alreadySettled = root.dataset.transitionSettled === 'true';
      currentProfile = nextProfile;
      root.dataset.motionProfile = nextProfile;
      particleField.setProfile(nextProfile);
      if (switchingToReduce && !alreadySettled) switchRunningWorkToReduce();
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
        processing: processingToken !== null || scheduledPump !== null,
        sealed,
        destroyed
      };
    }
  };
}
