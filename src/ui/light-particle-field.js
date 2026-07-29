export const PARTICLE_PROFILES = Object.freeze({
  full: Object.freeze({ count: 320, holdCount: 112, dpr: 1, gatherMs: 160, scatterMs: 140, holdMs: 500 }),
  compact: Object.freeze({ count: 180, holdCount: 64, dpr: 1, gatherMs: 100, scatterMs: 90, holdMs: 440 }),
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
const DEFAULT_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SPRITE_SIZE = 64;

const PARTICLE_PORTAL = 1;
const PARTICLE_TRAIL = 2;
const PARTICLE_HOLD = 3;

const POSITION_X = 0;
const POSITION_Y = 1;
const VELOCITY_X = 2;
const VELOCITY_Y = 3;
const RADIUS = 4;
const AGE = 5;
const LIFE = 6;
const OPACITY = 7;
const DRAG = 8;
const SWAY = 9;
const SWAY_RATE = 10;
const RENDER_ALPHA = 11;
const PARTICLE_STRIDE = 12;

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const smoothStep = (progress) => progress * progress * (3 - (2 * progress));

const cubicCoordinate = (time, point1, point2) => {
  const inverse = 1 - time;
  return (3 * inverse * inverse * time * point1)
    + (3 * inverse * time * time * point2)
    + (time * time * time);
};

const cubicDerivative = (time, point1, point2) => {
  const inverse = 1 - time;
  return (3 * inverse * inverse * point1)
    + (6 * inverse * time * (point2 - point1))
    + (3 * time * time * (1 - point2));
};

const createCubicBezier = (x1, y1, x2, y2) => {
  const controlX1 = clamp(finite(x1, 0.22), 0, 1);
  const controlX2 = clamp(finite(x2, 0.36), 0, 1);
  const controlY1 = finite(y1, 1);
  const controlY2 = finite(y2, 1);

  return (progress) => {
    const target = clamp(progress, 0, 1);
    if (target === 0 || target === 1) return target;

    let time = target;
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const error = cubicCoordinate(time, controlX1, controlX2) - target;
      const slope = cubicDerivative(time, controlX1, controlX2);
      if (Math.abs(error) < 0.00001 || Math.abs(slope) < 0.00001) break;
      time = clamp(time - (error / slope), 0, 1);
    }

    let lower = 0;
    let upper = 1;
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const value = cubicCoordinate(time, controlX1, controlX2);
      if (Math.abs(value - target) < 0.00001) break;
      if (value < target) lower = time;
      else upper = time;
      time = (lower + upper) / 2;
    }
    return cubicCoordinate(time, controlY1, controlY2);
  };
};

const normalizeEasing = (input) => {
  if (typeof input === 'function') {
    return {
      sample: (progress) => finite(input(clamp(progress, 0, 1)), progress),
      derivative: null
    };
  }

  if (input && typeof input === 'object') {
    const sample = input.sample ?? input.ease;
    if (typeof sample === 'function') {
      return {
        sample: (progress) => finite(sample(clamp(progress, 0, 1)), progress),
        derivative: typeof input.derivative === 'function'
          ? (progress) => finite(input.derivative(clamp(progress, 0, 1)), 0)
          : null
      };
    }
    if (Array.isArray(input) && input.length === 4) {
      return { sample: createCubicBezier(...input), derivative: null };
    }
  }

  const easing = String(input ?? DEFAULT_EASING).trim().toLowerCase();
  if (easing === 'linear') return { sample: (progress) => progress, derivative: () => 1 };
  const presets = {
    ease: [0.25, 0.1, 0.25, 1],
    'ease-in': [0.42, 0, 1, 1],
    'ease-out': [0, 0, 0.58, 1],
    'ease-in-out': [0.42, 0, 0.58, 1]
  };
  const preset = presets[easing];
  if (preset) return { sample: createCubicBezier(...preset), derivative: null };

  const match = easing.match(/^cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/);
  const points = match ? match.slice(1).map(Number) : [0.22, 1, 0.36, 1];
  return { sample: createCubicBezier(...points), derivative: null };
};

const easingVelocity = (easing, progress) => {
  if (easing.derivative) return clamp(easing.derivative(progress), -8, 12);
  const lower = Math.max(0, progress - 0.001);
  const upper = Math.min(1, progress + 0.001);
  if (upper === lower) return 0;
  return clamp((easing.sample(upper) - easing.sample(lower)) / (upper - lower), -8, 12);
};

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
  let particleActive = new Uint8Array(settings.count);
  let particleKinds = new Uint8Array(settings.count);
  let particleColors = new Uint8Array(settings.count);
  let particleOwners = new Uint32Array(settings.count);
  let emitters = [];
  let aliveCount = 0;
  let poolCursor = 0;
  let nextEmitterId = 1;
  let frameId = null;
  let frameToken = 0;
  let frameCallback = null;
  let lastTimestamp = null;
  let hasRendered = false;
  let currentDpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let destroyed = false;
  let renderedPhase = null;
  let renderedPortalSide = null;
  let renderedEmitterCount = -1;
  let renderedFrameCount = Math.max(0, finite(canvas.dataset?.frameCount, 0));

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

  const resolveMotion = (phase, duration, options = {}) => {
    const nested = options.trajectory && typeof options.trajectory === 'object'
      ? options.trajectory
      : (options.motion && typeof options.motion === 'object' ? options.motion : {});
    const sideCandidate = options.side ?? options.portalSide ?? nested.side;
    const side = PORTAL_SIDES.includes(sideCandidate)
      ? sideCandidate
      : (phase === 'scatter' ? 'bottom' : 'top');
    const distance = Math.abs(finite(
      options.distance,
      finite(options.motionDistance, finite(nested.distance, 0))
    ));
    const motionDuration = Math.max(1, finite(
      options.motionDuration,
      finite(nested.duration, finite(options.duration, duration))
    ));
    const easing = normalizeEasing(options.easing ?? options.motionEasing ?? nested.easing);
    const sourceOffset = finite(
      options.sourceOffset,
      finite(options.trailOffset, finite(nested.sourceOffset, 0))
    );
    const defaultDirectionY = phase === 'scatter'
      ? (side === 'bottom' ? 1 : -1)
      : (side === 'top' ? 1 : -1);
    const directionY = Math.sign(finite(
      options.directionY,
      finite(nested.directionY, defaultDirectionY)
    )) || defaultDirectionY;
    return { side, distance, duration: motionDuration, easing, sourceOffset, directionY };
  };

  const acquireSlot = () => {
    if (aliveCount >= settings.count || settings.count === 0) return -1;
    for (let checked = 0; checked < settings.count; checked += 1) {
      const index = (poolCursor + checked) % settings.count;
      if (particleActive[index] === 0) {
        poolCursor = (index + 1) % settings.count;
        particleActive[index] = 1;
        aliveCount += 1;
        return index;
      }
    }
    return -1;
  };

  const releaseSlot = (index) => {
    if (particleActive[index] === 0) return;
    particleActive[index] = 0;
    particleKinds[index] = 0;
    particleOwners[index] = 0;
    aliveCount = Math.max(0, aliveCount - 1);
  };

  const spawnParticle = (
    emitterId,
    kind,
    x,
    y,
    velocityX,
    velocityY,
    radius,
    age,
    life,
    opacity,
    drag,
    sway,
    swayRate,
    color
  ) => {
    const index = acquireSlot();
    if (index < 0) return false;
    const offset = index * PARTICLE_STRIDE;
    particleData[offset + POSITION_X] = clamp(finite(x, 0), 0, cssWidth);
    particleData[offset + POSITION_Y] = clamp(finite(y, 0), 0, cssHeight);
    particleData[offset + VELOCITY_X] = finite(velocityX, 0);
    particleData[offset + VELOCITY_Y] = finite(velocityY, 0);
    particleData[offset + RADIUS] = Math.max(0.1, finite(radius, 0.75));
    particleData[offset + AGE] = finite(age, 0);
    particleData[offset + LIFE] = Math.max(1, finite(life, 160));
    particleData[offset + OPACITY] = clamp(finite(opacity, 0.8), 0, 1);
    particleData[offset + DRAG] = Math.max(0, finite(drag, 3));
    particleData[offset + SWAY] = finite(sway, 0);
    particleData[offset + SWAY_RATE] = finite(swayRate, 0);
    particleData[offset + RENDER_ALPHA] = 0;
    particleKinds[index] = kind;
    particleColors[index] = color ?? (index % PARTICLE_COLORS.length);
    particleOwners[index] = emitterId;
    return true;
  };

  const countKind = (kind) => {
    let count = 0;
    for (let index = 0; index < particleActive.length; index += 1) {
      if (particleActive[index] && particleKinds[index] === kind) count += 1;
    }
    return count;
  };

  const emitterIsActive = (emitterId) => {
    for (let index = 0; index < emitters.length; index += 1) {
      if (emitters[index].id === emitterId) return true;
    }
    return false;
  };

  const countOwner = (emitterId) => {
    let count = 0;
    for (let index = 0; index < particleActive.length; index += 1) {
      if (particleActive[index] && particleOwners[index] === emitterId) count += 1;
    }
    return count;
  };

  const reserveCapacity = (requested, incomingEmitterId) => {
    let needed = Math.max(0, requested - (settings.count - aliveCount));
    if (needed === 0) return;

    for (let index = 0; index < particleActive.length && needed > 0; index += 1) {
      if (!particleActive[index] || particleOwners[index] === incomingEmitterId) continue;
      if (emitterIsActive(particleOwners[index])) continue;
      releaseSlot(index);
      needed -= 1;
    }

    const minimumPerEmitter = profileName === 'full' ? 36 : 24;
    let releasedInPass = 1;
    while (needed > 0 && releasedInPass > 0) {
      releasedInPass = 0;
      for (let index = 0; index < particleActive.length && needed > 0; index += 1) {
        if (!particleActive[index] || particleOwners[index] === incomingEmitterId) continue;
        const owner = particleOwners[index];
        if (!emitterIsActive(owner) || countOwner(owner) <= minimumPerEmitter) continue;
        releaseSlot(index);
        needed -= 1;
        releasedInPass += 1;
      }
    }
  };

  const seedPortalParticles = (emitter, count) => {
    const { bounds, motion, commandDuration } = emitter;
    const width = Math.max(1, bounds.right - bounds.left);
    const seamY = motion.side === 'bottom' ? bounds.bottom : bounds.top;
    const inwardDirection = motion.side === 'bottom' ? -1 : 1;
    const travel = motion.distance > 0
      ? clamp(motion.distance * 0.18, 56, 128)
      : clamp(cssHeight * 0.38, 52, 92);

    let spawned = 0;
    for (let particle = 0; particle < count; particle += 1) {
      const horizontalUnit = randomUnit();
      const horizontalBias = randomUnit() - 0.5;
      const life = commandDuration * (0.72 + (randomUnit() * 0.32));
      const delay = commandDuration * randomUnit() * 0.16;
      const lifeSeconds = Math.max(0.08, life / 1000);
      const taper = Math.sin(Math.PI * horizontalUnit) ** 0.42;
      const curlDirection = particle % 2 === 0 ? -1 : 1;
      const velocityScale = 1.15 + (randomUnit() * 0.38);
      const spawnedParticle = spawnParticle(
        emitter.id,
        PARTICLE_PORTAL,
        bounds.left + (width * horizontalUnit),
        seamY + ((randomUnit() - 0.5) * 2.6),
        (horizontalBias * (42 + (travel * 0.34))) + (curlDirection * 7),
        inwardDirection * (travel / lifeSeconds) * velocityScale,
        0.52 + (randomUnit() * 0.92),
        -delay,
        life,
        (0.62 + (randomUnit() * 0.38)) * (0.52 + (taper * 0.48)),
        2.1 + (randomUnit() * 1.8),
        curlDirection * (5 + (randomUnit() * 12)),
        2.2 + (randomUnit() * 2.2),
        particle % PARTICLE_COLORS.length
      );
      if (!spawnedParticle) break;
      spawned += 1;
    }
    return spawned;
  };

  const spawnTrailParticles = (emitter, count, fromProgress, toProgress) => {
    if (emitter.motion.distance <= 0 || count <= 0) return 0;
    const width = Math.max(1, emitter.bounds.right - emitter.bounds.left);
    const seamY = emitter.motion.side === 'bottom'
      ? emitter.bounds.bottom
      : emitter.bounds.top;
    const displacement = emitter.motion.directionY * emitter.motion.distance;
    const startY = emitter.phase === 'scatter' ? seamY - displacement : seamY;
    const durationSeconds = Math.max(0.001, emitter.motion.duration / 1000);
    let spawned = 0;
    for (let particle = 0; particle < count; particle += 1) {
      const fraction = (particle + 0.5) / count;
      const progress = fromProgress + ((toProgress - fromProgress) * fraction);
      const eased = emitter.motion.easing.sample(clamp(progress, 0, 1));
      const velocityY = (displacement / durationSeconds)
        * easingVelocity(emitter.motion.easing, progress);
      const inheritedSpeed = velocityY * (0.14 + (randomUnit() * 0.1));
      const lateralEnergy = 16 + Math.min(34, Math.abs(inheritedSpeed) * 0.08);
      const life = clamp(emitter.motion.duration * (0.28 + (randomUnit() * 0.22)), 130, 340);
      const birthDelay = Math.max(0, (progress - fromProgress) * emitter.motion.duration);
      const spawnedParticle = spawnParticle(
        emitter.id,
        PARTICLE_TRAIL,
        emitter.bounds.left + (width * (0.08 + (randomUnit() * 0.84))),
        startY + (displacement * eased) + emitter.motion.sourceOffset + ((randomUnit() - 0.5) * 4),
        (randomUnit() - 0.5) * lateralEnergy * 2,
        inheritedSpeed + ((randomUnit() - 0.5) * 18),
        0.38 + (randomUnit() * 0.78),
        -birthDelay,
        life,
        0.46 + (randomUnit() * 0.48),
        3.2 + (randomUnit() * 2.2),
        (randomUnit() - 0.5) * 13,
        2.6 + (randomUnit() * 2.8),
        particle % PARTICLE_COLORS.length
      );
      if (!spawnedParticle) break;
      spawned += 1;
    }
    return spawned;
  };

  const seedHoldParticles = (emitter) => {
    const available = Math.max(0, settings.holdCount - countKind(PARTICLE_HOLD));
    const count = Math.min(available, settings.count - aliveCount);
    const width = Math.max(1, emitter.bounds.right - emitter.bounds.left);
    const floorY = clamp(emitter.bounds.bottom + 4, 0, Math.max(0, cssHeight - 4));
    const availableDepth = Math.max(10, cssHeight - floorY - 4);
    const fieldDepth = Math.min(58, Math.max(24, availableDepth));
    let spawned = 0;

    for (let particle = 0; particle < count; particle += 1) {
      const life = emitter.commandDuration * (0.78 + (randomUnit() * 0.18));
      const delay = emitter.commandDuration * randomUnit() * 0.06;
      const spawnedParticle = spawnParticle(
        emitter.id,
        PARTICLE_HOLD,
        emitter.bounds.left + (width * (0.1 + (randomUnit() * 0.8))),
        floorY + (fieldDepth * randomUnit()),
        (randomUnit() - 0.5) * 16,
        -(5 + (randomUnit() * 15)),
        0.36 + (randomUnit() * 0.7),
        -delay,
        life,
        0.38 + (randomUnit() * 0.42),
        1.2 + (randomUnit() * 1.5),
        (randomUnit() - 0.5) * 10,
        1.4 + (randomUnit() * 1.8),
        particle % PARTICLE_COLORS.length
      );
      if (!spawnedParticle) break;
      spawned += 1;
    }
    return spawned;
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

  const updateEmitters = (deltaMs) => {
    for (let index = emitters.length - 1; index >= 0; index -= 1) {
      const emitter = emitters[index];
      const previousProgress = clamp(emitter.elapsed / emitter.motion.duration, 0, 1);
      emitter.elapsed = Math.min(emitter.simulationDuration, emitter.elapsed + deltaMs);
      const progress = clamp(emitter.elapsed / emitter.motion.duration, 0, 1);

      if (emitter.phase !== 'hold' && emitter.motion.distance > 0) {
        const desired = Math.floor(emitter.trailBudget * progress);
        const requested = Math.max(0, desired - emitter.trailEmitted);
        const spawned = spawnTrailParticles(emitter, requested, previousProgress, progress);
        emitter.trailEmitted += spawned;
      }

      if (!emitter.promiseResolved && emitter.elapsed >= emitter.commandDuration) {
        emitter.promiseResolved = true;
        emitter.resolve();
      }
      if (emitter.elapsed < emitter.simulationDuration) continue;
      if (!emitter.promiseResolved) {
        emitter.promiseResolved = true;
        emitter.resolve();
      }
      emitters.splice(index, 1);
    }
  };

  const updateParticles = (deltaMs) => {
    let remainingMs = Math.max(0, deltaMs);
    while (remainingMs > 0) {
      const stepMs = Math.min(32, remainingMs);
      for (let index = 0; index < particleActive.length; index += 1) {
        if (particleActive[index] === 0) continue;
        const offset = index * PARTICLE_STRIDE;
        const previousAge = particleData[offset + AGE];
        const life = particleData[offset + LIFE];
        const age = previousAge + stepMs;
        particleData[offset + AGE] = age;
        const activeMs = Math.max(0, Math.min(life, age) - Math.max(0, previousAge));
        if (activeMs > 0) {
          const activeSeconds = activeMs / 1000;
          const drag = Math.exp(-particleData[offset + DRAG] * activeSeconds);
          particleData[offset + VELOCITY_X] *= drag;
          particleData[offset + VELOCITY_Y] *= Math.sqrt(drag);
          const lifeProgress = clamp(age / life, 0, 1);
          const swayVelocity = Math.sin(
            (lifeProgress * Math.PI * 2 * particleData[offset + SWAY_RATE]) + (index * 0.73)
          ) * particleData[offset + SWAY];
          particleData[offset + POSITION_X] = clamp(
            particleData[offset + POSITION_X]
              + ((particleData[offset + VELOCITY_X] + swayVelocity) * activeSeconds),
            0,
            cssWidth
          );
          particleData[offset + POSITION_Y] = clamp(
            particleData[offset + POSITION_Y]
              + (particleData[offset + VELOCITY_Y] * activeSeconds),
            0,
            cssHeight
          );
        }

        if (age <= 0 || age >= life) {
          particleData[offset + RENDER_ALPHA] = 0;
          continue;
        }
        const lifeProgress = age / life;
        const fadeIn = smoothStep(clamp(age / Math.min(42, life * 0.16), 0, 1));
        const fadeOut = smoothStep(clamp((life - age) / Math.max(1, life * 0.42), 0, 1));
        const kindEnergy = particleKinds[index] === PARTICLE_PORTAL
          ? 1
          : (particleKinds[index] === PARTICLE_TRAIL ? 0.86 : 0.66);
        const pulse = 0.84 + (0.16 * Math.sin((lifeProgress * Math.PI * 2) + (index * 0.31)));
        particleData[offset + RENDER_ALPHA] = particleData[offset + OPACITY]
          * fadeIn
          * fadeOut
          * kindEnergy
          * pulse;
      }
      remainingMs -= stepMs;
    }
  };

  const render = () => {
    erase();
    if (aliveCount === 0) {
      hasRendered = false;
      return;
    }

    const previousCompositeOperation = context.globalCompositeOperation;
    context.globalCompositeOperation = 'lighter';
    try {
      for (let index = 0; index < particleActive.length; index += 1) {
        if (particleActive[index] === 0) continue;
        const offset = index * PARTICLE_STRIDE;
        if (particleData[offset + AGE] >= particleData[offset + LIFE]) {
          releaseSlot(index);
          continue;
        }
        drawParticle(
          index,
          particleData[offset + POSITION_X],
          particleData[offset + POSITION_Y],
          particleData[offset + RENDER_ALPHA]
        );
      }
      hasRendered = aliveCount > 0;
    } finally {
      context.globalAlpha = 1;
      context.globalCompositeOperation = previousCompositeOperation || 'source-over';
    }
  };

  const redrawRendered = () => {
    erase();
    if (!hasRendered || aliveCount === 0) return;
    const previousCompositeOperation = context.globalCompositeOperation;
    context.globalCompositeOperation = 'lighter';
    try {
      for (let index = 0; index < particleActive.length; index += 1) {
        if (particleActive[index] === 0) continue;
        const offset = index * PARTICLE_STRIDE;
        drawParticle(
          index,
          particleData[offset + POSITION_X],
          particleData[offset + POSITION_Y],
          particleData[offset + RENDER_ALPHA]
        );
      }
    } finally {
      context.globalAlpha = 1;
      context.globalCompositeOperation = previousCompositeOperation || 'source-over';
    }
  };

  const isHidden = () => Boolean(documentRef?.hidden);

  const syncCanvasState = () => {
    let phase = emitters.length === 0 ? (aliveCount > 0 ? 'tail' : 'idle') : emitters[0].phase;
    let side = null;
    for (let index = 0; index < emitters.length; index += 1) {
      const emitter = emitters[index];
      if (emitter.phase !== phase) phase = 'mixed';
      if (emitter.phase === 'hold') continue;
      if (side === null) side = emitter.motion.side;
      else if (side !== emitter.motion.side) side = 'mixed';
    }

    if (renderedEmitterCount !== emitters.length) {
      renderedEmitterCount = emitters.length;
      setCanvasData('emitterCount', renderedEmitterCount);
    }
    if (renderedPhase !== phase) {
      renderedPhase = phase;
      setCanvasData('phase', phase);
    }
    if (renderedPortalSide === side) return;
    renderedPortalSide = side;
    if (side === null) clearCanvasData('portalSide');
    else setCanvasData('portalSide', side);
  };

  const cancelPendingFrame = () => {
    frameToken += 1;
    if (frameId !== null) unscheduleFrame(frameId);
    frameId = null;
    lastTimestamp = null;
    const token = frameToken;
    frameCallback = (timestamp) => onFrame(timestamp, token);
  };

  const clearPool = () => {
    particleData.fill(0);
    particleActive.fill(0);
    particleKinds.fill(0);
    particleColors.fill(0);
    particleOwners.fill(0);
    aliveCount = 0;
    poolCursor = 0;
    hasRendered = false;
  };

  const settleAll = () => {
    cancelPendingFrame();
    const settling = emitters;
    emitters = [];
    clearPool();
    erase();
    syncCanvasState();
    setCanvasData('frameCount', renderedFrameCount);
    for (const emitter of settling) emitter.resolve();
  };

  const schedule = () => {
    if (destroyed || isHidden() || frameId !== null || (emitters.length === 0 && aliveCount === 0)) return;
    frameId = scheduleFrame(frameCallback);
  };

  function onFrame(timestamp, token) {
    if (token !== frameToken || destroyed) return;
    frameId = null;
    if (isHidden()) {
      settleAll();
      return;
    }

    const now = finite(timestamp, lastTimestamp ?? 0);
    const deltaMs = lastTimestamp === null ? 0 : Math.max(0, now - lastTimestamp);
    lastTimestamp = now;
    try {
      updateEmitters(deltaMs);
      updateParticles(deltaMs);
      render();
    } catch {
      settleAll();
      return;
    }

    renderedFrameCount += 1;
    syncCanvasState();
    if (emitters.length > 0 || aliveCount > 0) schedule();
    else {
      lastTimestamp = null;
      setCanvasData('frameCount', renderedFrameCount);
    }
  }

  const resize = () => {
    if (destroyed) return;
    const bounds = canvas.getBoundingClientRect();
    const previousWidth = cssWidth;
    const previousHeight = cssHeight;
    const nextWidth = Math.max(0, finite(bounds.width, 0));
    const nextHeight = Math.max(0, finite(bounds.height, 0));
    const deviceDpr = Math.max(0.01, finite(windowRef?.devicePixelRatio, 1));
    const nextDpr = Math.min(1, deviceDpr, settings.dpr);
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
      for (let index = 0; index < particleActive.length; index += 1) {
        if (particleActive[index] === 0) continue;
        const offset = index * PARTICLE_STRIDE;
        particleData[offset + POSITION_X] = clamp(particleData[offset + POSITION_X] * scaleX, 0, cssWidth);
        particleData[offset + POSITION_Y] = clamp(particleData[offset + POSITION_Y] * scaleY, 0, cssHeight);
        particleData[offset + VELOCITY_X] *= scaleX;
        particleData[offset + VELOCITY_Y] *= scaleY;
        particleData[offset + SWAY] *= scaleX;
      }
      for (const emitter of emitters) {
        emitter.bounds.left *= scaleX;
        emitter.bounds.right *= scaleX;
        emitter.bounds.top *= scaleY;
        emitter.bounds.bottom *= scaleY;
        emitter.motion.distance *= scaleY;
        emitter.motion.sourceOffset *= scaleY;
      }
    }

    if ((sizeChanged || backingChanged) && hasRendered) redrawRendered();
  };

  const start = (phase, bounds, durationMs, options = {}) => {
    if (destroyed) return Promise.resolve();
    if (profileName !== 'reduce') resize();

    const defaultDuration = phase === 'gather'
      ? settings.gatherMs
      : (phase === 'hold' ? settings.holdMs : settings.scatterMs);
    const commandDuration = Math.max(0, finite(durationMs, defaultDuration));
    if (settings.count === 0 || commandDuration === 0 || isHidden()) {
      syncCanvasState();
      return Promise.resolve();
    }

    const normalizedBounds = normalizeBounds(bounds);
    const motion = resolveMotion(phase, commandDuration, options);
    let resolvePromise;
    const promise = new Promise((resolve) => { resolvePromise = resolve; });
    const emitter = {
      id: nextEmitterId,
      phase,
      bounds: normalizedBounds,
      commandDuration,
      simulationDuration: phase === 'hold'
        ? commandDuration
        : Math.max(commandDuration, motion.duration),
      elapsed: 0,
      motion,
      trailBudget: motion.distance > 0 ? settings.holdCount : 0,
      trailEmitted: 0,
      promiseResolved: false,
      resolve: resolvePromise
    };
    nextEmitterId += 1;
    emitters.push(emitter);

    if (phase === 'hold') {
      reserveCapacity(settings.holdCount, emitter.id);
      seedHoldParticles(emitter);
    } else {
      const reservedTrail = motion.distance > 0 ? settings.holdCount : 0;
      const portalCount = Math.max(0, settings.count - reservedTrail);
      const initialTrail = motion.distance > 0
        ? Math.min(reservedTrail, profileName === 'full' ? 16 : 10)
        : 0;
      reserveCapacity(portalCount + initialTrail, emitter.id);
      if (motion.distance > 0) {
        emitter.trailEmitted += spawnTrailParticles(emitter, initialTrail, 0, 0);
      }
      seedPortalParticles(emitter, portalCount);
    }

    syncCanvasState();
    schedule();
    return promise;
  };

  const setProfile = (nextProfile) => {
    if (!Object.hasOwn(PARTICLE_PROFILES, nextProfile)) {
      throw new RangeError(`Unknown particle profile: ${nextProfile}`);
    }
    if (destroyed || nextProfile === profileName) return;
    settleAll();
    profileName = nextProfile;
    settings = PARTICLE_PROFILES[profileName];
    particleData = new Float32Array(settings.count * PARTICLE_STRIDE);
    particleActive = new Uint8Array(settings.count);
    particleKinds = new Uint8Array(settings.count);
    particleColors = new Uint8Array(settings.count);
    particleOwners = new Uint32Array(settings.count);
    resize();
  };

  const clear = () => {
    if (!destroyed) settleAll();
  };

  const finish = () => {
    if (!destroyed) settleAll();
  };

  const onVisibilityChange = () => {
    if (!destroyed && isHidden()) settleAll();
  };

  const destroy = () => {
    if (destroyed) return;
    settleAll();
    destroyed = true;
    documentRef?.removeEventListener?.('visibilitychange', onVisibilityChange);
    for (const sprite of particleSprites) {
      if (!sprite) continue;
      sprite.width = 0;
      sprite.height = 0;
    }
    particleSprites = [];
    particleData = new Float32Array(0);
    particleActive = new Uint8Array(0);
    particleKinds = new Uint8Array(0);
    particleColors = new Uint8Array(0);
    particleOwners = new Uint32Array(0);
    canvas.width = 0;
    canvas.height = 0;
  };

  const getState = () => ({
    profile: profileName,
    particleCount: aliveCount,
    dpr: currentDpr,
    animating: emitters.length > 0 || aliveCount > 0,
    destroyed
  });

  setCanvasData('phase', 'idle');
  setCanvasData('emitterCount', 0);
  if (!Number.isFinite(Number(getCanvasData('frameCount')))) setCanvasData('frameCount', 0);
  cancelPendingFrame();
  documentRef?.addEventListener?.('visibilitychange', onVisibilityChange);
  resize();

  return {
    gather: (bounds, durationMs, options) => start('gather', bounds, durationMs, options),
    scatter: (bounds, durationMs, options) => start('scatter', bounds, durationMs, options),
    hold: (bounds, durationMs, options) => start('hold', bounds, durationMs, options),
    resize,
    setProfile,
    clear,
    finish,
    destroy,
    getState
  };
};
