const assertActive = (signal) => {
  if (signal.aborted) {
    throw signal.reason || new DOMException('Aborted', 'AbortError');
  }
};

export const DRAW_LYRIC_HOLD_MS = 500;

const waitForAbortableDelay = (duration, signal) => new Promise((resolve) => {
  if (signal.aborted || duration <= 0) {
    resolve();
    return;
  }

  let timer = null;
  const finish = () => {
    if (timer !== null) clearTimeout(timer);
    signal.removeEventListener('abort', finish);
    resolve();
  };

  timer = setTimeout(finish, duration);
  signal.addEventListener('abort', finish, { once: true });
});

const createCleanupSignal = () => new AbortController().signal;

const markAudioFailure = (failure, operation) => {
  const error = failure instanceof Error
    ? failure
    : new Error(`Audio ${operation} failed: ${String(failure)}`);
  try {
    Object.defineProperty(error, 'audioOperation', {
      configurable: true,
      value: operation
    });
  } catch {
    // Frozen host errors retain their original identity and message.
  }
  return error;
};

const createOperationScope = (parentSignal) => {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(
    parentSignal.reason || new DOMException('Aborted', 'AbortError')
  );
  parentSignal.addEventListener('abort', forwardAbort, { once: true });
  if (parentSignal.aborted) forwardAbort();

  return {
    signal: controller.signal,
    abort(reason) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    dispose() {
      parentSignal.removeEventListener('abort', forwardAbort);
    }
  };
};

const createInFlightTracker = () => {
  const pending = new Set();
  return {
    track(task) {
      const promise = Promise.resolve(task);
      pending.add(promise);
      promise.then(
        () => pending.delete(promise),
        () => pending.delete(promise)
      );
      return promise;
    },
    settle() {
      return Promise.allSettled([...pending]);
    }
  };
};

export function createAppTransitions({
  turntable,
  overlays,
  controls,
  audio,
  prepareTrack,
  commitTrack,
  rollbackTrack,
  waitForCoverReveal = () => Promise.resolve(),
  waitForDelay = waitForAbortableDelay
}) {
  const setStableLabel = async (label, tokens, profile) => {
    await controls.setLabel(label, {
      signal: createCleanupSignal(),
      duration: 0,
      profile
    });
  };

  const getRestoredLabel = (transaction) => (
    Number.isInteger(transaction?.previousIndex) && transaction.previousIndex >= 0
      ? '再次抽取'
      : '抽取'
  );

  const restoreInterruptedSelection = async ({
    transaction,
    mechanics,
    overlayState,
    signal,
    tokens,
    profile
  }) => {
    let playbackRestored = false;

    if (transaction) {
      try {
        const failure = signal.reason;
        const retryable = audio.getState?.().status === 'error'
          || ['load', 'playback'].includes(failure?.audioOperation)
          || (failure instanceof Error && /^Audio (?:load|playback)/.test(failure.message));
        const result = await rollbackTrack(transaction, {
          resumePlayback: true,
          retryable
        });
        playbackRestored = result?.playbackRestored === true;
      } catch {
        playbackRestored = false;
      }
    }

    if (playbackRestored && typeof turntable.restoreState === 'function') {
      await turntable.restoreState(mechanics, {
        duration: signal.aborted ? 0 : tokens.settle
      });
    } else {
      await turntable.resetAfterPlaybackError({
        duration: signal.aborted ? 0 : tokens.settle
      });
    }

    if (overlayState && typeof overlays.restoreAfterTrackSwitch === 'function') {
      await overlays.restoreAfterTrackSwitch(overlayState, {
        signal: createCleanupSignal(),
        duration: 0,
        profile
      });
    }

    await setStableLabel(getRestoredLabel(transaction), tokens, profile);
  };

  const settleCommittedSelection = async ({ tokens, profile }) => {
    if (typeof audio.getState === 'function' && audio.getState().status !== 'playing') {
      await turntable.resetAfterPlaybackError({ duration: 0 });
      await setStableLabel('再次抽取', tokens, profile);
      return;
    }
    turntable.setSpinning(true);
    await Promise.all([
      turntable.moveArmTo('play', {
        signal: createCleanupSignal(),
        duration: 0,
        profile
      }),
      turntable.rampRateTo(0.68, {
        signal: createCleanupSignal(),
        duration: 0,
        profile
      })
    ]);
    await setStableLabel('再次抽取', tokens, profile);
  };

  const loadPreparedTrack = async (transaction, signal, profile) => {
    const loadAudio = async () => {
      try {
        return await audio.load(transaction.track, { signal });
      } catch (error) {
        throw markAudioFailure(error, 'load');
      }
    };
    const [loaded] = await Promise.all([
      loadAudio(),
      transaction.ready || Promise.resolve()
    ]);
    assertActive(signal);
    if (loaded === false) throw new Error('Audio load did not complete');
    await commitTrack(transaction, { signal, profile });
    assertActive(signal);
    return transaction.track;
  };

  const playPreparedTrack = async (signal) => {
    let played;
    try {
      played = await audio.play({ signal });
    } catch (error) {
      throw markAudioFailure(error, 'playback');
    }
    assertActive(signal);
    if (played === false) throw new Error('Audio playback did not start');
  };

  return {
    async draw({ signal, targetIndex, profile, tokens }) {
      let transaction = null;
      let playbackStarted = false;
      let overlayState = overlays.readState?.() || null;
      const mechanics = turntable.readState();
      const scope = createOperationScope(signal);
      const operationSignal = scope.signal;
      const inFlight = createInFlightTracker();

      try {
        transaction = prepareTrack(targetIndex, { signal: operationSignal });
        assertActive(operationSignal);

        const overlayStatePromise = inFlight.track(overlays.closeAll({
          signal: operationSignal,
          duration: tokens.enter,
          profile
        }));
        const busyLabel = controls.setLabel('抽取中', {
          signal: operationSignal,
          duration: tokens.enter,
          profile
        });

        audio.pause();
        turntable.setSpinning(true);

        const bridge = inFlight.track(Promise.all([
          busyLabel,
          turntable.moveArmTo('rest', {
            signal: operationSignal,
            duration: tokens.move,
            from: mechanics.arm,
            profile
          }),
          turntable.rampRateTo(5.2, {
            signal: operationSignal,
            duration: tokens.move,
            from: mechanics.rate,
            profile
          })
        ]));
        const loading = inFlight.track(loadPreparedTrack(transaction, operationSignal, profile));
        const coverSettled = inFlight.track(loading.then(async () => {
          assertActive(operationSignal);
          await waitForCoverReveal({ signal: operationSignal });
          assertActive(operationSignal);
        }));
        const coverHold = inFlight.track(coverSettled.then(() => (
          waitForDelay(DRAW_LYRIC_HOLD_MS, operationSignal)
        )));
        const turntableSettling = inFlight.track(coverSettled.then(() => Promise.all([
          turntable.moveArmTo('play', {
            signal: operationSignal,
            duration: Math.min(tokens.settle, DRAW_LYRIC_HOLD_MS),
            profile
          }),
          turntable.rampRateTo(0.68, {
            signal: operationSignal,
            duration: tokens.settle,
            profile
          })
        ])));
        const [closedOverlayState] = await Promise.all([overlayStatePromise, bridge, loading]);
        overlayState ||= closedOverlayState;
        assertActive(operationSignal);

        await coverHold;
        assertActive(operationSignal);

        await playPreparedTrack(operationSignal);
        playbackStarted = true;

        await overlays.open('lyrics', {
          signal: operationSignal,
          duration: tokens.enter,
          profile,
          previousState: overlayState
        });
        assertActive(operationSignal);

        await turntableSettling;
        assertActive(operationSignal);

        await controls.setLabel('再次抽取', {
          signal: operationSignal,
          duration: tokens.enter,
          profile
        });
        assertActive(operationSignal);
      } catch (error) {
        scope.abort(error);
        await inFlight.settle();
        if (playbackStarted) {
          await settleCommittedSelection({ tokens, profile });
        } else {
          await restoreInterruptedSelection({
            transaction,
            mechanics,
            overlayState,
            signal: operationSignal,
            tokens,
            profile
          });
        }
        throw error;
      } finally {
        scope.dispose();
      }
    },

    async switchTrack({
      signal,
      targetIndex,
      profile,
      tokens,
      headless = false,
      showLyrics = false
    }) {
      let transaction = null;
      let playbackStarted = false;
      let overlayState = headless ? null : overlays.readState?.() || null;
      const mechanics = turntable.readState();
      const scope = createOperationScope(signal);
      const operationSignal = scope.signal;
      const inFlight = createInFlightTracker();

      try {
        transaction = prepareTrack(targetIndex, { signal: operationSignal });
        assertActive(operationSignal);

        const overlayStatePromise = headless
          ? Promise.resolve(null)
          : inFlight.track(overlays.closeAll({
              signal: operationSignal,
              duration: tokens.enter,
              profile
            }));
        const busyLabel = headless
          ? Promise.resolve()
          : controls.setLabel('抽取中', {
              signal: operationSignal,
              duration: tokens.enter,
              profile
            });

        audio.pause();
        const bridgeRate = Math.min(5.2, Math.max(1.85, mechanics.rate + 0.92));
        const bridge = headless
          ? Promise.resolve()
          : (() => {
              turntable.setSpinning(true);
              return inFlight.track(Promise.all([
                busyLabel,
                turntable.moveArmTo('rest', {
                  signal: operationSignal,
                  duration: tokens.move,
                  from: mechanics.arm,
                  profile
                }),
                turntable.rampRateTo(bridgeRate, {
                  signal: operationSignal,
                  duration: tokens.move,
                  from: mechanics.rate,
                  profile
                })
              ]));
            })();
        const loading = inFlight.track(loadPreparedTrack(transaction, operationSignal, profile));
        const [closedOverlayState] = await Promise.all([overlayStatePromise, bridge, loading]);
        overlayState ||= closedOverlayState;
        assertActive(operationSignal);

        if (!headless) {
          await waitForCoverReveal({ signal: operationSignal });
          assertActive(operationSignal);
          if (!showLyrics) {
            await overlays.refresh({
              signal: operationSignal,
              duration: tokens.enter,
              profile
            });
            assertActive(operationSignal);
          }
        }

        if (headless) turntable.setSpinning(true);
        await Promise.all([
          turntable.moveArmTo('play', {
            signal: operationSignal,
            duration: headless ? 0 : tokens.settle,
            profile
          }),
          turntable.rampRateTo(0.68, {
            signal: operationSignal,
            duration: headless ? 0 : tokens.settle,
            profile
          })
        ]);
        assertActive(operationSignal);

        await playPreparedTrack(operationSignal);
        playbackStarted = true;

        if (!headless) {
          if (showLyrics) {
            await overlays.open('lyrics', {
              signal: operationSignal,
              duration: tokens.enter,
              profile,
              previousState: overlayState
            });
          } else {
            await overlays.restoreAfterTrackSwitch(overlayState, {
              signal: operationSignal,
              duration: tokens.enter,
              profile
            });
          }
          assertActive(operationSignal);
          await controls.setLabel('再次抽取', {
            signal: operationSignal,
            duration: tokens.enter,
            profile
          });
        }
      } catch (error) {
        scope.abort(error);
        await inFlight.settle();
        if (playbackStarted) {
          await settleCommittedSelection({ tokens, profile });
        } else {
          await restoreInterruptedSelection({
            transaction,
            mechanics,
            overlayState,
            signal: operationSignal,
            tokens,
            profile
          });
        }
        throw error;
      } finally {
        scope.dispose();
      }
    },

    async openOverlay({ signal, kind, profile, tokens }) {
      assertActive(signal);
      await overlays.open(kind, { signal, duration: tokens.enter, profile });
      assertActive(signal);
    },
    async closeOverlay({ signal, kind, profile, tokens }) {
      assertActive(signal);
      await overlays.close(kind, { signal, duration: tokens.enter, profile });
      assertActive(signal);
    },
    setDocumentVisible(visible) {
      turntable.setDocumentVisible(visible);
      overlays.setDocumentVisible(visible);
    },
    dispose() {
      turntable.dispose();
      overlays.dispose();
    }
  };
}
