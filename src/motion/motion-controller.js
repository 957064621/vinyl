export const MOTION_TOKENS = Object.freeze({
  full: Object.freeze({ enter: 520, move: 900, settle: 720, itemStagger: 16 }),
  compact: Object.freeze({ enter: 280, move: 460, settle: 360, itemStagger: 0 }),
  reduce: Object.freeze({ enter: 0, move: 0, settle: 0, itemStagger: 0 })
});

const tokensForProfile = (profile) => {
  if (!Object.prototype.hasOwnProperty.call(MOTION_TOKENS, profile)) {
    throw new TypeError(`Unknown motion profile: ${String(profile)}`);
  }
  return MOTION_TOKENS[profile];
};

export function detectMotionProfile({
  matchMedia = globalThis.matchMedia,
  userAgent = globalThis.navigator?.userAgent || '',
  viewportHeight = globalThis.innerHeight
} = {}) {
  const matches = (query) => typeof matchMedia === 'function' && matchMedia(query).matches;
  if (matches('(prefers-reduced-motion: reduce)')) return 'reduce';
  if (matches('(hover: none) and (pointer: coarse)')) return 'compact';
  if (/Android|iPhone|iPad|iPod|MicroMessenger|Mobile/i.test(userAgent)) return 'compact';
  if (Number.isFinite(viewportHeight) && viewportHeight <= 720) return 'compact';
  return 'full';
}

export function createMotionController({
  profile,
  transitions,
  onActivityChange = () => {}
}) {
  let currentProfile = profile;
  let currentTokens = tokensForProfile(profile);

  let active = null;
  let latestRequestId = 0;
  let decorativeVisibilityEpoch = 0;
  let disposed = false;
  let documentVisible = true;

  const publishActivity = (record, isActive) => {
    try {
      onActivityChange({
        active: isActive,
        name: isActive ? record?.name || null : null
      });
    } catch {
      // Activity observers must not disrupt the command that owns cleanup.
    }
  };

  const runExclusive = (name, task, { allowWhenHidden = false } = {}) => {
    if (disposed || (!documentVisible && !allowWhenHidden)) {
      return Promise.resolve({ status: 'cancelled', name });
    }

    const requestId = ++latestRequestId;
    const visibilityEpoch = decorativeVisibilityEpoch;
    const commandProfile = currentProfile;
    const commandTokens = currentTokens;
    const previous = active;
    previous?.controller.abort(`superseded by ${name}`);

    return (async () => {
      if (previous) await previous.settled;
      if (
        disposed ||
        requestId !== latestRequestId ||
        (!allowWhenHidden && (
          !documentVisible ||
          visibilityEpoch !== decorativeVisibilityEpoch
        ))
      ) {
        return { status: 'cancelled', name };
      }

      const controller = new AbortController();
      const record = { name, controller, allowWhenHidden, settled: null };
      record.settled = Promise.resolve().then(async () => {
        try {
          if (controller.signal.aborted) return { status: 'cancelled', name };
          await task({
            signal: controller.signal,
            profile: commandProfile,
            tokens: commandTokens
          });
          return {
            status: controller.signal.aborted ? 'cancelled' : 'completed',
            name
          };
        } catch (error) {
          if (controller.signal.aborted) return { status: 'cancelled', name };
          controller.abort(error);
          throw error;
        } finally {
          if (active === record) {
            active = null;
            publishActivity(record, false);
          }
        }
      });

      active = record;
      publishActivity(record, true);

      return record.settled;
    })();
  };

  return {
    get profile() {
      return currentProfile;
    },
    draw: (targetIndex) => runExclusive(
      'draw',
      (context) => transitions.draw({ ...context, targetIndex })
    ),
    switchTrack: (targetIndex, { headless = false, showLyrics = false } = {}) => runExclusive(
      'switch-track',
      (context) => transitions.switchTrack({
        ...context,
        targetIndex,
        headless,
        showLyrics: !headless && showLyrics
      }),
      { allowWhenHidden: headless }
    ),
    openOverlay: (kind) => runExclusive(
      `open:${kind}`,
      (context) => transitions.openOverlay({ ...context, kind })
    ),
    closeOverlay: (kind) => runExclusive(
      `close:${kind}`,
      (context) => transitions.closeOverlay({ ...context, kind })
    ),
    isActive: () => active !== null,
    setProfile(nextProfile) {
      const nextTokens = tokensForProfile(nextProfile);
      if (disposed || nextProfile === currentProfile) return Promise.resolve();

      currentProfile = nextProfile;
      currentTokens = nextTokens;
      latestRequestId += 1;
      const pending = active?.settled;
      active?.controller.abort('motion profile changed');
      return pending || Promise.resolve();
    },
    setDocumentVisible(visible) {
      documentVisible = Boolean(visible);
      if (!documentVisible) {
        decorativeVisibilityEpoch += 1;
        if (!active?.allowWhenHidden) active?.controller.abort('document hidden');
      }
      transitions.setDocumentVisible?.(visible);
    },
    async cancel(reason = 'cancelled') {
      latestRequestId += 1;
      const pending = active?.settled;
      active?.controller.abort(reason);
      if (pending) await pending;
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      latestRequestId += 1;
      const pending = active?.settled;
      active?.controller.abort('disposed');
      if (pending) await pending;
      transitions.dispose?.();
      active = null;
    }
  };
}

const applyFinalKeyframe = (element, keyframes) => {
  if (!Array.isArray(keyframes) || keyframes.length === 0) return;
  const finalFrame = keyframes.at(-1);
  if (!finalFrame || typeof finalFrame !== 'object') return;

  Object.entries(finalFrame).forEach(([property, value]) => {
    if (property === 'offset' || property === 'easing' || property === 'composite') return;
    element.style[property] = `${value}`;
  });
};

export async function animateWithCleanup(
  element,
  keyframes,
  options,
  signal,
  animate = (target, frames, animationOptions) => target.animate(frames, animationOptions)
) {
  if (signal.aborted) return { status: 'cancelled' };

  element.dataset.motionActive = '';
  let animation;
  let abort;

  try {
    animation = animate(element, keyframes, options);
    const aborted = new Promise((resolve) => {
      abort = () => {
        animation?.cancel?.();
        resolve({ status: 'cancelled' });
      };
      signal.addEventListener('abort', abort, { once: true });
    });

    const completed = animation?.finished
      ? Promise.resolve(animation.finished).then(
        () => ({ status: 'completed' }),
        (error) => {
          if (signal.aborted) return { status: 'cancelled' };
          throw error;
        }
      )
      : Promise.resolve({ status: 'completed' });

    const result = await Promise.race([completed, aborted]);
    if (result.status === 'completed') applyFinalKeyframe(element, keyframes);
    return result;
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    animation?.cancel?.();
    delete element.dataset.motionActive;
  }
}

export function tweenWithCleanup({
  from,
  to,
  duration,
  easing,
  render,
  signal,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame
}) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve({ status: 'cancelled' });
      return;
    }

    let frameId = null;
    let startedAt = null;
    let settled = false;

    const cleanup = () => {
      if (frameId !== null) cancelFrame(frameId);
      signal.removeEventListener('abort', abort);
    };
    const finish = (status) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ status });
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => finish('cancelled');

    signal.addEventListener('abort', abort, { once: true });

    if (duration <= 0) {
      try {
        render(to);
        finish(signal.aborted ? 'cancelled' : 'completed');
      } catch (error) {
        fail(error);
      }
      return;
    }

    const frame = (time) => {
      if (settled) return;
      if (startedAt === null) startedAt = time;
      const progress = Math.min(1, Math.max(0, (time - startedAt) / duration));
      try {
        render(from + (to - from) * easing(progress));
      } catch (error) {
        fail(error);
        return;
      }

      if (signal.aborted) {
        finish('cancelled');
        return;
      }

      if (progress >= 1) finish('completed');
      else frameId = requestFrame(frame);
    };

    frameId = requestFrame(frame);
  });
}
