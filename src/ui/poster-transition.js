export const PORTAL_DURATION = 760;

export const POSTER_TIMING = Object.freeze({
  full: Object.freeze({
    normal: Object.freeze({ gather: 220, handoff: 520, exit: 520, hold: 700 }),
    compressed: Object.freeze({ gather: 220, handoff: 520, exit: 520, hold: 480 }),
    finalHold: 840,
    finalResolve: 1280,
    exitLead: 1280,
    rootFade: 680
  }),
  compact: Object.freeze({
    normal: Object.freeze({ gather: 220, handoff: 520, exit: 520, hold: 760 }),
    compressed: Object.freeze({ gather: 220, handoff: 520, exit: 520, hold: 520 }),
    finalHold: 900,
    finalResolve: 1280,
    exitLead: 1280,
    rootFade: 760
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
  portals,
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
  const portalNodes = portals ?? { top: slit, bottom: slit };
  if (!portalNodes?.top?.classList || !portalNodes.top.dataset
    || !portalNodes?.bottom?.classList || !portalNodes.bottom.dataset) {
    throw new TypeError('Poster transition top and bottom portals are required');
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
  let fixedPortalGeometry = null;
  const portalOrientation = 'horizontal';
  const idleWaiters = new Set();

  const slots = () => [...root.querySelectorAll('[data-loading-slot]')];
  const portalFor = (side) => portalNodes[side];

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
    slot.style.removeProperty('--seam-inset');
    slot.style.removeProperty('--poster-portal-offset');
  };

  const clearPortalState = () => {
    root.classList.remove('is-scanning', 'is-portal-active');
    for (const portal of new Set(Object.values(portalNodes))) {
      portal.classList.remove('is-lit');
      delete portal.dataset.portalPhase;
      delete portal.dataset.motionProfile;
      delete portal.dataset.direction;
    }
    delete root.dataset.portalSide;
    delete root.dataset.portalPhase;
    root.style.removeProperty('--slit-duration');
    root.style.removeProperty('--portal-phase-ms');
    root.style.removeProperty('--gate-x');
    root.style.removeProperty('--gate-y');
    root.style.removeProperty('--gate-height');
    root.style.removeProperty('--gate-width');
    root.style.removeProperty('--portal-gap');
  };

  // 用 contain 布局的实际画面盒定位光隧道：洞口高度贴合画面，
  // 洞口停在画面边缘外一段间距处；显影缝隙（取景框裁切平面）钉在洞口中心。
  const artMetrics = (item, side) => {
    try {
      const slotBounds = item?.slot?.getBoundingClientRect?.();
      const stageBounds = portalFor('top')?.parentElement?.getBoundingClientRect?.();
      const naturalWidth = Number(item?.image?.naturalWidth);
      const naturalHeight = Number(item?.image?.naturalHeight);
      const stageWidth = Number(stageBounds?.width);
      const stageHeight = Number(stageBounds?.height);
      const rootBounds = root.getBoundingClientRect?.();
      if (
        !slotBounds
        || !stageBounds
        || !(slotBounds.width > 0)
        || !(slotBounds.height > 0)
        || !(stageWidth > 0)
        || !(stageHeight > 0)
        || !(naturalWidth > 0)
        || !(naturalHeight > 0)
      ) return null;

      const containRatio = Math.min(slotBounds.width / naturalWidth, slotBounds.height / naturalHeight);
      const artWidth = naturalWidth * containRatio;
      const artHeight = naturalHeight * containRatio;
      const insetX = Math.max(0, (slotBounds.width - artWidth) / 2);
      const insetY = Math.max(0, (slotBounds.height - artHeight) / 2);
      const artLeft = slotBounds.left + insetX;
      const artRight = artLeft + artWidth;
      const artTop = slotBounds.top + insetY;
      const artBottom = artTop + artHeight;
      const hasRootBounds = Number(rootBounds?.width) > 0 && Number(rootBounds?.height) > 0;
      const boundaryLeft = hasRootBounds ? Number(rootBounds.left) : Number(stageBounds.left);
      const boundaryRight = hasRootBounds ? Number(rootBounds.right) : Number(stageBounds.right);
      const boundaryTop = hasRootBounds ? Number(rootBounds.top) : Number(stageBounds.top);
      const boundaryBottom = hasRootBounds ? Number(rootBounds.bottom) : Number(stageBounds.bottom);
      const desiredGap = Math.max(20, Math.min(38, artHeight * 0.055));
      if (!fixedPortalGeometry) {
        const topY = Math.max(boundaryTop + 12, artTop - desiredGap);
        const bottomY = artBottom + desiredGap;
        const availableWidth = Math.max(1, boundaryRight - boundaryLeft - 24);
        const width = Math.max(1, Math.min(artWidth * 1.08, availableWidth));
        const height = Math.max(112, Math.min(168, width / 4.4));
        const minimumX = boundaryLeft + 12 + (width / 2);
        const maximumX = boundaryRight - 12 - (width / 2);
        const artworkCenterX = artLeft + (artWidth / 2);
        const screenX = Math.min(maximumX, Math.max(minimumX, artworkCenterX));
        fixedPortalGeometry = {
          topY,
          bottomY,
          screenX,
          width,
          height,
          offsets: {
            top: Math.min(
              124,
              Math.max(110, 100 + (((Math.max(0, artTop - topY) + 10) / artHeight) * 100))
            ),
            bottom: Math.min(
              124,
              Math.max(110, 100 + (((Math.max(0, bottomY - artBottom) + 10) / artHeight) * 100))
            )
          }
        };
      }
      const portalScreenY = side === 'bottom'
        ? fixedPortalGeometry.bottomY
        : fixedPortalGeometry.topY;
      const portalGap = side === 'bottom'
        ? Math.max(0, portalScreenY - artBottom)
        : Math.max(0, artTop - portalScreenY);
      const seamPercent = side === 'bottom'
        ? ((slotBounds.bottom - portalScreenY) / slotBounds.height) * 100
        : ((portalScreenY - slotBounds.top) / slotBounds.height) * 100;
      const gateWidth = fixedPortalGeometry.width;
      const gateHeight = fixedPortalGeometry.height;
      const portalScreenX = fixedPortalGeometry.screenX;
      const portalStageX = portalScreenX - stageBounds.left;
      const portalOffset = fixedPortalGeometry.offsets[side];
      const motionDistance = slotBounds.height * (portalOffset / 100);
      return {
        artBounds: {
          left: artLeft,
          right: artRight,
          top: artTop,
          bottom: artBottom,
          width: artWidth,
          height: artHeight
        },
        particleBounds: {
          left: portalScreenX - (gateWidth / 2),
          right: portalScreenX + (gateWidth / 2),
          top: portalScreenY,
          bottom: portalScreenY,
          width: gateWidth,
          height: 0
        },
        artHeight,
        gateHeight,
        gateWidth,
        portalGap,
        portalOffset,
        motionDistance,
        portalScreenY,
        portalStageX,
        portalStageY: portalScreenY - stageBounds.top,
        stageLeft: stageBounds.left,
        stageTop: stageBounds.top,
        seamPercent,
        artWidth,
        artBottomInSlot: insetY + artHeight,
        artTopInSlot: insetY,
        floatWidth: Math.max(72, artWidth * 0.78),
        floatHeight: Math.max(26, Math.min(52, artHeight * 0.072)),
        artTop,
        slotBounds
      };
    } catch {
      return null;
    }
  };

  // 光门位置、高度与裁切缝都来自当前海报的实际画面盒。
  const applyGateMetrics = (item, side) => {
    const metrics = artMetrics(item, side);
    if (!metrics) {
      root.style.removeProperty('--gate-x');
      root.style.removeProperty('--gate-y');
      root.style.removeProperty('--gate-height');
      root.style.removeProperty('--gate-width');
      item?.slot?.style?.removeProperty?.('--seam-inset');
      item?.slot?.style?.removeProperty?.('--poster-art-bottom');
      item?.slot?.style?.removeProperty?.('--poster-art-top');
      item?.slot?.style?.removeProperty?.('--poster-art-height');
      item?.slot?.style?.removeProperty?.('--poster-float-width');
      item?.slot?.style?.removeProperty?.('--poster-float-height');
      item?.slot?.style?.removeProperty?.('--poster-portal-offset');
      return null;
    }
    root.style.setProperty('--gate-x', `${metrics.portalStageX.toFixed(2)}px`);
    root.style.setProperty('--gate-y', `${metrics.portalStageY.toFixed(2)}px`);
    root.style.setProperty('--gate-height', `${metrics.gateHeight.toFixed(2)}px`);
    root.style.setProperty('--gate-width', `${metrics.gateWidth.toFixed(2)}px`);
    root.style.setProperty('--portal-gap', `${metrics.portalGap.toFixed(2)}px`);
    for (const [portal, portalY] of [
      [portalFor('top'), fixedPortalGeometry.topY],
      [portalFor('bottom'), fixedPortalGeometry.bottomY]
    ]) {
      portal.style.setProperty(
        '--portal-x',
        `${(fixedPortalGeometry.screenX - metrics.stageLeft).toFixed(2)}px`
      );
      portal.style.setProperty('--portal-y', `${(portalY - metrics.stageTop).toFixed(2)}px`);
      portal.style.setProperty('--portal-width', `${fixedPortalGeometry.width.toFixed(2)}px`);
      portal.style.setProperty('--portal-height', `${fixedPortalGeometry.height.toFixed(2)}px`);
    }
    item.slot.style.setProperty('--seam-inset', `${metrics.seamPercent.toFixed(3)}%`);
    item.slot.style.setProperty(
      '--poster-portal-offset',
      `${side === 'top' ? '-' : ''}${metrics.portalOffset.toFixed(3)}%`
    );
    item.slot.style.setProperty('--poster-art-bottom', `${metrics.artBottomInSlot.toFixed(2)}px`);
    item.slot.style.setProperty('--poster-art-top', `${metrics.artTopInSlot.toFixed(2)}px`);
    item.slot.style.setProperty('--poster-art-height', `${metrics.artHeight.toFixed(2)}px`);
    item.slot.style.setProperty('--poster-float-width', `${metrics.floatWidth.toFixed(2)}px`);
    item.slot.style.setProperty('--poster-float-height', `${metrics.floatHeight.toFixed(2)}px`);
    return metrics;
  };

  const holdParticles = (item, duration) => {
    if (!item || typeof particleField.hold !== 'function') return Promise.resolve();
    const bounds = artMetrics(item, 'bottom')?.artBounds ?? item.slot.getBoundingClientRect();
    return Promise.resolve(particleField.hold(bounds, duration, { portalSide: 'bottom' }));
  };

  // 门只在有限的进入或离开包络中点亮，稳定驻留时保持熄灭。
  const activatePortal = (side, phase, sceneProfile, duration) => {
    const portal = portalFor(side);
    particleField.setPortalSide?.(side);
    root.dataset.portalSide = side;
    root.dataset.portalPhase = phase;
    portal.dataset.direction = portalOrientation;
    portal.dataset.portalSide = side;
    portal.dataset.portalPhase = phase;
    portal.dataset.motionProfile = sceneProfile;
    root.style.setProperty('--slit-duration', `${duration}ms`);
    root.style.setProperty('--portal-phase-ms', `${duration}ms`);
    root.classList.add('is-scanning', 'is-portal-active');
    portal.classList.add('is-lit');
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
    if (sealed && queue.length === 0) item.slot.dataset.finalPoster = 'true';
    const outgoing = activeItem;
    if (outgoing) {
      const exitMetrics = applyGateMetrics(outgoing, 'bottom');
      activatePortal('bottom', 'exit', sceneProfile, PORTAL_DURATION);
      if (!await sleep(timing.gather, token)) return;
      if (!isCurrent(token)) return;

      setActive(outgoing, false);
      outgoing.slot.dataset.motionProfile = sceneProfile;
      outgoing.slot.dataset.portalSide = 'bottom';
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
          exitMetrics?.particleBounds ?? outgoing.slot.getBoundingClientRect(),
          timing.exit,
          {
            portalSide: 'bottom',
            motionDistance: exitMetrics?.motionDistance,
            trajectory: {
              distance: exitMetrics?.motionDistance,
              ...(Number.isFinite(exitMetrics?.portalGap)
                ? { trailDistance: exitMetrics.portalGap }
                : {}),
              duration: timing.exit,
              easing: 'cubic-bezier(0.64, 0, 0.78, 0)',
              directionY: 1
            }
          }
        )),
        sleep(timing.exit, token)
      ]);
      if (!isCurrent(token) || exited === false) return;
      const exitTail = Math.max(0, PORTAL_DURATION - timing.gather - timing.exit);
      if (exitTail > 0 && !await sleep(exitTail, token)) return;
      outgoing.slot.classList.remove('is-outgoing', 'is-scattering');
      outgoing.slot.style.removeProperty('--poster-handoff-ms');
      clearSlotPortalState(outgoing.slot);
      clearPortalState();
    }

    const enterMetrics = applyGateMetrics(item, 'top');
    activatePortal('top', 'enter', sceneProfile, PORTAL_DURATION);
    if (!await sleep(timing.gather, token)) return;
    if (!isCurrent(token)) return;

    activeItem = item;
    completedReadableHold = 0;
    setActive(activeItem, true);
    activeItem.slot.dataset.portalSide = 'top';
    activeItem.slot.dataset.portalPhase = 'enter';
    activeItem.slot.style.setProperty('--poster-enter-ms', `${timing.handoff}ms`);
    activeItem.slot.style.setProperty('--poster-handoff-ms', `${timing.handoff}ms`);
    activeItem.slot.classList.add('is-revealing', 'is-entering', 'is-entering-from-portal');
    const [, entered] = await Promise.all([
      Promise.resolve(particleField.gather(
        enterMetrics?.particleBounds ?? activeItem.slot.getBoundingClientRect(),
        timing.handoff,
        {
          portalSide: 'top',
          motionDistance: enterMetrics?.motionDistance,
          trajectory: {
            distance: enterMetrics?.motionDistance,
            ...(Number.isFinite(enterMetrics?.portalGap)
              ? { trailDistance: enterMetrics.portalGap }
              : {}),
            duration: timing.handoff,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            directionY: 1
          }
        }
      )),
      sleep(timing.handoff, token)
    ]);
    if (!isCurrent(token) || entered === false) return;
    const enterTail = Math.max(0, PORTAL_DURATION - timing.gather - timing.handoff);
    if (enterTail > 0 && !await sleep(enterTail, token)) return;
    activeItem.slot.classList.remove('is-revealing');
    clearSlotPortalState(activeItem.slot);
    activeItem.slot.classList.add('is-stable');
    activeItem.slot.style.removeProperty('--poster-handoff-ms');
    clearPortalState();

    const finalItem = sealed && queue.length === 0;
    const profileTiming = POSTER_TIMING[sceneProfile];
    const hold = finalItem ? profileTiming.finalHold : timing.hold;
    const [, held] = await Promise.all([
      holdParticles(item, hold),
      sleep(hold, token)
    ]);
    if (held && activeItem === item) {
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
      delete slot.dataset.finalPoster;
      slot.style.removeProperty('--poster-handoff-ms');
      slot.style.removeProperty('--poster-art-bottom');
      slot.style.removeProperty('--poster-art-top');
      slot.style.removeProperty('--poster-art-height');
      slot.style.removeProperty('--poster-float-width');
      slot.style.removeProperty('--poster-float-height');
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
    if (!preserveActive) fixedPortalGeometry = null;
    clearPortalState();
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

    skipTo(slot) {
      if (destroyed) return false;

      const retainedItem = queue.find((item) => item.slot === slot) ?? null;
      const liveSlots = [activeItem?.slot, currentItem?.slot].filter(Boolean);
      queue = [];
      compressedDrain = false;
      accepted = new Set(liveSlots);

      const image = imageFor(slot);
      if (!slot || !image) {
        notifyIdle();
        return false;
      }

      accepted.add(slot);
      image.setAttribute('aria-hidden', 'true');
      if (liveSlots.includes(slot)) {
        notifyIdle();
        return true;
      }

      const item = retainedItem ?? {
        slot,
        image,
        order: accepted.size,
        direction: portalOrientation
      };
      slot.dataset.transitionOrder = String(item.order);
      slot.dataset.slitDirection = item.direction;
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
            activeItem.slot.dataset.finalPoster = 'true';
            const profileTiming = POSTER_TIMING[finalSceneProfile];
            const remainingHold = Math.max(
              0,
              profileTiming.finalHold - completedReadableHold
            );
            if (remainingHold > 0) {
              // The arrival wake already owns the particle tail. Extending the
              // readable pause must not seed a second ambient cohort.
              const held = await sleep(remainingHold, token);
              if (!held) {
                if (generation !== token) continue;
                return;
              }
              completedReadableHold += remainingHold;
            }
          }

          if (finalSceneProfile !== 'reduce') {
            const profileTiming = POSTER_TIMING[finalSceneProfile];
            settleParticleField();            onFinalScene({
              slot: activeItem?.slot ?? null,
              image: activeItem?.image ?? null,
              profile: finalSceneProfile
            });
            root.dataset.portalSide = 'center';
            root.dataset.portalPhase = 'final-handoff';
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

    reset({ preserveActive = false } = {}) {
      if (destroyed) return;
      cancelWork({ preserveActive });
      accepted = new Set(preserveActive && activeItem ? [activeItem.slot] : []);
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

    resize() {
      // Portal geometry is intentionally locked for a loading run. The particle
      // field owns its own canvas resize without moving either fixed portal.
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
