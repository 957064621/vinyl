export const PARTICLE_PROFILES = Object.freeze({
  full: Object.freeze({ count: 64, dpr: 1.5, gatherMs: 160, scatterMs: 140 }),
  compact: Object.freeze({ count: 28, dpr: 1.25, gatherMs: 100, scatterMs: 90 }),
  reduce: Object.freeze({ count: 0, dpr: 1, gatherMs: 0, scatterMs: 0 })
});

const PARTICLE_COLORS = Object.freeze([
  Object.freeze({ point: 'rgba(228, 216, 194, 0.82)', line: 'rgba(206, 191, 166, 0.48)' }),
  Object.freeze({ point: 'rgba(199, 214, 220, 0.82)', line: 'rgba(170, 194, 204, 0.48)' })
]);

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;

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
  let currentDpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let particles = [];
  let command = null;
  let frameId = null;
  let frameToken = 0;
  let destroyed = false;

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
    particles = [];
    erase();
    setCanvasData('phase', 'idle');
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

  const pointInBounds = (bounds) => ({
    x: bounds.left + ((bounds.right - bounds.left) * randomUnit()),
    y: bounds.top + ((bounds.bottom - bounds.top) * randomUnit())
  });

  const pointOnPerimeter = () => {
    const edge = Math.floor(randomUnit() * 4);
    const offset = randomUnit();
    if (edge === 0) return { x: cssWidth * offset, y: 0 };
    if (edge === 1) return { x: cssWidth, y: cssHeight * offset };
    if (edge === 2) return { x: cssWidth * offset, y: cssHeight };
    return { x: 0, y: cssHeight * offset };
  };

  const buildParticles = (phase, bounds) => Array.from({ length: settings.count }, (_, index) => {
    const inside = pointInBounds(bounds);
    const outside = pointOnPerimeter();
    const start = phase === 'gather' ? outside : inside;
    const end = phase === 'gather' ? inside : outside;
    return {
      start,
      end,
      radius: 0.8 + (randomUnit() * 0.7),
      trail: 3 + (randomUnit() * 4),
      color: PARTICLE_COLORS[index % PARTICLE_COLORS.length]
    };
  });

  const render = (progress) => {
    erase();
    const eased = progress * progress * (3 - (2 * progress));

    for (const particle of particles) {
      const dx = particle.end.x - particle.start.x;
      const dy = particle.end.y - particle.start.y;
      const x = clamp(particle.start.x + (dx * eased), 0, cssWidth);
      const y = clamp(particle.start.y + (dy * eased), 0, cssHeight);
      const distance = Math.hypot(dx, dy) || 1;
      const lineX = clamp(x - ((dx / distance) * particle.trail), 0, cssWidth);
      const lineY = clamp(y - ((dy / distance) * particle.trail), 0, cssHeight);

      context.beginPath();
      context.fillStyle = particle.color.point;
      context.arc(x, y, particle.radius, 0, Math.PI * 2);
      context.fill();

      context.beginPath();
      context.strokeStyle = particle.color.line;
      context.lineWidth = 0.75;
      context.moveTo(x, y);
      context.lineTo(lineX, lineY);
      context.stroke();
    }
  };

  const isHidden = () => Boolean(documentRef?.hidden);

  const schedule = () => {
    if (!command || destroyed || isHidden() || frameId !== null) return;
    frameToken += 1;
    const token = frameToken;
    frameId = scheduleFrame((timestamp) => onFrame(timestamp, token));
  };

  function onFrame(timestamp, token) {
    if (token !== frameToken) return;
    frameId = null;
    if (!command || destroyed || isHidden()) return;

    const now = finite(timestamp, 0);
    if (command.lastTimestamp === null) {
      command.lastTimestamp = now;
    } else {
      command.elapsed += Math.max(0, now - command.lastTimestamp);
      command.lastTimestamp = now;
    }

    const progress = clamp(command.elapsed / command.duration, 0, 1);
    render(progress);
    const frameCount = Math.max(0, finite(getCanvasData('frameCount'), 0)) + 1;
    setCanvasData('frameCount', frameCount);

    if (progress >= 1) settleCommand();
    else schedule();
  }

  const start = (phase, bounds) => {
    if (destroyed) return Promise.resolve();
    if (command || frameId !== null || particles.length > 0) settleCommand();
    if (profileName !== 'reduce') resize();

    const duration = phase === 'gather' ? settings.gatherMs : settings.scatterMs;
    if (settings.count === 0 || duration === 0) {
      particles = [];
      erase();
      setCanvasData('phase', 'idle');
      return Promise.resolve();
    }

    particles = buildParticles(phase, normalizeBounds(bounds));
    setCanvasData('phase', phase);
    const promise = new Promise((resolve) => {
      command = { duration, elapsed: 0, lastTimestamp: null, resolve };
    });
    schedule();
    return promise;
  };

  const resize = () => {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    cssWidth = Math.max(0, finite(bounds.width, 0));
    cssHeight = Math.max(0, finite(bounds.height, 0));
    const deviceDpr = Math.max(0.01, finite(windowRef?.devicePixelRatio, 1));
    currentDpr = Math.min(deviceDpr, settings.dpr);
    canvas.width = Math.round(cssWidth * currentDpr);
    canvas.height = Math.round(cssHeight * currentDpr);
    context.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);

    for (const particle of particles) {
      for (const point of [particle.start, particle.end]) {
        point.x = clamp(point.x, 0, cssWidth);
        point.y = clamp(point.y, 0, cssHeight);
      }
    }
  };

  const setProfile = (nextProfile) => {
    if (!Object.hasOwn(PARTICLE_PROFILES, nextProfile)) {
      throw new RangeError(`Unknown particle profile: ${nextProfile}`);
    }
    if (destroyed || nextProfile === profileName) return;
    if (command || frameId !== null || particles.length > 0) settleCommand();
    profileName = nextProfile;
    settings = PARTICLE_PROFILES[profileName];
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
    if (!command || destroyed) return;
    command.lastTimestamp = null;
    if (isHidden()) cancelPendingFrame();
    else schedule();
  };

  const destroy = () => {
    if (destroyed) return;
    settleCommand();
    destroyed = true;
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
    canvas.width = 0;
    canvas.height = 0;
  };

  const getState = () => ({
    profile: profileName,
    particleCount: particles.length,
    dpr: currentDpr,
    animating: command !== null,
    destroyed
  });

  setCanvasData('phase', 'idle');
  if (!Number.isFinite(Number(getCanvasData('frameCount')))) setCanvasData('frameCount', 0);
  documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);
  resize();

  return {
    gather: (bounds) => start('gather', bounds),
    scatter: (bounds) => start('scatter', bounds),
    resize,
    setProfile,
    clear,
    finish,
    destroy,
    getState
  };
};
