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
    let status = 'idle';
    let error = null;

    const publish = () => onStateChange({ status, error, track });
    const updatePlaybackState = () => {
        if (!mediaSession) return;
        try {
            mediaSession.playbackState = status === 'playing' ? 'playing' : 'paused';
        } catch {
            // Partial Media Session implementations may reject state writes.
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
    const onError = () => {
        audio.pause();
        setStatus('error', new Error(`Audio failed: ${track?.title || 'unknown'}`));
    };
    const onPlay = () => {
        if (status !== 'loading') setStatus('playing');
    };
    const onPause = () => {
        if (status !== 'error') setStatus('paused');
    };
    const handleEnded = () => onEnded(track);
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

    const load = async (nextTrack) => {
        const id = ++requestId;
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
            if (result.aborted || id !== requestId) {
                audio.pause();
                if (id === requestId) setStatus('paused');
                return false;
            }
            if (result.playError) throw result.playError;
            setStatus('playing');
            updatePositionState();
            return true;
        } catch (nextError) {
            audio.pause();
            setStatus('error', nextError);
            throw nextError;
        } finally {
            signal?.removeEventListener('abort', abort);
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
        pause() { audio.pause(); },
        async retry() {
            if (!track?.musicOssUrl) throw new Error('No audio track is loaded');
            audio.load();
            return play();
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
            audio.removeEventListener('error', onError);
            audio.removeEventListener('play', onPlay);
            audio.removeEventListener('pause', onPause);
            audio.removeEventListener('ended', handleEnded);
            audio.removeEventListener('timeupdate', handleTimeUpdate);
            audio.pause();
        }
    };
}
