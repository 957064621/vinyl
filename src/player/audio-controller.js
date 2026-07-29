export function createAudioController({
    audio,
    onStateChange = () => {},
    onEnded = () => {},
    onTimeUpdate = () => {},
    mediaSession = typeof navigator !== 'undefined' ? navigator.mediaSession : null,
    MediaMetadataCtor = typeof globalThis.MediaMetadata === 'function'
        ? globalThis.MediaMetadata
        : null
}) {
    let track = null;
    let requestId = 0;
    let playGeneration = 0;
    let activePlayGeneration = null;
    let status = 'idle';
    let error = null;

    const publish = () => onStateChange({ status, error, track });
    const updatePlaybackState = () => {
        if (!mediaSession) return;
        try {
            mediaSession.playbackState = status === 'playing'
                ? 'playing'
                : status === 'idle'
                    ? 'none'
                    : 'paused';
        } catch {
            // Partial Media Session implementations may reject state writes.
        }
    };
    const setMediaMetadata = (metadata) => {
        if (!mediaSession) return;
        try {
            mediaSession.metadata = metadata || null;
        } catch {
            // Media Session metadata is optional and may be read-only in embedded webviews.
        }
    };
    const clearPositionState = () => {
        if (typeof mediaSession?.setPositionState !== 'function') return;
        try {
            mediaSession.setPositionState();
        } catch {
            // Clearing position state is optional in partial Media Session implementations.
        }
    };
    const updatePositionState = () => {
        if (typeof mediaSession?.setPositionState !== 'function') return;
        const duration = Number.isFinite(audio.duration) ? audio.duration : NaN;
        if (!Number.isFinite(duration) || duration <= 0) return;
        const playbackRate = Number.isFinite(audio.playbackRate) && audio.playbackRate > 0
            ? audio.playbackRate
            : 1;
        const position = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
        try {
            mediaSession.setPositionState({
                duration,
                playbackRate,
                position: Math.max(0, Math.min(duration, position))
            });
        } catch {
            // Position state is optional and can fail while metadata is changing.
        }
    };
    const setStatus = (next, nextError = null) => {
        status = next;
        error = nextError;
        updatePlaybackState();
        publish();
    };
    const invalidatePlayAttempt = () => {
        playGeneration += 1;
        activePlayGeneration = null;
    };
    const onError = () => {
        invalidatePlayAttempt();
        audio.pause();
        if (!track) {
            clearPositionState();
            if (status !== 'error') setStatus('idle');
            return;
        }
        setStatus('error', new Error(`Audio failed: ${track?.title || 'unknown'}`));
    };
    const onPlay = () => {
        const isAuthorizedAttempt = status === 'loading' && activePlayGeneration === playGeneration;
        if (isAuthorizedAttempt) return;
        if (status === 'playing') {
            updatePositionState();
            return;
        }
        audio.pause();
    };
    const onPause = () => {
        const pausedActiveAttempt = activePlayGeneration !== null;
        if (pausedActiveAttempt) invalidatePlayAttempt();
        if (status === 'playing' || pausedActiveAttempt) setStatus('paused');
    };
    const handleEnded = () => {
        invalidatePlayAttempt();
        setStatus('paused');
        onEnded(track);
    };
    const handleTimeUpdate = () => {
        updatePositionState();
        onTimeUpdate({
            currentTime: audio.currentTime,
            duration: audio.duration,
            track
        });
    };

    audio.addEventListener('error', onError);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.preload = 'metadata';
    audio.setAttribute('playsinline', '');

    const hasLoadedMetadata = () => (
        Number.isFinite(audio.readyState) && audio.readyState >= 1
    );
    const createMetadataGate = ({ signal, timeoutMs = 8000 } = {}) => {
        let settle = () => {};
        const promise = new Promise((resolve) => {
            let settled = false;
            let timer = null;
            const finish = (ready) => {
                if (settled) return;
                settled = true;
                if (timer !== null) clearTimeout(timer);
                audio.removeEventListener('loadedmetadata', onReady);
                audio.removeEventListener('canplay', onReady);
                audio.removeEventListener('error', onErrorEvent);
                signal?.removeEventListener('abort', onAbort);
                resolve(ready);
            };
            const onReady = () => finish(true);
            const onErrorEvent = () => finish(false);
            const onAbort = () => finish(false);
            settle = finish;

            audio.addEventListener('loadedmetadata', onReady, { once: true });
            audio.addEventListener('canplay', onReady, { once: true });
            audio.addEventListener('error', onErrorEvent, { once: true });
            signal?.addEventListener('abort', onAbort, { once: true });
            timer = setTimeout(() => finish(false), timeoutMs);
            if (signal?.aborted) finish(false);
        });

        return {
            promise,
            cancel() { settle(false); }
        };
    };

    const load = async (nextTrack) => {
        const id = ++requestId;
        invalidatePlayAttempt();
        track = nextTrack;
        if (!nextTrack?.musicOssUrl) {
            audio.pause();
            audio.removeAttribute?.('src');
            audio.load();
            const nextError = new Error(`Missing audio URL: ${nextTrack?.title || 'unknown'}`);
            setStatus('error', nextError);
            throw nextError;
        }

        setStatus('loading');
        audio.src = nextTrack.musicOssUrl;
        audio.load();
        await Promise.resolve();
        if (id !== requestId) return false;

        if (mediaSession && MediaMetadataCtor) {
            try {
                mediaSession.metadata = new MediaMetadataCtor({
                    title: nextTrack.title,
                    artist: nextTrack.artist || '薛之谦',
                    album: nextTrack.album,
                    artwork: nextTrack.artwork
                });
            } catch {
                // Metadata is supplemental; playback remains available without it.
            }
        }

        if (id !== requestId) return false;
        setStatus('ready');
        updatePositionState();
        return true;
    };

    const play = async ({ signal } = {}) => {
        if (!track?.musicOssUrl) throw new Error('No audio track is loaded');
        if (signal?.aborted) return false;
        const id = requestId;
        const generation = ++playGeneration;
        activePlayGeneration = generation;
        const isCurrentAttempt = () => (
            id === requestId &&
            generation === playGeneration &&
            activePlayGeneration === generation
        );
        setStatus('loading');
        let abort;
        const aborted = new Promise((resolve) => {
            abort = () => resolve({ aborted: true });
            signal?.addEventListener('abort', abort, { once: true });
        });
        let playAttempt;
        try {
            playAttempt = audio.play();
        } catch (playError) {
            playAttempt = Promise.reject(playError);
        }
        const attempt = Promise.resolve(playAttempt).then(
            () => ({ played: true }),
            (playError) => ({ playError })
        );

        try {
            const result = signal ? await Promise.race([attempt, aborted]) : await attempt;
            if (!isCurrentAttempt()) return false;
            if (result.aborted) {
                audio.pause();
                if (status !== 'paused') setStatus('paused');
                return false;
            }
            if (result.playError) throw result.playError;
            setStatus('playing');
            updatePositionState();
            return true;
        } catch (nextError) {
            if (!isCurrentAttempt()) return false;
            audio.pause();
            setStatus('error', nextError);
            throw nextError;
        } finally {
            if (activePlayGeneration === generation) activePlayGeneration = null;
            signal?.removeEventListener('abort', abort);
        }
    };

    const clear = ({ nextStatus = 'idle', nextError = null } = {}) => {
        requestId += 1;
        invalidatePlayAttempt();
        track = null;
        status = nextStatus;
        error = nextError;
        audio.pause();
        audio.removeAttribute?.('src');
        audio.load();
        setMediaMetadata(null);
        clearPositionState();
        setStatus(nextStatus, nextError);
        return { status, error, track };
    };

    const restore = async (snapshot, {
        resumePlayback = true,
        restoreVolume = true,
        signal,
        metadataTimeoutMs = 8000,
        emptyStatus = 'idle',
        emptyError = null
    } = {}) => {
        if (!snapshot?.track?.musicOssUrl) {
            clear({ nextStatus: emptyStatus, nextError: emptyError });
            return { playbackRestored: false };
        }

        const restoredTime = Number.isFinite(snapshot.currentTime)
            ? Math.max(0, snapshot.currentTime)
            : 0;
        const metadataGate = restoredTime > 0
            ? createMetadataGate({ signal, timeoutMs: metadataTimeoutMs })
            : null;
        setMediaMetadata(snapshot.mediaMetadata);
        clearPositionState();

        try {
            const loaded = await load(snapshot.track);
            if (loaded === false) return { playbackRestored: false };

            if (metadataGate) {
                const metadataReady = hasLoadedMetadata() || await metadataGate.promise;
                if (!metadataReady) {
                    throw new Error(`Audio metadata recovery timed out: ${snapshot.track.title || 'unknown'}`);
                }
            }

            audio.currentTime = restoredTime;
            if (restoreVolume && Number.isFinite(snapshot.volume)) {
                try {
                    audio.volume = snapshot.volume;
                } catch {
                    // iOS and embedded browsers may expose a read-only media volume.
                }
            }
            setMediaMetadata(snapshot.mediaMetadata);
            updatePositionState();

            if (resumePlayback && snapshot.status === 'playing') {
                return { playbackRestored: await play({ signal }) !== false };
            }

            if (snapshot.status === 'error') {
                setStatus('error', snapshot.error || new Error(`Audio failed: ${snapshot.track.title || 'unknown'}`));
            } else if (snapshot.status === 'paused' || snapshot.status === 'playing') {
                setStatus('paused');
            } else {
                setStatus('ready');
            }
            return { playbackRestored: false };
        } finally {
            metadataGate?.cancel();
        }
    };

    const safeAction = (handler) => (details) => {
        try {
            Promise.resolve(handler?.(details)).catch(() => {});
        } catch {
            // Browser media controls must not leak application handler failures.
        }
    };

    const bindMediaActions = ({
        nextTrack,
        previousTrack,
        playTrack = () => play(),
        pauseTrack = () => audio.pause(),
        stopTrack = () => audio.pause()
    } = {}) => {
        if (typeof mediaSession?.setActionHandler !== 'function') return;
        const actions = {
            play: safeAction(playTrack),
            pause: safeAction(pauseTrack),
            nexttrack: safeAction(nextTrack),
            previoustrack: safeAction(previousTrack),
            seekto: safeAction(({ seekTime, fastSeek } = {}) => {
                if (!Number.isFinite(seekTime)) return;
                const duration = Number.isFinite(audio.duration) && audio.duration > 0
                    ? audio.duration
                    : seekTime;
                const nextTime = Math.max(0, Math.min(duration, seekTime));
                if (fastSeek && typeof audio.fastSeek === 'function') audio.fastSeek(nextTime);
                else audio.currentTime = nextTime;
                updatePositionState();
            }),
            seekforward: safeAction(({ seekOffset = 10 } = {}) => {
                const duration = Number.isFinite(audio.duration) && audio.duration > 0
                    ? audio.duration
                    : Infinity;
                audio.currentTime = Math.min(duration, audio.currentTime + seekOffset);
                updatePositionState();
            }),
            seekbackward: safeAction(({ seekOffset = 10 } = {}) => {
                audio.currentTime = Math.max(0, audio.currentTime - seekOffset);
                updatePositionState();
            }),
            stop: safeAction(stopTrack)
        };

        for (const [name, handler] of Object.entries(actions)) {
            try {
                mediaSession.setActionHandler(name, handler);
            } catch {
                // Unsupported actions differ by browser and OS version.
            }
        }
    };

    return {
        load,
        play,
        clear,
        restore,
        pause() {
            invalidatePlayAttempt();
            audio.pause();
            if (status !== 'error' && status !== 'paused') setStatus('paused');
        },
        async retry({ signal, metadataTimeoutMs = 8000 } = {}) {
            if (!track?.musicOssUrl) throw new Error('No audio track is loaded');
            const retryTime = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
            const metadataGate = retryTime > 0
                ? createMetadataGate({ signal, timeoutMs: metadataTimeoutMs })
                : null;
            audio.load();
            try {
                if (metadataGate) {
                    const metadataReady = hasLoadedMetadata() || await metadataGate.promise;
                    if (!metadataReady) {
                        throw new Error(`Audio metadata retry timed out: ${track.title || 'unknown'}`);
                    }
                    audio.currentTime = retryTime;
                    updatePositionState();
                }
                return play({ signal });
            } finally {
                metadataGate?.cancel();
            }
        },
        seekToFraction(fraction) {
            if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
            audio.currentTime = Math.max(0, Math.min(1, fraction)) * audio.duration;
            updatePositionState();
        },
        updatePositionState,
        bindMediaActions,
        getState() { return { status, error, track }; },
        destroy() {
            requestId += 1;
            invalidatePlayAttempt();
            audio.removeEventListener('error', onError);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.pause();
        }
    };
}
