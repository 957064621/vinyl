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

  const loadSelectedTrack = async ({ signal, targetIndex, profile, tokens }) => {
    try {
      const track = await selectTrack(targetIndex, { signal });
      assertActive(signal);
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

      await loadSelectedTrack({ signal, targetIndex, profile, tokens });

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
