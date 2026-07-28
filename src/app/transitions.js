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

export function createAppTransitions({
  turntable,
  overlays,
  controls,
  audio,
  selectTrack,
  waitForCoverReveal = () => Promise.resolve(),
  waitForDelay = waitForAbortableDelay
}) {
  const resetAfterPlaybackError = async (signal, tokens, profile) => {
    await turntable.resetAfterPlaybackError({
      signal,
      duration: tokens.settle
    });
    if (signal.aborted) return;
    await controls.setLabel('再次抽取', {
      signal,
      duration: tokens.enter,
      profile
    });
  };

  const loadSelectedTrack = async ({
    signal,
    targetIndex,
    profile,
    tokens,
    onSelected = () => {}
  }) => {
    try {
      const track = await selectTrack(targetIndex, { signal });
      assertActive(signal);
      onSelected();
      const loaded = await audio.load(track);
      if (loaded === false) throw new Error('Audio load did not complete');
      assertActive(signal);
      return track;
    } catch (error) {
      if (!signal.aborted) await resetAfterPlaybackError(signal, tokens, profile);
      throw error;
    }
  };

  const playSelectedTrack = async (signal, tokens, profile) => {
    try {
      const played = await audio.play({ signal });
      if (played === false) throw new Error('Audio playback did not start');
    } catch (error) {
      await resetAfterPlaybackError(signal, tokens, profile);
      assertActive(signal);
      throw error;
    }
  };

  return {
    async draw({ signal, targetIndex, profile, tokens }) {
      const overlayState = await overlays.closeAll({
        signal,
        duration: tokens.enter,
        profile
      });
      assertActive(signal);

      audio.pause();
      assertActive(signal);

      const current = turntable.readState();
      turntable.setSpinning(true);
      await Promise.all([
        controls.setLabel('读取中', { signal, duration: tokens.enter, profile }),
        turntable.moveArmTo('rest', {
          signal,
          duration: tokens.move,
          from: current.arm,
          profile
        }),
        turntable.rampRateTo(5.2, {
          signal,
          duration: tokens.move,
          from: current.rate,
          profile
        })
      ]);
      assertActive(signal);

      let lyricHold = Promise.resolve();
      await loadSelectedTrack({
        signal,
        targetIndex,
        profile,
        tokens,
        onSelected: () => {
          lyricHold = Promise.resolve(waitForCoverReveal({ signal }))
            .then(() => waitForDelay(DRAW_LYRIC_HOLD_MS, signal));
        }
      });

      const turntableSettling = Promise.all([
        turntable.moveArmTo('play', { signal, duration: tokens.settle, profile }),
        turntable.rampRateTo(0.68, { signal, duration: tokens.settle, profile })
      ]);

      await lyricHold;
      assertActive(signal);

      await overlays.open('lyrics', {
        signal,
        duration: tokens.enter,
        profile,
        previousState: overlayState
      });
      assertActive(signal);

      await turntableSettling;
      assertActive(signal);

      await playSelectedTrack(signal, tokens, profile);
      assertActive(signal);
      await controls.setLabel('再次抽取', { signal, duration: tokens.enter, profile });
      assertActive(signal);
    },

    async switchTrack({
      signal,
      targetIndex,
      profile,
      tokens,
      headless = false,
      showLyrics = false
    }) {
      const overlayState = headless
        ? null
        : await overlays.closeAll({ signal, duration: tokens.enter, profile });
      assertActive(signal);

      audio.pause();
      assertActive(signal);

      await loadSelectedTrack({ signal, targetIndex, profile, tokens });

      if (!headless && !showLyrics) {
        await overlays.refresh({ signal, duration: tokens.enter, profile });
        assertActive(signal);
      }

      await playSelectedTrack(signal, tokens, profile);
      assertActive(signal);

      if (!headless) {
        if (showLyrics) {
          await overlays.open('lyrics', {
            signal,
            duration: tokens.enter,
            profile,
            previousState: overlayState
          });
        } else {
          await overlays.restoreAfterTrackSwitch(overlayState, {
            signal,
            duration: tokens.enter,
            profile
          });
        }
        assertActive(signal);
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
