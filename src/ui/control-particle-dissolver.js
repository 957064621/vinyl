const PROFILE_SETTINGS = Object.freeze({
  full: Object.freeze({ particles: 26, duration: 480 }),
  compact: Object.freeze({ particles: 18, duration: 520 }),
  reduce: Object.freeze({ particles: 0, duration: 0 })
});

const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

const parseRgb = (value, fallback) => {
  const match = String(value || '').match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
  if (!match) return fallback;
  return [
    clamp(Number(match[1]), 0, 255),
    clamp(Number(match[2]), 0, 255),
    clamp(Number(match[3]), 0, 255)
  ];
};

const rgba = (color, alpha) => `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;

const createSprite = (documentRef, color) => {
  const sprite = documentRef.createElement('canvas');
  sprite.width = 28;
  sprite.height = 28;
  const context = sprite.getContext?.('2d');
  if (!context) return null;
  const gradient = context.createRadialGradient(14, 14, 0, 14, 14, 14);
  gradient.addColorStop(0, rgba(color, 1));
  gradient.addColorStop(0.08, rgba(color, 0.94));
  gradient.addColorStop(0.3, rgba(color, 0.28));
  gradient.addColorStop(1, rgba(color, 0));
  context.fillStyle = gradient;
  context.fillRect(0, 0, 28, 28);
  return sprite;
};

const copyGhostSurface = (ghost, style) => {
  const properties = [
    'alignItems',
    'backdropFilter',
    'background',
    'backgroundColor',
    'backgroundImage',
    'backgroundPosition',
    'backgroundSize',
    'border',
    'borderColor',
    'borderRadius',
    'borderStyle',
    'borderWidth',
    'boxShadow',
    'color',
    'display',
    'fontFamily',
    'fontSize',
    'fontStyle',
    'fontWeight',
    'gap',
    'justifyContent',
    'letterSpacing',
    'lineHeight',
    'opacity',
    'padding',
    'textAlign',
    'textShadow',
    'textTransform',
    'whiteSpace'
  ];
  properties.forEach((property) => {
    const value = style[property];
    if (value) ghost.style[property] = value;
  });
  if (style.webkitBackdropFilter) {
    ghost.style.webkitBackdropFilter = style.webkitBackdropFilter;
  }
};

const removeDuplicateIds = (root) => {
  root.removeAttribute('id');
  root.querySelectorAll?.('[id]').forEach((node) => node.removeAttribute('id'));
};

const isPointerClick = (event) => Number(event.detail) > 0;

export function createControlParticleDissolver({
  documentRef = document,
  windowRef = documentRef.defaultView ?? window,
  profile = 'compact',
  random = Math.random,
  now = () => windowRef.performance?.now?.() ?? Date.now(),
  requestFrame = windowRef.requestAnimationFrame?.bind(windowRef)
    ?? ((callback) => windowRef.setTimeout(() => callback(now()), 16)),
  cancelFrame = windowRef.cancelAnimationFrame?.bind(windowRef)
    ?? windowRef.clearTimeout?.bind(windowRef),
  setTimer = windowRef.setTimeout?.bind(windowRef) ?? setTimeout,
  clearTimer = windowRef.clearTimeout?.bind(windowRef) ?? clearTimeout
} = {}) {
  if (!PROFILE_SETTINGS[profile]) {
    throw new RangeError(`Unknown control particle profile: ${String(profile)}`);
  }

  const layer = documentRef.createElement('div');
  layer.className = 'control-particle-layer';
  layer.setAttribute('aria-hidden', 'true');
  layer.hidden = true;

  const canvas = documentRef.createElement('canvas');
  canvas.className = 'control-particle-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  layer.append(canvas);
  documentRef.body?.append(layer);

  let context = null;
  try {
    context = canvas.getContext?.('2d', { alpha: true }) ?? null;
  } catch {
    context = null;
  }

  let currentProfile = profile;
  let destroyed = false;
  let frameId = null;
  let cssWidth = 1;
  let cssHeight = 1;
  let dpr = 1;
  let lastDrawTime = 0;
  let particles = [];
  const records = new Set();
  const activeByElement = new WeakMap();
  const spriteCache = new Map();

  const resizeCanvas = () => {
    const nextWidth = Math.max(1, Math.round(windowRef.innerWidth || documentRef.documentElement?.clientWidth || 1));
    const nextHeight = Math.max(1, Math.round(windowRef.innerHeight || documentRef.documentElement?.clientHeight || 1));
    const nextDpr = Math.min(2, Math.max(1, Number(windowRef.devicePixelRatio) || 1));
    const nextBitmapWidth = Math.round(nextWidth * nextDpr);
    const nextBitmapHeight = Math.round(nextHeight * nextDpr);
    const changed = nextWidth !== cssWidth
      || nextHeight !== cssHeight
      || nextDpr !== dpr
      || canvas.width !== nextBitmapWidth
      || canvas.height !== nextBitmapHeight;

    cssWidth = nextWidth;
    cssHeight = nextHeight;
    dpr = nextDpr;
    if (!changed) return false;

    if (canvas.width !== nextBitmapWidth) canvas.width = nextBitmapWidth;
    if (canvas.height !== nextBitmapHeight) canvas.height = nextBitmapHeight;
    if (canvas.style.width !== `${nextWidth}px`) canvas.style.width = `${nextWidth}px`;
    if (canvas.style.height !== `${nextHeight}px`) canvas.style.height = `${nextHeight}px`;
    context?.setTransform?.(dpr, 0, 0, dpr, 0, 0);
    return true;
  };

  const clearCanvas = () => {
    if (!context) return;
    context.setTransform?.(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform?.(dpr, 0, 0, dpr, 0, 0);
  };

  const getSprite = (color) => {
    const key = color.map((channel) => Math.round(channel)).join(',');
    if (!spriteCache.has(key)) spriteCache.set(key, createSprite(documentRef, color));
    return spriteCache.get(key);
  };

  const settleLayerVisibility = () => {
    if (records.size === 0 && particles.length === 0) layer.hidden = true;
  };

  const finishRecord = (record) => {
    if (!record || record.finished) return;
    record.finished = true;
    if (record.timer !== null) clearTimer(record.timer);
    record.animation?.cancel?.();
    record.ghost.remove();
    if (activeByElement.get(record.element) === record) {
      activeByElement.delete(record.element);
      record.element.style.visibility = record.previousVisibility;
      record.element.removeAttribute('data-particle-exiting');
    }
    records.delete(record);
    settleLayerVisibility();
  };

  const clear = () => {
    if (frameId !== null) cancelFrame?.(frameId);
    frameId = null;
    particles = [];
    clearCanvas();
    [...records].forEach(finishRecord);
    layer.hidden = true;
  };

  const drawFrame = (time) => {
    frameId = null;
    clearCanvas();
    if (!context || destroyed) {
      particles = [];
      settleLayerVisibility();
      return;
    }

    const numericTime = Number.isFinite(time) ? time : now();
    const drawTime = Math.max(lastDrawTime, numericTime);
    lastDrawTime = drawTime;
    context.globalCompositeOperation = 'lighter';
    const live = [];
    particles.forEach((particle) => {
      const elapsed = drawTime - particle.start - particle.delay;
      if (elapsed < 0) {
        live.push(particle);
        return;
      }
      const progress = elapsed / particle.life;
      if (progress >= 1) return;

      const seconds = Math.min(0.034, Math.max(0, drawTime - particle.lastTime)) / 1000;
      particle.lastTime = drawTime;
      const drag = Math.exp(-particle.drag * seconds);
      particle.vx *= drag;
      particle.vy = (particle.vy * drag) - (particle.lift * seconds);
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.phase += seconds * particle.swayRate;
      particle.x += Math.sin(particle.phase) * particle.sway * seconds;

      const entrance = clamp(progress / 0.14, 0, 1);
      const exit = Math.pow(1 - progress, 1.45);
      const alpha = particle.opacity * entrance * exit;
      const radius = particle.radius * (0.72 + ((1 - progress) * 0.42));
      const sprite = particle.sprite;
      context.globalAlpha = alpha;
      if (sprite) {
        context.drawImage(sprite, particle.x - radius * 2.2, particle.y - radius * 2.2, radius * 4.4, radius * 4.4);
      } else {
        context.fillStyle = rgba(particle.color, alpha);
        context.beginPath();
        context.arc(particle.x, particle.y, radius, 0, Math.PI * 2);
        context.fill();
      }
      live.push(particle);
    });
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    particles = live;

    if (particles.length > 0) frameId = requestFrame(drawFrame);
    else settleLayerVisibility();
  };

  const ensureFrame = () => {
    if (frameId === null && particles.length > 0) frameId = requestFrame(drawFrame);
  };

  const createParticles = (rect, style, point, settings) => {
    if (!context || settings.particles <= 0) return;
    // WebKit can leave a queued RAF pending while fixed overlays exchange.
    // Retarget that one frame so every new burst starts drawing immediately.
    if (frameId !== null) {
      cancelFrame?.(frameId);
      frameId = null;
    }
    const foreground = parseRgb(style.color, [241, 245, 248]);
    const edge = parseRgb(style.borderColor, [151, 211, 255]);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const originX = Number.isFinite(point?.x) ? point.x : centerX;
    const originY = Number.isFinite(point?.y) ? point.y : centerY;
    const inwardX = centerX < cssWidth * 0.24
      ? 44
      : (centerX > cssWidth * 0.76 ? -44 : 0);
    const inwardY = centerY < cssHeight * 0.22
      ? 50
      : (centerY > cssHeight * 0.78 ? -42 : -28);
    const verticalLift = centerY < cssHeight * 0.22
      ? -(12 + random() * 10)
      : (18 + random() * 16);
    const count = clamp(
      Math.round(settings.particles * clamp(Math.sqrt((rect.width * rect.height) / 5200), 0.96, 1.15)),
      16,
      30
    );
    const startedAt = Math.max(lastDrawTime, now());
    const visualLead = 32;

    for (let index = 0; index < count; index += 1) {
      const column = (index + random() * 0.8) / count;
      const x = rect.left + (rect.width * clamp(column, 0.04, 0.96));
      const y = rect.top + (rect.height * (0.12 + random() * 0.76));
      const directionX = (x - originX) / Math.max(18, rect.width);
      const directionY = (y - originY) / Math.max(18, rect.height);
      const color = index % 4 === 0 ? edge : foreground;
      particles.push({
        x,
        y,
        vx: inwardX + (directionX * (34 + random() * 48)) + ((random() - 0.5) * 30),
        vy: inwardY + (directionY * (24 + random() * 34)) + ((random() - 0.5) * 22),
        lift: verticalLift,
        drag: 2.3 + random() * 1.7,
        sway: 4 + random() * 6,
        swayRate: 2.2 + random() * 3.1,
        phase: random() * Math.PI * 2,
        radius: 0.72 + random() * 0.92,
        opacity: 0.56 + random() * 0.38,
        delay: random() * 54,
        life: settings.duration * (0.72 + random() * 0.34),
        start: startedAt - visualLead,
        lastTime: startedAt - visualLead,
        color,
        sprite: getSprite(color)
      });
    }
    // Paint one small lead frame synchronously. WebKit may defer the first RAF
    // while a fixed overlay begins compositing, which otherwise leaves a
    // visible ghost with no particles during the handoff.
    drawFrame(startedAt);
  };

  const createGhost = (element, rect, style) => {
    const ghost = element.cloneNode(true);
    removeDuplicateIds(ghost);
    ghost.classList.add('control-particle-ghost');
    ghost.removeAttribute('data-particle-exit');
    ghost.removeAttribute('data-particle-exiting');
    ghost.removeAttribute('disabled');
    ghost.removeAttribute('hidden');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.setAttribute('tabindex', '-1');
    copyGhostSurface(ghost, style);
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      minWidth: '0',
      minHeight: '0',
      margin: '0',
      transform: 'translate3d(0, 0, 0) scale(1)',
      transformOrigin: '50% 50%',
      visibility: 'visible',
      pointerEvents: 'none'
    });
    layer.append(ghost);
    return ghost;
  };

  const dissolve = (element, { clientX, clientY } = {}) => {
    const settings = PROFILE_SETTINGS[currentProfile];
    if (
      destroyed
      || settings.particles === 0
      || !element?.isConnected
      || activeByElement.has(element)
    ) return false;

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = windowRef.getComputedStyle(element);
    const pointInside = Number.isFinite(clientX)
      && Number.isFinite(clientY)
      && clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
    const point = pointInside
      ? { x: clientX, y: clientY }
      : { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };

    resizeCanvas();
    layer.hidden = false;
    const ghost = createGhost(element, rect, style);
    const record = {
      element,
      ghost,
      animation: null,
      timer: null,
      finished: false,
      previousVisibility: element.style.visibility
    };
    records.add(record);
    activeByElement.set(element, record);
    element.setAttribute('data-particle-exiting', '');
    element.style.visibility = 'hidden';

    createParticles(rect, style, point, settings);
    record.animation = ghost.animate?.([
      {
        opacity: Number.parseFloat(style.opacity) || 1,
        filter: 'blur(0px)',
        transform: 'translate3d(0, 0, 0) scale(1)'
      },
      {
        offset: 0.28,
        opacity: 0.7,
        filter: 'blur(0.6px)',
        transform: 'translate3d(0, -0.5px, 0) scale(0.992)'
      },
      {
        offset: 0.72,
        opacity: 0.18,
        filter: 'blur(2.2px)',
        transform: 'translate3d(0, -3px, 0) scale(0.974)'
      },
      {
        opacity: 0,
        filter: 'blur(4px)',
        transform: 'translate3d(0, -6px, 0) scale(0.95)'
      }
    ], {
      duration: settings.duration,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'forwards'
    });
    record.animation?.finished?.catch?.(() => {});
    record.timer = setTimer(() => finishRecord(record), settings.duration + 24);
    return true;
  };

  const handleClick = (event) => {
    if (!isPointerClick(event) || currentProfile === 'reduce') return;
    const target = event.target instanceof windowRef.Element
      ? event.target.closest('[data-particle-exit]')
      : null;
    if (!target || target.disabled || target.hidden) return;
    dissolve(target, { clientX: event.clientX, clientY: event.clientY });
  };

  const handleViewportChange = () => {
    const nextWidth = Math.max(1, Math.round(windowRef.innerWidth || documentRef.documentElement?.clientWidth || 1));
    const nextHeight = Math.max(1, Math.round(windowRef.innerHeight || documentRef.documentElement?.clientHeight || 1));
    const widthDelta = Math.abs(nextWidth - cssWidth);
    const heightDelta = Math.abs(nextHeight - cssHeight);
    const largeViewportChange = widthDelta > Math.max(32, cssWidth * 0.18)
      || heightDelta > Math.max(160, cssHeight * 0.28);
    if (largeViewportChange) {
      clear();
      resizeCanvas();
      return;
    }
    // iOS can resize only the visual viewport while its browser chrome moves.
    // Preserve the short-lived effect and redraw it at the new canvas size.
    const resized = resizeCanvas();
    if (resized && particles.length > 0) {
      if (frameId !== null) cancelFrame?.(frameId);
      frameId = null;
      drawFrame(Math.max(lastDrawTime, now()));
      return;
    }
    ensureFrame();
  };
  const handleVisibilityChange = () => {
    if (documentRef.hidden) clear();
  };

  documentRef.addEventListener('click', handleClick, true);
  windowRef.addEventListener?.('resize', handleViewportChange, { passive: true });
  windowRef.visualViewport?.addEventListener?.('resize', handleViewportChange, { passive: true });
  documentRef.addEventListener('visibilitychange', handleVisibilityChange);
  resizeCanvas();

  return {
    dissolve,
    clear,
    setProfile(nextProfile) {
      if (!PROFILE_SETTINGS[nextProfile]) {
        throw new RangeError(`Unknown control particle profile: ${String(nextProfile)}`);
      }
      if (destroyed || nextProfile === currentProfile) return;
      currentProfile = nextProfile;
      if (nextProfile === 'reduce') clear();
    },
    getState() {
      return {
        profile: currentProfile,
        particleCount: particles.length,
        activeGhosts: records.size,
        animating: frameId !== null,
        destroyed,
        canvasConnected: canvas.isConnected
      };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      documentRef.removeEventListener('click', handleClick, true);
      windowRef.removeEventListener?.('resize', handleViewportChange);
      windowRef.visualViewport?.removeEventListener?.('resize', handleViewportChange);
      documentRef.removeEventListener('visibilitychange', handleVisibilityChange);
      clear();
      layer.remove();
      spriteCache.clear();
    }
  };
}
