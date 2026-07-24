const assertActive = (signal) => {
  if (signal.aborted) {
    throw signal.reason || new DOMException('Aborted', 'AbortError');
  }
};

export function createAppTransitions({
  turntable,
  overlays,
  controls,
  audio,
  selectTrack
}) {
  const resetAfterPlaybackError = async (signal, tokens) => {
    await turntable.resetAfterPlaybackError({
      signal,
      duration: tokens.settle
    });
  };

  const loadSelectedTrack = async ({ signal, targetIndex, tokens }) => {
    try {
      const track = await selectTrack(targetIndex, { signal });
      assertActive(signal);
      await audio.load(track);
      assertActive(signal);
      return track;
    } catch (error) {
      if (!signal.aborted) await resetAfterPlaybackError(signal, tokens);
      throw error;
    }
  };

  const playSelectedTrack = async (signal, tokens) => {
    try {
      const played = await audio.play({ signal });
      if (played === false) {
        await resetAfterPlaybackError(signal, tokens);
      }
    } catch (error) {
      await resetAfterPlaybackError(signal, tokens);
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

      await loadSelectedTrack({ signal, targetIndex, tokens });

      await Promise.all([
        turntable.moveArmTo('play', { signal, duration: tokens.settle, profile }),
        turntable.rampRateTo(0.68, { signal, duration: tokens.settle, profile })
      ]);
      assertActive(signal);

      await overlays.open('lyrics', {
        signal,
        duration: tokens.enter,
        profile,
        previousState: overlayState
      });
      assertActive(signal);

      await playSelectedTrack(signal, tokens);
      assertActive(signal);
      await controls.setLabel('再次抽取', { signal, duration: tokens.enter, profile });
      assertActive(signal);
    },

    async switchTrack({ signal, targetIndex, profile, tokens, headless = false }) {
      const overlayState = headless
        ? null
        : await overlays.closeAll({ signal, duration: tokens.enter, profile });
      assertActive(signal);

      audio.pause();
      assertActive(signal);

      await loadSelectedTrack({ signal, targetIndex, tokens });

      if (!headless) {
        await overlays.refresh({ signal, duration: tokens.enter, profile });
        assertActive(signal);
      }

      await playSelectedTrack(signal, tokens);
      assertActive(signal);

      if (!headless) {
        await overlays.restoreAfterTrackSwitch(overlayState, {
          signal,
          duration: tokens.enter,
          profile
        });
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
