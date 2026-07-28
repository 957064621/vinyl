export const PARTICLE_PROFILES = Object.freeze({
  full: Object.freeze({ count: 260, holdCount: 104, dpr: 1, gatherMs: 160, scatterMs: 140, holdMs: 500 }),
  compact: Object.freeze({ count: 160, holdCount: 68, dpr: 1, gatherMs: 100, scatterMs: 90, holdMs: 440 }),
  reduce: Object.freeze({ count: 0, holdCount: 0, dpr: 1, gatherMs: 0, scatterMs: 0, holdMs: 0 })
});

const PARTICLE_COLORS = Object.freeze([
  Object.freeze({
    center: 'rgba(255, 255, 255, 1)',
    near: 'rgba(255, 248, 232, 0.96)',
    middle: 'rgba(86, 111, 146, 0.42)',
    edge: 'rgba(24, 36, 54, 0)'
  }),
  Object.freeze({
    center: 'rgba(255, 255, 255, 1)',
    near: 'rgba(207, 229, 255, 0.96)',
    middle: 'rgba(54, 88, 142, 0.46)',
    edge: 'rgba(13, 25, 48, 0)'
  })
]);
const PORTAL_SIDES = Object.freeze(['top', 'bottom']);
const SPRITE_SIZE = 64;

const START_X = 0;
const START_Y = 1;
const CONTROL_X = 2;
const CONTROL_Y = 3;
const END_X = 4;
const END_Y = 5;
const RADIUS = 6;
const DELAY = 7;
const ALPHA_SCALE = 8;
const DECAY = 9;
const ARC_SWAY = 10;
const ARC_PHASE = 11;
const RENDER_X = 12;
const RENDER_Y = 13;
const RENDER_ALPHA = 14;
const PARTICLE_STRIDE = 15;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const interpolate = (start, end, progress) => start + ((end - start) * progress);
const smoothStep = (progress) => progress * progress * (3 - (2 * progress));

export const createLightParticleField = ({
  canvas,
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  profile = 'compact',
  random = Math.random,
  requestFrame,
  cancelFrame
} = {}) => {
  if (!canvas || typeof canvas.getContext !== 'function') {
    throw new TypeError('A canvas is required');
  }
  if (!Object.hasOwn(PARTICLE_PROFILES, profile)) {
    throw new RangeError(`Unknown particle profile: ${profile}`);
  }

  const context = canvas.getContext('2d');
  if (!context) throw new TypeError('A 2D canvas context is required');

  const scheduleFrame = requestFrame
    ?? windowRef?.requestAnimationFrame?.bind(windowRef)
    ?? ((callback) => setTimeout(() => callback(globalThis.performance?.now?.() ?? Date.now()), 16));
  const unscheduleFrame = cancelFrame
    ?? windowRef?.cancelAnimationFrame?.bind(windowRef)
    ?? clearTimeout;

  let profileName = profile;
  let settings = PARTICLE_PROFILES[profileName];
  let particleData = new Float32Array(settings.count * PARTICLE_STRIDE);
  let particleColors = new Uint8Array(settings.count);
  let activeParticleCount = 0;
  let hasRendered = false;
  let currentDpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let command = null;
  let frameId = null;
  let frameToken = 0;
  let destroyed = false;
  let energyAlpha = 0;

  const createParticleSprite = (color) => {
    try {
      const sprite = documentRef?.createElement?.('canvas');
      if (!sprite || typeof sprite.getContext !== 'function') return null;
      sprite.width = SPRITE_SIZE;
      sprite.height = SPRITE_SIZE;
      const spriteContext = sprite.getContext('2d');
      if (!spriteContext || typeof spriteContext.createRadialGradient !== 'function') return null;

      const half = SPRITE_SIZE / 2;
      const gradient = spriteContext.createRadialGradient(half, half, 0, half, half, half);
      gradient.addColorStop(0.025, color.center);
      gradient.addColorStop(0.1, color.near);
      gradient.addColorStop(0.25, color.middle);
      gradient.addColorStop(1, color.edge);
      spriteContext.fillStyle = gradient;
      spriteContext.fillRect(0, 0, SPRITE_SIZE, SPRITE_SIZE);
      return sprite;
    } catch {
      return null;
    }
  };

  let particleSprites = PARTICLE_COLORS.map(createParticleSprite);

  const setCanvasData = (name, value) => {
    if (canvas.dataset) {
      canvas.dataset[name] = String(value);
      return;
    }
    const attribute = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    canvas.setAttribute?.(`data-${attribute}`, String(value));
  };

  const getCanvasData = (name) => {
    if (canvas.dataset) return canvas.dataset[name];
    const attribute = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    return canvas.getAttribute?.(`data-${attribute}`);
  };

  const clearCanvasData = (name) => {
    if (canvas.dataset) {
      delete canvas.dataset[name];
      return;
    }
    const attribute = name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    canvas.removeAttribute?.(`data-${attribute}`);
  };

  const erase = () => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    if (!destroyed) context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
  };

  const cancelPendingFrame = () => {
    frameToken += 1;
    if (frameId === null) return;
    unscheduleFrame(frameId);
    frameId = null;
  };

  const settleCommand = () => {
    cancelPendingFrame();
    const settling = command;
    command = null;
    activeParticleCount = 0;
    hasRendered = false;
    erase();
    setCanvasData('phase', 'idle');
    clearCanvasData('portalSide');
    settling?.resolve();
  };

  const randomUnit = () => clamp(finite(random(), 0.5), 0, 0.999999999);

  const normalizeBounds = (bounds) => {
    const canvasBounds = canvas.getBoundingClientRect();
    const originX = finite(canvasBounds.left, finite(canvasBounds.x, 0));
    const originY = finite(canvasBounds.top, finite(canvasBounds.y, 0));
    const sourceLeft = finite(bounds?.left, finite(bounds?.x, originX));
    const sourceTop = finite(bounds?.top, finite(bounds?.y, originY));
    const sourceRight = finite(bounds?.right, sourceLeft + finite(bounds?.width, cssWidth));
    const sourceBottom = finite(bounds?.bottom, sourceTop + finite(bounds?.height, cssHeight));
    const left = clamp(Math.min(sourceLeft, sourceRight) - originX, 0, cssWidth);
    const right = clamp(Math.max(sourceLeft, sourceRight) - originX, 0, cssWidth);
    const top = clamp(Math.min(sourceTop, sourceBottom) - originY, 0, cssHeight);
    const bottom = clamp(Math.max(sourceTop, sourceBottom) - originY, 0, cssHeight);

    return { left, right, top, bottom };
  };

  const seedPortalParticles = (bounds, portalSide, motionDistance) => {
    activeParticleCount = settings.count;
    hasRendered = false;
    const width = Math.max(1, bounds.right - bounds.left);
    const portalY = portalSide === 'bottom' ? bounds.bottom : bounds.top;
    const inwardDirection = portalSide === 'bottom' ? -1 : 1;
    const numericMotionDistance = Number(motionDistance);
    const resolvedMotionDistance = Number.isFinite(numericMotionDistance)
      && Math.abs(numericMotionDistance) > 0
      ? Math.abs(numericMotionDistance)
      : null;
    const motionTravel = resolvedMotionDistance === null
      ? null
      : clamp(resolvedMotionDistance * 0.18, 56, 128);

    for (let index = 0; index < activeParticleCount; index += 1) {
      const offset = index * PARTICLE_STRIDE;
      const horizontalUnit = randomUnit();
      const curveUnit = randomUnit();
      const portalX = clamp(bounds.left + (width * horizontalUnit), 0, cssWidth);
      const horizontalBias = curveUnit - 0.5;
      const originJitter = (randomUnit() - 0.5) * 3;
      const travelUnit = randomUnit();
      const travel = motionTravel === null
        ? 36 + (travelUnit * 64)
        : clamp(motionTravel * (0.88 + (travelUnit * 0.24)), 56, 128);
      const trajectoryProgress = motionTravel !== null && index % 4 === 0
        ? 0.16 + (curveUnit * 0.52)
        : 0;
      const trajectoryOffset = travel * trajectoryProgress;
      const startY = clamp(
        portalY + (inwardDirection * trajectoryOffset) + originJitter,
        0,
        cssHeight
      );
      const endY = clamp(portalY + (inwardDirection * travel), 0, cssHeight);
      const horizontalDrift = horizontalBias * (12 + (travel * 0.4));
      const bendDirection = index % 2 === 0 ? -1 : 1;
      const bend = bendDirection * (5 + (Math.abs(horizontalBias) * 12) + (travel * 0.06));
      const controlProgress = 0.26 + ((index % 7) * 0.035);
      const tipTaper = Math.sin(Math.PI * horizontalUnit) ** 0.45;

      particleData[offset + START_X] = portalX;
      particleData[offset + START_Y] = startY;
      particleData[offset + CONTROL_X] = clamp(
        portalX + (horizontalDrift * 0.28) + bend,
        0,
        cssWidth
      );
      particleData[offset + CONTROL_Y] = clamp(
        interpolate(startY, endY, controlProgress),
        0,
        cssHeight
      );
      particleData[offset + END_X] = clamp(portalX + horizontalDrift, 0, cssWidth);
      particleData[offset + END_Y] = endY;
      particleData[offset + RADIUS] = 0.55 + (randomUnit() * 0.9);
      particleData[offset + DELAY] = Math.min(0.28, (randomUnit() * 0.2) + (trajectoryProgress * 0.1));
      particleData[offset + ALPHA_SCALE] = (0.68 + (randomUnit() * 0.32)) * (0.58 + (tipTaper * 0.42));
      particleData[offset + DECAY] = 0.72 + (randomUnit() * 0.9);
      particleData[offset + ARC_SWAY] = bendDirection * (3 + (travel * 0.045));
      particleData[offset + ARC_PHASE] = (((index % 11) / 11) * Math.PI * 2) + (curveUnit * Math.PI);
      particleData[offset + RENDER_ALPHA] = 0;
      particleColors[index] = index % PARTICLE_COLORS.length;
    }
  };

  const seedHoldParticles = (bounds) => {
    activeParticleCount = settings.holdCount;
    hasRendered = false;
    const width = Math.max(1, bounds.right - bounds.left);
    const availableDepth = Math.max(12, cssHeight - bounds.bottom - 4);
    const fieldDepth = Math.min(64, Math.max(28, availableDepth));
    const floorY = clamp(bounds.bottom + 4, 0, Math.max(0, cssHeight - 4));

    for (let index = 0; index < activeParticleCount; index += 1) {
      const offset = index * PARTICLE_STRIDE;
      const horizontalUnit = 0.1 + (randomUnit() * 0.8);
      const depthUnit = randomUnit();
      const startX = clamp(bounds.left + (width * horizontalUnit), 0, cssWidth);
      const startY = clamp(floorY + (fieldDepth * depthUnit), 0, cssHeight);
      const sideDrift = (randomUnit() - 0.5) * Math.min(30, width * 0.12);
      const rise = 8 + (randomUnit() * Math.min(28, fieldDepth * 0.62));
      const sway = (index % 2 === 0 ? -1 : 1) * (3 + (randomUnit() * 8));

      particleData[offset + START_X] = startX;
      particleData[offset + START_Y] = startY;
      particleData[offset + CONTROL_X] = clamp(startX + (sideDrift * 0.42) + sway, 0, cssWidth);
      particleData[offset + CONTROL_Y] = clamp(startY - (rise * 0.46), 0, cssHeight);
      particleData[offset + END_X] = clamp(startX + sideDrift, 0, cssWidth);
      particleData[offset + END_Y] = clamp(startY - rise, 0, cssHeight);
      particleData[offset + RADIUS] = 0.42 + (randomUnit() * 0.72);
      particleData[offset + DELAY] = randomUnit() * 0.22;
      particleData[offset + ALPHA_SCALE] = 0.42 + (randomUnit() * 0.4);
      particleData[offset + DECAY] = 0.36 + (randomUnit() * 0.34);
      particleData[offset + ARC_SWAY] = sway;
      particleData[offset + ARC_PHASE] = (((index % 13) / 13) * Math.PI * 2) + (randomUnit() * 0.7);
      particleData[offset + RENDER_ALPHA] = 0;
      particleColors[index] = index % PARTICLE_COLORS.length;
    }
  };

  const updateEnergy = (phase, progress) => {
    if (phase === 'hold') {
      if (progress <= 0.18) {
        energyAlpha = interpolate(0, 0.34, progress / 0.18);
        return;
      }
      if (progress <= 0.76) {
        const drift = (progress - 0.18) / 0.58;
        energyAlpha = 0.3 + (Math.sin(drift * Math.PI) * 0.04);
        return;
      }
      energyAlpha = Math.max(0, interpolate(0.3, 0, (progress - 0.76) / 0.24));
      return;
    }

    if (phase === 'gather') {
      if (progress <= 0.42) {
        const segment = progress / 0.42;
        energyAlpha = interpolate(0.08, 0.74, segment);
        return;
      }
      const segment = (progress - 0.42) / 0.58;
      energyAlpha = Math.max(0, interpolate(0.74, 0, segment));
      return;
    }

    if (progress <= 0.45) {
      const segment = progress / 0.45;
      energyAlpha = interpolate(0.72, 0.52, segment);
      return;
    }
    const segment = (progress - 0.45) / 0.55;
    energyAlpha = Math.max(0, interpolate(0.52, 0, segment));
  };

  const drawParticle = (index, x, y, alpha) => {
    const offset = index * PARTICLE_STRIDE;
    const colorIndex = particleColors[index];
    const sprite = particleSprites[colorIndex];
    const radius = particleData[offset + RADIUS];
    const spriteExtent = radius * 15;

    context.globalAlpha = alpha;
    if (sprite && typeof context.drawImage === 'function') {
      context.drawImage(
        sprite,
        x - (spriteExtent / 2),
        y - (spriteExtent / 2),
        spriteExtent,
        spriteExtent
      );
      return;
    }

    context.beginPath();
    context.fillStyle = PARTICLE_COLORS[colorIndex].middle;
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
  };

  const render = (progress) => {
    erase();
    updateEnergy(command?.phase ?? 'scatter', progress);
    const previousCompositeOperation = context.globalCompositeOperation;
    context.globalCompositeOperation = 'lighter';

    try {
      for (let index = 0; index < activeParticleCount; index += 1) {
        const offset = index * PARTICLE_STRIDE;
        const delay = particleData[offset + DELAY];
        const localProgress = clamp((progress - delay) / (1 - delay), 0, 1);
        const holding = command?.phase === 'hold';
        const eased = holding
          ? smoothStep(localProgress)
          : 1 - ((1 - localProgress) ** (2.05 + ((index % 5) * 0.22)));
        const inverse = 1 - eased;
        const arcEnvelope = Math.sin(Math.PI * eased);
        const x = clamp(
          (inverse * inverse * particleData[offset + START_X])
          + (2 * inverse * eased * particleData[offset + CONTROL_X])
          + (eased * eased * particleData[offset + END_X])
          + (
            Math.sin(particleData[offset + ARC_PHASE] + (eased * Math.PI * 1.35))
            * arcEnvelope
            * particleData[offset + ARC_SWAY]
          ),
          0,
          cssWidth
        );
        const y = clamp(
          (inverse * inverse * particleData[offset + START_Y])
          + (2 * inverse * eased * particleData[offset + CONTROL_Y])
          + (eased * eased * particleData[offset + END_Y]),
          0,
          cssHeight
        );
        const birth = progress < delay
          ? 0
          : smoothStep(clamp(localProgress / (holding ? 0.16 : 0.1), 0, 1));
        const timeFade = holding
          ? smoothStep(clamp((1 - localProgress) / 0.18, 0, 1))
          : smoothStep(1 - localProgress) ** particleData[offset + DECAY];
        const distanceFade = holding
          ? 1
          : Math.max(0, 1 - (eased * 0.82)) ** 0.48;
        const pulse = holding
          ? 0.72 + (0.28 * Math.sin((localProgress * Math.PI * 2) + particleData[offset + ARC_PHASE]))
          : 0.76 + (0.24 * Math.sin(Math.PI * clamp(localProgress / 0.82, 0, 1)));
        const alpha = energyAlpha
          * particleData[offset + ALPHA_SCALE]
          * birth
          * timeFade
          * distanceFade
          * pulse;

        drawParticle(index, x, y, alpha);
        particleData[offset + RENDER_X] = x;
        particleData[offset + RENDER_Y] = y;
        particleData[offset + RENDER_ALPHA] = alpha;
      }
      hasRendered = activeParticleCount > 0;
    } finally {
      context.globalAlpha = 1;
      context.globalCompositeOperation = previousCompositeOperation || 'source-over';
    }
  };

  const redrawRendered = () => {
    erase();
    if (!hasRendered) return;
    const previousCompositeOperation = context.globalCompositeOperation;
    context.globalCompositeOperation = 'lighter';
    try {
      for (let index = 0; index < activeParticleCount; index += 1) {
        const offset = index * PARTICLE_STRIDE;
        drawParticle(
          index,
          particleData[offset + RENDER_X],
          particleData[offset + RENDER_Y],
          particleData[offset + RENDER_ALPHA]
        );
      }
    } finally {
      context.globalAlpha = 1;
      context.globalCompositeOperation = previousCompositeOperation || 'source-over';
    }
  };

  const isHidden = () => Boolean(documentRef?.hidden);

  const schedule = () => {
    if (!command || destroyed || isHidden() || frameId !== null) return;
    frameId = scheduleFrame(command.frameCallback);
  };

  function onFrame(timestamp, token) {
    if (token !== frameToken) return;
    frameId = null;
    if (!command || destroyed) return;
    if (isHidden()) {
      settleCommand();
      return;
    }

    const now = finite(timestamp, 0);
    if (command.lastTimestamp === null) {
      command.lastTimestamp = now;
    } else {
      command.elapsed += Math.max(0, now - command.lastTimestamp);
      command.lastTimestamp = now;
    }

    const progress = clamp(command.elapsed / command.duration, 0, 1);
    try {
      render(progress);
    } catch {
      settleCommand();
      return;
    }
    const frameCount = Math.max(0, finite(getCanvasData('frameCount'), 0)) + 1;
    setCanvasData('frameCount', frameCount);

    if (progress >= 1) settleCommand();
    else schedule();
  }

  const start = (phase, bounds, durationMs, { portalSide, motionDistance } = {}) => {
    if (destroyed) return Promise.resolve();
    if (command || frameId !== null || activeParticleCount > 0) settleCommand();
    if (profileName !== 'reduce') resize();

    const resolvedPortalSide = phase === 'hold'
      ? null
      : (PORTAL_SIDES.includes(portalSide)
          ? portalSide
          : (phase === 'scatter' ? 'bottom' : 'top'));
    const defaultDuration = phase === 'gather'
      ? settings.gatherMs
      : (phase === 'hold' ? settings.holdMs : settings.scatterMs);
    const duration = Math.max(
      0,
      finite(durationMs, defaultDuration)
    );
    if (settings.count === 0 || duration === 0 || isHidden()) {
      activeParticleCount = 0;
      hasRendered = false;
      erase();
      setCanvasData('phase', 'idle');
      clearCanvasData('portalSide');
      return Promise.resolve();
    }

    const normalizedBounds = normalizeBounds(bounds);
    if (phase === 'hold') seedHoldParticles(normalizedBounds);
    else seedPortalParticles(normalizedBounds, resolvedPortalSide, motionDistance);
    setCanvasData('phase', phase);
    if (resolvedPortalSide) setCanvasData('portalSide', resolvedPortalSide);
    else clearCanvasData('portalSide');
    const promise = new Promise((resolve) => {
      frameToken += 1;
      const token = frameToken;
      command = {
        phase,
        duration,
        elapsed: 0,
        lastTimestamp: null,
        resolve,
        frameCallback: (timestamp) => onFrame(timestamp, token)
      };
    });
    schedule();
    return promise;
  };

  const resize = () => {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    const previousWidth = cssWidth;
    const previousHeight = cssHeight;
    const nextWidth = Math.max(0, finite(bounds.width, 0));
    const nextHeight = Math.max(0, finite(bounds.height, 0));
    const deviceDpr = Math.max(0.01, finite(windowRef?.devicePixelRatio, 1));
    const nextDpr = Math.min(deviceDpr, settings.dpr);
    const backingWidth = Math.round(nextWidth * nextDpr);
    const backingHeight = Math.round(nextHeight * nextDpr);
    const backingChanged = canvas.width !== backingWidth || canvas.height !== backingHeight;
    const sizeChanged = previousWidth !== nextWidth || previousHeight !== nextHeight;
    const scaleX = previousWidth > 0 ? nextWidth / previousWidth : 1;
    const scaleY = previousHeight > 0 ? nextHeight / previousHeight : 1;

    cssWidth = nextWidth;
    cssHeight = nextHeight;
    currentDpr = nextDpr;
    if (canvas.width !== backingWidth) canvas.width = backingWidth;
    if (canvas.height !== backingHeight) canvas.height = backingHeight;
    context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

    if (sizeChanged) {
      for (let index = 0; index < activeParticleCount; index += 1) {
        const offset = index * PARTICLE_STRIDE;
        particleData[offset + START_X] = clamp(particleData[offset + START_X] * scaleX, 0, cssWidth);
        particleData[offset + CONTROL_X] = clamp(particleData[offset + CONTROL_X] * scaleX, 0, cssWidth);
        particleData[offset + END_X] = clamp(particleData[offset + END_X] * scaleX, 0, cssWidth);
        particleData[offset + RENDER_X] = clamp(particleData[offset + RENDER_X] * scaleX, 0, cssWidth);
        particleData[offset + START_Y] = clamp(particleData[offset + START_Y] * scaleY, 0, cssHeight);
        particleData[offset + CONTROL_Y] = clamp(particleData[offset + CONTROL_Y] * scaleY, 0, cssHeight);
        particleData[offset + END_Y] = clamp(particleData[offset + END_Y] * scaleY, 0, cssHeight);
        particleData[offset + RENDER_Y] = clamp(particleData[offset + RENDER_Y] * scaleY, 0, cssHeight);
        particleData[offset + ARC_SWAY] *= scaleX;
      }
    }

    if ((sizeChanged || backingChanged) && hasRendered) redrawRendered();
  };

  const setProfile = (nextProfile) => {
    if (!Object.hasOwn(PARTICLE_PROFILES, nextProfile)) {
      throw new RangeError(`Unknown particle profile: ${nextProfile}`);
    }
    if (destroyed || nextProfile === profileName) return;
    if (command || frameId !== null || activeParticleCount > 0) settleCommand();
    profileName = nextProfile;
    settings = PARTICLE_PROFILES[profileName];
    particleData = new Float32Array(settings.count * PARTICLE_STRIDE);
    particleColors = new Uint8Array(settings.count);
    resize();
  };

  const clear = () => {
    if (destroyed) return;
    settleCommand();
  };

  const finish = () => {
    if (destroyed) return;
    settleCommand();
  };

  const onVisibilityChange = () => {
    if (destroyed || !isHidden()) return;
    if (command || frameId !== null || activeParticleCount > 0) settleCommand();
  };

  const destroy = () => {
    if (destroyed) return;
    settleCommand();
    destroyed = true;
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
    for (const sprite of particleSprites) {
      if (!sprite) continue;
      sprite.width = 0;
      sprite.height = 0;
    }
    particleSprites = [];
    particleData = new Float32Array(0);
    particleColors = new Uint8Array(0);
    canvas.width = 0;
    canvas.height = 0;
  };

  const getState = () => ({
    profile: profileName,
    particleCount: activeParticleCount,
    dpr: currentDpr,
    animating: command !== null,
    destroyed
  });

  setCanvasData('phase', 'idle');
  if (!Number.isFinite(Number(getCanvasData('frameCount')))) setCanvasData('frameCount', 0);
  documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);
  resize();

  return {
    gather: (bounds, durationMs, options) => start('gather', bounds, durationMs, options),
    scatter: (bounds, durationMs, options) => start('scatter', bounds, durationMs, options),
    hold: (bounds, durationMs) => start('hold', bounds, durationMs),
    resize,
    setProfile,
    clear,
    finish,
    destroy,
    getState
  };
};
