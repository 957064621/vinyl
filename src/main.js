import {
    COVER_BASE_URL,
    COVER_ROTATION_FILES,
    releases,
    lyricsPool
} from './data.js';

        const loadingScreen = document.getElementById('loadingScreen');
        const appShell = document.getElementById('appShell');
        const turntable = document.getElementById('turntable');
        const tonearm = document.getElementById('tonearm');
        const vinyl = document.getElementById('vinylRecord');
        const vinylSheen = document.getElementById('vinylSheen');
        const playButton = document.getElementById('playButton');
        const resultArea = document.getElementById('resultArea');
        const lyricEl = document.getElementById('lyricText');
        const songEl = document.getElementById('songName');
        const btnTextEl = document.getElementById('btnText');
        const contactLink = document.getElementById('contactLink');
        const copyToast = document.getElementById('copyToast');

        const dynamicIsland = document.getElementById('dynamicIsland');
        const playerToggleBtn = document.getElementById('playerToggleBtn');
        const trackWrap = document.getElementById('trackWrap');
        const trackFill = document.getElementById('trackFill');
        const playerTime = document.getElementById('playerTime');
        const playlistToggleBtn = document.getElementById('playlistToggleBtn');
        const lyricToggleBtn = document.getElementById('lyricToggleBtn');
        const lyricDismissHint = document.getElementById('lyricDismissHint');
        const lyricCloseBtn = document.getElementById('lyricCloseBtn');
        const playlistArea = document.getElementById('playlistArea');
        const playlistContent = document.getElementById('playlistContent');
        const playlistList = document.getElementById('playlistList');
        const playlistModeSwitch = document.getElementById('playlistModeSwitch');
        const modeIcon = document.getElementById('modeIcon');
        const modeLabel = document.getElementById('modeLabel');
        const playlistDismissHint = document.getElementById('playlistDismissHint');
        const playlistCloseBtn = document.getElementById('playlistCloseBtn');

        let isDrawing = false;
        let isOverlayClosing = false;
        let lyricAnimations = [];
        let playlistAnimations = [];
        let hasShownDismissHint = false;
        let hasShownPlaylistHint = false;
        let canSetMediaVolume = true;
        let currentLyricIndex = -1;
        let drawQueue = [];
        const PLAYBACK_MODES = {
            RANDOM: 'random',
            LIST_LOOP: 'list-loop',
            SINGLE_LOOP: 'single-loop'
        };
        let playbackMode = PLAYBACK_MODES.RANDOM;
        const PLAYBACK_MODE_ORDER = [
            PLAYBACK_MODES.RANDOM,
            PLAYBACK_MODES.LIST_LOOP,
            PLAYBACK_MODES.SINGLE_LOOP
        ];
        const PLAYBACK_MODE_META = {
            [PLAYBACK_MODES.RANDOM]: {
                label: '随机播放',
                icon: '<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor"><path d="M924.928 222.805333l-82.346667-82.304a42.666667 42.666667 0 1 0-60.288 60.330667l12.458667 12.501333h-83.626667q-64.597333 0-118.357333 35.84t-78.592 95.445334l-125.824 301.952q-14.890667 35.754667-47.146667 57.258666Q308.949333 725.333333 270.208 725.333333H128a42.666667 42.666667 0 1 0 0 85.333334h142.208q64.597333 0 118.357333-35.84t78.549334-95.445334l125.866666-301.952q14.890667-35.754667 47.104-57.258666Q672.341333 298.666667 711.082667 298.666667h83.669333l-12.458667 12.501333a42.666667 42.666667 0 1 0 60.330667 60.330667l82.346667-82.346667Q938.666667 275.498667 938.666667 256t-13.738667-33.194667zM128 213.333333h90.325333q68.864 0 124.714667 40.277334 55.893333 40.277333 77.653333 105.6l3.754667 11.306666a42.666667 42.666667 0 1 1-80.938667 26.965334l-3.754666-11.306667q-13.056-39.168-46.592-63.36Q259.626667 298.666667 218.325333 298.666667H128a42.666667 42.666667 0 0 1 0-85.333334z m666.752 597.333334h-31.744q-68.864 0-124.757333-40.277334-55.893333-40.277333-77.653334-105.6l-3.754666-11.306666a42.666667 42.666667 0 1 1 80.938666-26.965334l3.797334 11.306667q13.056 39.168 46.592 63.36 33.493333 24.149333 74.837333 24.149333h31.744l-12.458667-12.501333a42.666667 42.666667 0 1 1 60.330667-60.330667l82.346667 82.346667Q938.666667 748.501333 938.666667 768t-13.738667 33.194667l-82.304 82.304a42.666667 42.666667 0 1 1-60.330667-60.330667l12.458667-12.501333z"/></svg>'
            },
            [PLAYBACK_MODES.LIST_LOOP]: {
                label: '列表循环',
                icon: '<svg viewBox="0 0 1205 1024" width="14" height="14" fill="currentColor"><path d="M397.914353 785.769412a290.635294 290.635294 0 0 1-290.334118-290.334118 290.635294 290.635294 0 0 1 290.334118-290.334118 51.380706 51.380706 0 0 0 9.095529-0.783058v78.426353c0 16.504471 18.853647 26.081882 32.165647 16.263529l178.296471-131.312941a20.299294 20.299294 0 0 0 0-32.527059L439.175529 4.035765a20.178824 20.178824 0 0 0-32.165647 16.263529v78.125177a51.380706 51.380706 0 0 0-9.095529-0.783059c-53.549176 0-105.592471 10.601412-154.684235 31.442823A399.058824 399.058824 0 0 0 116.856471 214.377412a396.890353 396.890353 0 0 0-85.413647 435.681882c20.178824 47.344941 48.790588 89.871059 85.413647 126.433882a396.890353 396.890353 0 0 0 281.057882 116.856471 53.790118 53.790118 0 1 0 0-107.580235zM1173.383529 340.811294a399.058824 399.058824 0 0 0-85.413647-126.433882 396.890353 396.890353 0 0 0-280.997647-116.856471 53.790118 53.790118 0 1 0 0 107.580235 290.635294 290.635294 0 0 1 290.334118 290.334118 290.635294 290.635294 0 0 1-290.334118 290.334118 51.561412 51.561412 0 0 0-15.902117 2.409412v-81.739295a20.178824 20.178824 0 0 0-32.105412-16.263529l-178.296471 131.252706a20.299294 20.299294 0 0 0 0 32.527059l178.115765 131.072a20.178824 20.178824 0 0 0 32.165647-16.26353v-77.824c4.999529 1.566118 10.360471 2.409412 15.841882 2.409412 53.549176 0 105.592471-10.661647 154.684236-31.503059a399.058824 399.058824 0 0 0 126.373647-85.353412 396.890353 396.890353 0 0 0 85.534117-435.681882z"/></svg>'
            },
            [PLAYBACK_MODES.SINGLE_LOOP]: {
                label: '单曲循环',
                icon: '<svg viewBox="0 0 1024 1024" width="14" height="14" fill="currentColor"><path d="M361.5 727.8c-119.1 0-215.9-96.9-215.9-215.9 0-119.1 96.9-215.9 215.9-215.9 2.3 0 4.6-0.2 6.8-0.6v58.3c0 12.3 14 19.4 23.9 12.1l132.6-97.6c8.1-6 8.1-18.2 0-24.2l-132.6-97.6c-9.9-7.3-23.9-0.2-23.9 12.1v58.1c-2.2-0.4-4.5-0.6-6.8-0.6-39.8 0-78.5 7.9-115 23.4-35.2 15-66.8 36.3-94 63.5s-48.6 58.8-63.5 94c-15.5 36.5-23.4 75.2-23.4 115s7.9 78.5 23.4 115c15 35.2 36.3 66.8 63.5 94s58.8 48.6 94 63.5c36.5 15.5 75.2 23.4 115 23.4 22.1 0 40-17.9 40-40s-17.9-40-40-40zM938.2 396.9c-15-35.2-36.3-66.8-63.5-94s-58.8-48.6-94-63.5c-36.5-15.5-75.2-23.4-115-23.4-22.1 0-40 17.9-40 40s17.9 40 40 40c119.1 0 215.9 96.9 215.9 215.9 0 119.1-96.9 215.9-215.9 215.9-4.1 0-8.1 0.6-11.8 1.8v-60.8c0-12.3-14-19.4-23.9-12.1l-132.6 97.6c-8.1 6-8.1 18.2 0 24.2L629.9 876c9.9 7.3 23.9 0.2 23.9-12.1V806c3.7 1.2 7.7 1.8 11.8 1.8 39.8 0 78.5-7.9 115-23.4 35.2-15 66.8-36.3 94-63.5s48.6-58.8 63.5-94c15.5-36.5 23.4-75.2 23.4-115s-7.8-78.5-23.3-115z"/><path d="M512.8 660.6c22.1-0.1 39.9-18.1 39.8-40.2l-1.2-214.1c-0.1-22-18-39.8-40-39.8h-0.2c-22.1 0.1-39.9 18.1-39.8 40.2l1.2 214.1c0.1 22 18 39.8 40 39.8h0.2z"/></svg>'
            }
        };

        const audioEl = document.createElement('audio');
        audioEl.setAttribute('playsinline', '');
        audioEl.setAttribute('webkit-playsinline', '');
        audioEl.preload = 'metadata';
        let isAudioPlaying = false;
        let volumeFadeFrame = null;
        let isDraggingTrack = false;
        let isTrackSwitching = false;
        let isHandlingTrackEnd = false;
        let buttonTextTransitionId = 0;

        const setPlayButtonBusy = (busy) => {
            playButton.disabled = false;
            playButton.toggleAttribute('data-busy', busy);
            playButton.setAttribute('aria-disabled', busy ? 'true' : 'false');
        };

        setPlayButtonBusy(false);

        const setPlayerToggleState = (playing) => {
            playerToggleBtn.classList.toggle('is-playing', playing);
            playerToggleBtn.setAttribute('aria-pressed', playing ? 'true' : 'false');
            playerToggleBtn.setAttribute('aria-label', playing ? '暂停播放' : '播放');
            playerToggleBtn.setAttribute('title', playing ? '暂停播放' : '播放');
        };

        setPlayerToggleState(false);

        const ua = navigator.userAgent || '';
        const platformName = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
        const isIOSDevice = /iPad|iPhone|iPod/i.test(ua) || (platformName === 'MacIntel' && navigator.maxTouchPoints > 1);
        const isAndroidDevice = /Android/i.test(ua);
        const isWeChatWebView = /MicroMessenger/i.test(ua);
        const isSafariBrowser = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);
        const playbackPlatform = {
            isIOS: isIOSDevice,
            isAndroid: isAndroidDevice,
            isDesktop: !isIOSDevice && !isAndroidDevice,
            isWeChat: isWeChatWebView,
            isSafari: isSafariBrowser
        };

        const canUseWebAnimations = typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';
        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        const createNoopAnimation = () => {
            let playbackRateValue = 1;
            return {
                play: () => {},
                pause: () => {},
                cancel: () => {},
                finish: () => {},
                reverse: () => {},
                finished: Promise.resolve(),
                get playbackRate() {
                    return playbackRateValue;
                },
                set playbackRate(value) {
                    playbackRateValue = value;
                }
            };
        };

        const applyFinalKeyframe = (el, keyframes) => {
            if (!Array.isArray(keyframes) || keyframes.length === 0) return;
            const finalFrame = keyframes[keyframes.length - 1];
            if (!finalFrame || typeof finalFrame !== 'object') return;

            Object.entries(finalFrame).forEach(([prop, value]) => {
                if (prop === 'offset' || prop === 'easing' || prop === 'composite') return;
                el.style[prop] = `${value}`;
            });
        };

        const motionFiltersEnabled = matchMedia('(hover: hover) and (pointer: fine)').matches && !prefersReducedMotion;
        const normalizeMotionKeyframes = (keyframes) => {
            if (motionFiltersEnabled || !Array.isArray(keyframes)) return keyframes;

            return keyframes.map((frame) => {
                if (!frame || typeof frame !== 'object' || !('filter' in frame)) return frame;
                const { filter, ...rest } = frame;
                return rest;
            });
        };

        const safeAnimate = (el, keyframes, options) => {
            const motionKeyframes = normalizeMotionKeyframes(keyframes);
            if (canUseWebAnimations && typeof el.animate === 'function') {
                const motionOptions = prefersReducedMotion
                    ? {
                        ...options,
                        duration: Math.min(Number(options?.duration) || 180, 180),
                        delay: Math.min(Number(options?.delay) || 0, 40),
                        easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                    }
                    : options;
                return el.animate(motionKeyframes, motionOptions);
            }

            // Older iOS/WebView builds may not support WAAPI; apply the final frame directly.
            applyFinalKeyframe(el, motionKeyframes);
            return createNoopAnimation();
        };

        const detectVolumeControlSupport = () => {
            try {
                const original = Number.isFinite(audioEl.volume) ? audioEl.volume : 1;
                const probe = original > 0.6 ? 0.4 : 0.9;
                audioEl.volume = probe;
                const isWritable = Math.abs(audioEl.volume - probe) < 0.01;
                audioEl.volume = original;
                return isWritable;
            } catch (error) {
                return false;
            }
        };

        canSetMediaVolume = detectVolumeControlSupport();

        const formatAudioTime = (time) => {
            if (isNaN(time)) return '0:00';
            const m = Math.floor(time / 60);
            const s = Math.floor(time % 60).toString().padStart(2, '0');
            return `${m}:${s}`;
        };

        const stripSongMarks = (song = '') => String(song || '').replace(/[《》]/g, '');

        const escapeHTML = (value = '') => String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');

        const escapeCSSUrl = (value = '') => String(value)
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/\n|\r/g, '');

        const getTrackByIndex = (index) => {
            if (!Number.isInteger(index) || index < 0 || index >= lyricsPool.length) return null;
            return lyricsPool[index];
        };

        const getFallbackCoverSrcByLyricIndex = (index) => {
            const normalizedIndex = Number.isInteger(index) ? Math.abs(index) : 0;
            const coverFile = COVER_ROTATION_FILES[normalizedIndex % COVER_ROTATION_FILES.length];
            return `${COVER_BASE_URL}${coverFile}`;
        };

        const getReleaseCoverSrc = (release) => release?.coverOssUrl || release?.sourceArtworkUrl || '';

        const getCoverSrcByLyricIndex = (index) => {
            const track = getTrackByIndex(index);
            return track?.coverOssUrl || track?.sourceArtworkUrl || getFallbackCoverSrcByLyricIndex(index);
        };

        const toInlineCoverProxySrc = (src = '') => src;

        const getPlayableMusicSrcByIndex = (index) => {
            const track = getTrackByIndex(index);
            return track?.musicOssUrl || '';
        };

        const getArtworkType = (src = '') => {
            if (/\.png(?:\?|$)/i.test(src)) return 'image/png';
            if (/\.webp(?:\?|$)/i.test(src)) return 'image/webp';
            return 'image/jpeg';
        };

        const shouldUseHeadlessTrackSwitch = () => {
            if (document.visibilityState !== 'visible') return true;
            // WeChat WebView background playback can be constrained; use the steadier headless branch.
            if (playbackPlatform.isWeChat) return true;
            return false;
        };

        const updateMediaSessionPlaybackState = () => {
            if (!('mediaSession' in navigator)) return;
            try {
                navigator.mediaSession.playbackState = isAudioPlaying ? 'playing' : 'paused';
            } catch (error) {
                // Ignore unsupported playbackState writes on partial implementations.
            }
        };

        const updateMediaSessionMetadata = (index = currentLyricIndex) => {
            if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
            if (!Number.isInteger(index) || index < 0 || index >= lyricsPool.length) return;

            const track = lyricsPool[index];
            const title = stripSongMarks(track.song);
            const artworkSrc = toInlineCoverProxySrc(getCoverSrcByLyricIndex(index));

            try {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title,
                    artist: track.artist || '薛之谦',
                    album: track.album || '歌词抽取机',
                    artwork: [
                        {
                            src: artworkSrc,
                            sizes: '512x512',
                            type: getArtworkType(artworkSrc)
                        }
                    ]
                });
            } catch (error) {
                // Ignore metadata failures on constrained browsers/webviews.
            }
        };

        const updateMediaSessionPositionState = () => {
            if (!('mediaSession' in navigator) || typeof navigator.mediaSession.setPositionState !== 'function') return;

            const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : NaN;
            if (!Number.isFinite(duration) || duration <= 0) return;

            const playbackRate = Number.isFinite(audioEl.playbackRate) && audioEl.playbackRate > 0 ? audioEl.playbackRate : 1;
            const position = Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0;

            try {
                navigator.mediaSession.setPositionState({
                    duration,
                    playbackRate,
                    position: Math.min(Math.max(0, position), duration)
                });
            } catch (error) {
                // Ignore unsupported or transient position state updates.
            }
        };

        const setMediaSessionAction = (action, handler) => {
            if (!('mediaSession' in navigator)) return;
            try {
                navigator.mediaSession.setActionHandler(action, handler);
            } catch (error) {
                // Ignore unsupported action handlers.
            }
        };

        let timeUpdateRAF = null;
        audioEl.addEventListener('timeupdate', () => {
            if (isDraggingTrack) return;
            if (timeUpdateRAF) cancelAnimationFrame(timeUpdateRAF);
            
            timeUpdateRAF = requestAnimationFrame(() => {
                const progress = (audioEl.currentTime / audioEl.duration) || 0;
                trackFill.style.transform = `translate3d(${(progress - 1) * 100}%, 0, 0)`;
                
                const newTime = formatAudioTime(audioEl.currentTime);
                if (playerTime.innerText !== newTime) {
                    playerTime.innerText = newTime;
                }
                updateMediaSessionPositionState();
            });
        });

        audioEl.addEventListener('loadedmetadata', () => {
            playerTime.innerText = '0:00';
            trackFill.style.transform = 'translate3d(-100%, 0, 0)';
            updateMediaSessionPositionState();
        });
        audioEl.addEventListener('durationchange', updateMediaSessionPositionState);
        audioEl.addEventListener('ratechange', updateMediaSessionPositionState);
        audioEl.addEventListener('seeked', updateMediaSessionPositionState);

        let audioSourceTrackIndex = -1;
        let audioSourceRequestId = 0;

        audioEl.addEventListener('error', () => {
            if (audioSourceTrackIndex === -1) return;
            const song = lyricsPool[audioSourceTrackIndex];
            console.warn('[vinyl] Audio playback failed.', {
                song: song?.song,
                src: audioEl.currentSrc || audioEl.src
            });
        });

        const cancelVolumeFade = () => {
            if (volumeFadeFrame) {
                cancelAnimationFrame(volumeFadeFrame);
                volumeFadeFrame = null;
            }
        };

        const stopAndFadeOutAudio = async (duration = 800, options = {}) => {
            const { disableControl = true } = options;
            if (audioEl.paused) {
                cancelVolumeFade();
                isAudioPlaying = false;
                setPlayerToggleState(false);
                playerToggleBtn.classList.remove('is-disabled');
                return;
            }

            cancelVolumeFade();
            setPlayerToggleState(false);
            playerToggleBtn.classList.toggle('is-disabled', disableControl);

            return new Promise((resolve) => {
                const finishStop = () => {
                    cancelVolumeFade();
                    isAudioPlaying = false;
                    audioEl.pause();
                    audioEl.playbackRate = 1;
                    if (canSetMediaVolume) audioEl.volume = 1;
                    playerToggleBtn.classList.remove('is-disabled');
                    setPlayerToggleState(false);
                    resolve();
                };

                if (duration <= 0) {
                    finishStop();
                    return;
                }

                const startTime = performance.now();
                const startVolume = Math.max(0, Math.min(1, audioEl.volume));
                const startRate = Number.isFinite(audioEl.playbackRate) ? audioEl.playbackRate : 1;
                const targetRate = canSetMediaVolume ? startRate : Math.max(0.72, startRate * 0.82);

                const frame = (now) => {
                    const progress = Math.min(1, (now - startTime) / duration);
                    const eased = 1 - Math.pow(1 - progress, 3);
                    const ratio = Math.max(0, 1 - eased);

                    if (canSetMediaVolume) {
                        try {
                            audioEl.volume = startVolume * ratio;
                        } catch (error) {
                            // Ignore volume write errors and continue to hard-stop at the end.
                        }
                    } else {
                        audioEl.playbackRate = startRate - (startRate - targetRate) * eased;
                    }

                    if (progress < 1) {
                        volumeFadeFrame = requestAnimationFrame(frame);
                    } else {
                        finishStop();
                    }
                };

                volumeFadeFrame = requestAnimationFrame(frame);
            });
        };

        const getCurrentArmAngle = () => {
            const currentArmAngleStr = getComputedStyle(tonearm).getPropertyValue('--arm-angle');
            const parsed = parseFloat(currentArmAngleStr);
            return Number.isFinite(parsed) ? parsed : ARM_REST_ANGLE;
        };

        const animateTurntableToTargetRate = async ({ targetRate, duration, easing }) => {
            const currentPlaybackRate = spinAnimation.playbackRate || 0;

            if (targetRate > 0) {
                turntable.classList.add('is-playing');
                spinAnimation.play();
                sheenAnimation.play();
            }

            await animateRate({
                from: currentPlaybackRate,
                to: targetRate,
                duration,
                easing
            });

            if (targetRate <= 0 && !isAudioPlaying && !isDrawing && !isTrackSwitching) {
                spinAnimation.pause();
                sheenAnimation.pause();
                turntable.classList.remove('is-playing');
            }
        };

        const toggleAudioState = async (play, options = {}) => {
            const { skipMotion = false, stopDuration = 800 } = options;
            if (play === isAudioPlaying) return;

            isAudioPlaying = play;
            cancelVolumeFade();

            if (play) {
                if (canSetMediaVolume) audioEl.volume = 1;
                playerToggleBtn.classList.remove('is-disabled');
                setPlayerToggleState(true);
                const playAttempt = audioEl.play();
                if (playAttempt && typeof playAttempt.catch === 'function') {
                    playAttempt.catch((e) => {
                        console.log('Audio init pending interaction', e);
                        isAudioPlaying = false;
                        setPlayerToggleState(false);
                        updateMediaSessionPlaybackState();
                        if (!isDrawing && !isTrackSwitching) {
                            turntable.classList.remove('is-playing');
                            spinAnimation.pause();
                            sheenAnimation.pause();
                            spinAnimation.playbackRate = 0;
                            updateSheenByRate(0);
                            setTonearmAngle(ARM_REST_ANGLE);
                        }
                    });
                }

                if (!skipMotion && !isDrawing && !isTrackSwitching) {
                    animateTonearm({
                        from: getCurrentArmAngle(),
                        to: ARM_PLAY_ANGLE,
                        duration: 1200,
                        easing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
                    });
                }
            } else {
                await stopAndFadeOutAudio(stopDuration, { disableControl: false });
                if (!skipMotion && !isDrawing && !isTrackSwitching) {
                    animateTonearm({
                        from: getCurrentArmAngle(),
                        to: ARM_REST_ANGLE,
                        duration: 1200,
                        easing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
                    });
                }
            }
        };

        audioEl.addEventListener('play', () => {
            isAudioPlaying = true;
            playerToggleBtn.classList.remove('is-disabled');
            setPlayerToggleState(true);
            updateMediaSessionPlaybackState();
            updateMediaSessionPositionState();
            if (!isDrawing && !isTrackSwitching) {
                animateTurntableToTargetRate({
                    targetRate: 0.68,
                    duration: 1800,
                    easing: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
                });
            }
        });

        audioEl.addEventListener('pause', () => {
            isAudioPlaying = false;
            setPlayerToggleState(false);
            updateMediaSessionPlaybackState();
            updateMediaSessionPositionState();
            if (!isDrawing && !isTrackSwitching) {
                animateTurntableToTargetRate({
                    targetRate: 0,
                    duration: 2200,
                    easing: (t) => 1 - Math.pow(1 - t, 4)
                });
            }

            if (
                (playbackPlatform.isIOS || playbackPlatform.isWeChat) &&
                document.visibilityState !== 'visible' &&
                audioEl.ended &&
                !isTrackSwitching &&
                currentLyricIndex !== -1
            ) {
                handleTrackEnded();
            }
        });

        audioEl.addEventListener('ended', () => {
            handleTrackEnded();
        });

        playerToggleBtn.addEventListener('click', () => {
            if (isTrackSwitching) return;
            toggleAudioState(!isAudioPlaying);
        });

        let trackDragRect = null;
        const updateAudioTime = (e) => {
            if (!audioEl.duration) return;
            const rect = trackDragRect || trackWrap.getBoundingClientRect();
            let clientX = e.clientX;
            if (e.touches && e.touches.length > 0) {
                clientX = e.touches[0].clientX;
            } else if (e.changedTouches && e.changedTouches.length > 0) {
                clientX = e.changedTouches[0].clientX;
            }
            let percent = (clientX - rect.left) / rect.width;
            percent = Math.max(0, Math.min(1, percent));
            audioEl.currentTime = percent * audioEl.duration;
            trackFill.style.transform = `translate3d(${(percent - 1) * 100}%, 0, 0)`;
            playerTime.innerText = formatAudioTime(audioEl.currentTime);
        };

        trackWrap.addEventListener('mousedown', (e) => {
            isDraggingTrack = true;
            trackDragRect = trackWrap.getBoundingClientRect();
            trackFill.style.transition = 'none';
            updateAudioTime(e);
        });

        window.addEventListener('mousemove', (e) => {
            if (isDraggingTrack) updateAudioTime(e);
        });

        window.addEventListener('mouseup', () => {
            if (isDraggingTrack) {
                isDraggingTrack = false;
                trackDragRect = null;
                trackFill.style.transition = '';
            }
        });

        trackWrap.addEventListener('touchstart', (e) => {
            if (e.cancelable) e.preventDefault();
            isDraggingTrack = true;
            trackDragRect = trackWrap.getBoundingClientRect();
            trackFill.style.transition = 'none';
            updateAudioTime(e);
        }, {passive: false});

        window.addEventListener('touchmove', (e) => {
            if (!isDraggingTrack) return;
            if (e.cancelable) e.preventDefault();
            updateAudioTime(e);
        }, {passive: false});

        window.addEventListener('touchend', () => {
            if (isDraggingTrack) {
                isDraggingTrack = false;
                trackDragRect = null;
                trackFill.style.transition = '';
            }
        });

        window.addEventListener('touchcancel', () => {
            if (isDraggingTrack) {
                isDraggingTrack = false;
                trackDragRect = null;
                trackFill.style.transition = '';
            }
        });

        contactLink.addEventListener('click', () => {
            const wechatId = 'Michael_Yuuu';
            if (navigator.clipboard) {
                navigator.clipboard.writeText(wechatId).then(() => {
                    showToast();
                }).catch(() => {
                    prompt('请手动长按复制我的微信号:', wechatId);
                });
            } else {
                prompt('请手动长按复制我的微信号:', wechatId);
            }
        });

        const showToast = () => {
            copyToast.classList.add('is-visible');
            setTimeout(() => {
                copyToast.classList.remove('is-visible');
            }, 2500);
        };

        const updateButtonText = async (newText) => {
            if (btnTextEl.innerText === newText) return;

            if (prefersReducedMotion) {
                btnTextEl.innerText = newText;
                return;
            }

            const transitionId = ++buttonTextTransitionId;
            const currentText = btnTextEl.innerText;
            const ghostText = document.createElement('span');
            const labelViewport = btnTextEl.parentElement;

            playButton.querySelectorAll('.btn-text-ghost').forEach((node) => node.remove());
            btnTextEl.classList.remove('is-blur-out', 'is-blur-in');
            playButton.classList.remove('is-text-swapping');

            ghostText.className = 'btn-text-ghost is-blur-in';
            ghostText.textContent = newText;
            btnTextEl.innerText = currentText;
            btnTextEl.classList.add('is-blur-out');
            playButton.classList.add('is-text-swapping');
            labelViewport.appendChild(ghostText);

            await wait(420);
            if (transitionId !== buttonTextTransitionId) return;
            btnTextEl.innerText = newText;
            btnTextEl.classList.remove('is-blur-out', 'is-blur-in');
            ghostText.remove();
            playButton.classList.remove('is-text-swapping');
        };

        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

        const preloadImage = (src, timeout = 1400) => new Promise((resolve) => {
            const img = new Image();
            let settled = false;
            const done = () => {
                if (settled) return;
                settled = true;
                resolve();
            };

            const timer = setTimeout(done, timeout);
            img.onload = async () => {
                try {
                    if (typeof img.decode === 'function') {
                        await img.decode();
                    }
                } catch (error) {
                    // decode() may reject for cached/cross-origin images in some WebViews.
                } finally {
                    clearTimeout(timer);
                    done();
                }
            };
            img.onerror = () => {
                clearTimeout(timer);
                done();
            };
            img.src = src;
        });

        const runLoadingSequence = async () => {
            const loadingSources = COVER_ROTATION_FILES.map((name) => `${COVER_BASE_URL}${name}`);
            const preloadTimeout = playbackPlatform.isWeChat ? 900 : 1200;
            let loadingFinished = false;
            const finishLoadingSequence = () => {
                if (loadingFinished) return;
                loadingFinished = true;
                loadingScreen.classList.add('is-exiting');
                appShell.classList.add('is-ready');
            };

            loadingSources.forEach((src) => preloadImage(src, preloadTimeout));

            await wait(prefersReducedMotion ? 120 : 1200);

            const holeLoader = document.getElementById('holeLoader');
            const loadingCopy = document.getElementById('loadingCopy');
            const loadingHeroWrap = document.getElementById('loadingHeroWrap');
            const loadingAmbient = document.getElementById('loadingAmbient');
            const slides = document.querySelectorAll('.loading-slide');
            
            // 隐藏波纹和文字
            if (holeLoader) holeLoader.classList.add('is-hidden');
            if (loadingCopy) loadingCopy.textContent = '信号已接入';
            await wait(prefersReducedMotion ? 0 : 220);

            if (loadingCopy) loadingCopy.classList.add('is-hidden');
            if (loadingHeroWrap) loadingHeroWrap.classList.add('is-loaded');
            if (loadingAmbient) loadingAmbient.classList.add('is-loaded');

            let currentIndex = 0;
            const updateSlide = (dur) => {
                if (slides.length > 0) {
                    slides.forEach((slide, idx) => {
                        if (dur) {
                            const transformDur = Math.max(dur + 780, 1200);
                            slide.style.transition = `opacity ${dur}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), filter ${dur}ms cubic-bezier(0.25, 0.46, 0.45, 0.94), transform ${transformDur}ms cubic-bezier(0.22, 1, 0.36, 1)`;
                        }

                        if (idx === currentIndex) {
                            slide.classList.add('is-active');
                            slide.classList.remove('is-previous');
                        } else if (slide.classList.contains('is-active')) {
                            slide.classList.remove('is-active');
                            slide.classList.add('is-previous');
                        } else {
                            slide.classList.remove('is-active', 'is-previous');
                        }
                    });
                    if (loadingHeroWrap) {
                        loadingHeroWrap.style.setProperty('--hero-bg', `url("${loadingSources[currentIndex]}")`);
                    }
                    if (loadingAmbient) {
                        if (dur) loadingAmbient.style.transitionDuration = `${dur + 180}ms`;
                        loadingAmbient.style.backgroundImage = `url(${loadingSources[currentIndex]})`;
                    }
                }
            };
            
            updateSlide(600); // 初始图
            // 编排切换时间轴：前两张轻快切换，后两张慢溶到最终封面。
            const sequenceSteps = [
                { index: 1, delay: 220, dur: 220 },
                { index: 2, delay: 520, dur: 720 },
                { index: 3, delay: 760, dur: 720 },
                { index: 4, delay: 760, dur: 720 }
            ];

            if (prefersReducedMotion) {
                currentIndex = 4;
                updateSlide(0);
            } else {
                for (const step of sequenceSteps) {
                    await wait(step.delay);
                    currentIndex = step.index;
                    updateSlide(step.dur);
                }
            }

            // 最后一张驻留后淡出
            await wait(prefersReducedMotion ? 80 : 900);
            
            setTimeout(finishLoadingSequence, prefersReducedMotion ? 0 : 320);
        };

        const createShuffledDrawQueue = (avoidIndex = -1) => {
            const indices = lyricsPool.map((_, index) => index);
            for (let i = indices.length - 1; i > 0; i -= 1) {
                const j = Math.floor(Math.random() * (i + 1));
                [indices[i], indices[j]] = [indices[j], indices[i]];
            }

            // drawQueue 使用 pop()，确保新一轮首抽尽量不与当前歌曲重复。
            if (indices.length > 1 && indices[indices.length - 1] === avoidIndex) {
                const swapIndex = Math.floor(Math.random() * (indices.length - 1));
                [indices[indices.length - 1], indices[swapIndex]] = [indices[swapIndex], indices[indices.length - 1]];
            }

            return indices;
        };

        const consumeLyricIndexFromQueue = (index) => {
            if (!Number.isInteger(index) || index < 0) return;
            const queueIndex = drawQueue.indexOf(index);
            if (queueIndex !== -1) {
                drawQueue.splice(queueIndex, 1);
            }
        };

        const pickRandomLyricIndex = (avoidIndex = -1) => {
            if (lyricsPool.length <= 1) return 0;

            if (drawQueue.length === 0) {
                drawQueue = createShuffledDrawQueue(avoidIndex);
            }

            return drawQueue.pop();
        };

        const pickOrderNextLyricIndex = () => {
            if (lyricsPool.length === 0) return -1;
            if (currentLyricIndex < 0 || currentLyricIndex >= lyricsPool.length) return 0;
            return (currentLyricIndex + 1) % lyricsPool.length;
        };

        const pickPreviousLyricIndex = () => {
            if (lyricsPool.length === 0) return -1;

            if (playbackMode === PLAYBACK_MODES.SINGLE_LOOP) {
                return currentLyricIndex >= 0 ? currentLyricIndex : 0;
            }

            if (currentLyricIndex <= 0 || currentLyricIndex >= lyricsPool.length) {
                return lyricsPool.length - 1;
            }

            return currentLyricIndex - 1;
        };

        const updatePlaybackModeUI = () => {
            const modeMeta = PLAYBACK_MODE_META[playbackMode] || PLAYBACK_MODE_META[PLAYBACK_MODES.RANDOM];
            if (modeLabel) {
                modeLabel.innerText = modeMeta.label;
            }
            if (modeIcon) {
                modeIcon.innerHTML = modeMeta.icon;
            }
            if (playlistModeSwitch) {
                const ariaText = `切换播放模式：${modeMeta.label}`;
                playlistModeSwitch.setAttribute('aria-label', ariaText);
                playlistModeSwitch.setAttribute('title', ariaText);
            }
        };

        const setPlaybackMode = (mode) => {
            if (!PLAYBACK_MODE_ORDER.includes(mode)) return;
            playbackMode = mode;
            updatePlaybackModeUI();
        };

        const cyclePlaybackMode = () => {
            const currentIndex = PLAYBACK_MODE_ORDER.indexOf(playbackMode);
            const nextIndex = (currentIndex + 1) % PLAYBACK_MODE_ORDER.length;
            setPlaybackMode(PLAYBACK_MODE_ORDER[nextIndex]);
        };

        const pickNextAutoLyricIndex = () => {
            if (lyricsPool.length === 0) return -1;
            if (lyricsPool.length === 1) return 0;

            if (playbackMode === PLAYBACK_MODES.LIST_LOOP) {
                return pickOrderNextLyricIndex();
            }

            if (playbackMode === PLAYBACK_MODES.SINGLE_LOOP) {
                return currentLyricIndex >= 0 ? currentLyricIndex : 0;
            }

            return pickRandomLyricIndex(currentLyricIndex);
        };

        if (document.readyState === 'complete') {
            runLoadingSequence();
        } else {
            window.addEventListener('load', runLoadingSequence);
        }

        loadingScreen.addEventListener('transitionend', (event) => {
            if (event.target === loadingScreen && event.propertyName === 'opacity') {
                loadingScreen.remove();
            }
        });

        const spinAnimation = safeAnimate(vinyl, [
            { transform: 'translateZ(0) rotate(0deg)' },
            { transform: 'translateZ(0) rotate(360deg)' }
        ], {
            duration: 14000,
            iterations: Infinity,
            easing: 'linear'
        });
        spinAnimation.playbackRate = 0;
        spinAnimation.pause();

        // 极弱反光层：常态低速，提速阶段增强，减速后回归克制。
        const sheenAnimation = safeAnimate(vinylSheen, [
            { transform: 'rotate(0deg)' },
            { transform: 'rotate(360deg)' }
        ], {
            duration: 7000,
            iterations: Infinity,
            easing: 'linear'
        });
        sheenAnimation.playbackRate = 0.16;
        sheenAnimation.pause();

        const updateSheenByRate = (rate) => {
            const clamped = Math.max(0, Math.min(5.2, rate));
            const normalized = clamped / 5.2;
            const opacity = 0.03 + normalized * 0.1;
            const sheenRate = 0.08 + normalized * 1.1;
            vinylSheen.style.opacity = opacity.toFixed(3);
            sheenAnimation.playbackRate = sheenRate;
        };

        const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
        const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

        const createTweenRunner = () => {
            let frameId = null;

            const cancel = () => {
                if (frameId) cancelAnimationFrame(frameId);
                frameId = null;
            };

            const run = ({ from, to, duration, easing, render }) => new Promise((resolve) => {
                cancel();

                if (prefersReducedMotion || duration <= 0 || Math.abs(to - from) < 0.001) {
                    render(to);
                    resolve();
                    return;
                }

                let startTime = null;
                const frame = (now) => {
                    if (!startTime) startTime = now;
                    const progress = Math.min(Math.max((now - startTime) / duration, 0), 1);
                    const current = from + (to - from) * easing(progress);
                    render(current);

                    if (progress < 1) {
                        frameId = requestAnimationFrame(frame);
                        return;
                    }

                    frameId = null;
                    render(to);
                    resolve();
                };

                frameId = requestAnimationFrame(frame);
            });

            return { run, cancel };
        };

        const ARM_REST_ANGLE = -96;
        const ARM_PLAY_ANGLE = -34;

        const setTonearmAngle = (angle) => {
            tonearm.style.setProperty('--arm-angle', `${angle.toFixed(2)}deg`);
        };

        setTonearmAngle(ARM_REST_ANGLE);

        const tonearmTween = createTweenRunner();
        const rateTween = createTweenRunner();

        const animateTonearm = ({ from, to, duration, easing }) => tonearmTween.run({
            from,
            to,
            duration,
            easing,
            render: setTonearmAngle
        });

        const animateRate = ({ from, to, duration, easing }) => rateTween.run({
            from,
            to,
            duration,
            easing,
            render: (rate) => {
                spinAnimation.playbackRate = rate;
                updateSheenByRate(rate);
            }
        });

        const stripLyricPunctuation = (line = '') => String(line)
            .replace(/[\u300a\u300b\u300c\u300d\u300e\u300f\u201c\u201d\u2018\u2019"'.\u3002\uff0c\u3001\uff1b;\uff1a:\uff01\uff1f!?\uff08\uff09()\u3010\u3011\[\]{}<>\u3008\u3009\u2014\u2026\u00b7\u2022]/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        const lyricToLinesHTML = (text) => {
            const lines = text
                .split(/\n|[\uff0c\u3002\uff01\uff1f\uff1b,.!?;\uff1a:]/)
                .map(stripLyricPunctuation)
                .filter(Boolean)
                .slice(0, 6);

            return lines.map((line) => `<span class="lyric-line">${escapeHTML(line)}</span>`).join('');
        };

        const setFloatingButtonsVisible = (visible) => {
            const shouldShow = visible && currentLyricIndex !== -1;
            lyricToggleBtn.classList.toggle('is-visible', shouldShow);
            playlistToggleBtn.classList.toggle('is-visible', shouldShow);
        };

        const setOverlayControlsVisible = (visible) => {
            dynamicIsland.classList.toggle('is-overlay-control-visible', visible);
            if (visible) {
                setFloatingButtonsVisible(false);
            }
        };

        let controlMotionTimer = null;
        const setControlSplit = (split) => {
            const wasSplit = dynamicIsland.classList.contains('is-split');
            if (wasSplit === split) return;

            if (controlMotionTimer) clearTimeout(controlMotionTimer);
            dynamicIsland.classList.remove('is-opening', 'is-collapsing');
            dynamicIsland.classList.toggle('is-split', split);
            dynamicIsland.classList.add(split ? 'is-opening' : 'is-collapsing');

            controlMotionTimer = setTimeout(() => {
                dynamicIsland.classList.remove('is-opening', 'is-collapsing');
                controlMotionTimer = null;
            }, split ? 860 : 700);
        };

        const RELEASE_TYPE_LABELS = {
            album: '专辑',
            single: '单曲',
            live: '现场',
            'live-recording': '演唱会录音',
            'associated-single': '关联单曲',
            pending: '待核对'
        };

        const getReleaseMeta = (release, trackCount) => {
            const typeLabel = RELEASE_TYPE_LABELS[release.type] || release.type || '发行';
            const year = release.releaseDate ? release.releaseDate.slice(0, 4) : '';
            return [typeLabel, year, `${trackCount}首`].filter(Boolean).join(' · ');
        };

        const getPlaylistTrackKey = (releaseTitle, track) => [
            releaseTitle || '',
            Number.isInteger(track?.trackNumber) ? track.trackNumber : '',
            track?.title || stripSongMarks(track?.song || '')
        ].join('\u0000');

        const renderPlaylist = () => {
            const trackIndexByTrack = new Map(lyricsPool.map((track, index) => [
                getPlaylistTrackKey(track.album, track),
                index
            ]));
            playlistList.innerHTML = releases.map((release) => {
                const tracks = Array.isArray(release.tracks) ? release.tracks : [];
                const itemIndexes = [];
                const itemsHTML = tracks.map((item, releaseTrackIndex) => {
                    const itemIndex = trackIndexByTrack.get(getPlaylistTrackKey(release.title, item));
                    if (!item) return '';
                    if (!Number.isInteger(itemIndex)) return '';
                    itemIndexes.push(itemIndex);

                    const activeClass = itemIndex === currentLyricIndex ? ' is-current' : '';
                    const displaySong = stripSongMarks(item.song);
                    const trackNumber = Number.isInteger(item.trackNumber) ? item.trackNumber : releaseTrackIndex + 1;
                    return `<button class="playlist-item${activeClass}" data-index="${itemIndex}" type="button"><span class="playlist-index">${String(trackNumber).padStart(2, '0')}</span><span class="playlist-song">${escapeHTML(displaySong)}</span></button>`;
                }).join('');

                if (!itemsHTML) return '';

                const currentClass = itemIndexes.includes(currentLyricIndex) ? ' is-current-group' : '';
                const releaseTitle = escapeHTML(release.title || '未命名发行');
                const releaseMeta = escapeHTML(getReleaseMeta(release, tracks.length));
                const releaseCover = escapeCSSUrl(getReleaseCoverSrc(release));

                return `<section class="playlist-group${currentClass}" style="--playlist-group-cover: url(&quot;${releaseCover}&quot;)"><div class="playlist-group-header"><span class="playlist-album-title">${releaseTitle}</span><span class="playlist-album-meta">${releaseMeta}</span></div>${itemsHTML}</section>`;
            }).join('');
        };

        // ── 封面驱动的动态主色 + 封面交叉淡入 ──────────────────────────
        const rootStyle = document.documentElement.style;
        const coverLayerA = document.getElementById('vinylCoverA');
        const coverLayerB = document.getElementById('vinylCoverB');

        const DEFAULT_COVER_PALETTE = {
            a: [150, 201, 237],
            b: [190, 204, 235],
            accent: [224, 239, 255],
            deep: [18, 26, 40]
        };

        let activeCoverLayer = coverLayerA;
        let coverSwapRequestId = 0;

        // 预载后再交叉淡入，避免空白闪烁；两层互相淡入淡出
        const preloadCoverImage = (src) => new Promise((resolve) => {
            if (!src) {
                resolve();
                return;
            }

            const pre = new Image();
            pre.onload = () => resolve();
            pre.onerror = () => resolve();
            pre.src = src;
        });

        const setCoverArtworkUrl = (artworkSrc) => {
            rootStyle.setProperty('--cover-art-url', `url("${artworkSrc}")`);
            if (document.body) {
                document.body.style.setProperty('--cover-art-url', `url("${artworkSrc}")`);
            }
        };

        const rgbToCss = (rgb) => `rgb(${rgb.map((value) => Math.round(value)).join(', ')})`;

        const rgbToLuma = (rgb) => {
            const [r, g, b] = rgb;
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };

        const clampRgb = (rgb) => rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))));

        const darkenRgb = (rgb, ratio = 0.38) => clampRgb(rgb.map((value) => value * ratio));

        const normalizePalette = (palette = DEFAULT_COVER_PALETTE) => {
            const a = clampRgb(palette.a || DEFAULT_COVER_PALETTE.a);
            const b = clampRgb(palette.b || DEFAULT_COVER_PALETTE.b);
            const accent = clampRgb(palette.accent || (rgbToLuma(a) > rgbToLuma(b) ? a : b));
            const baseDeep = clampRgb(rgbToLuma(a) < rgbToLuma(b) ? a : b);
            const deep = clampRgb(palette.deep || darkenRgb(baseDeep, rgbToLuma(baseDeep) > 120 ? 0.34 : 0.52));
            return { a, b, accent, deep };
        };

        const getTrackPaletteByIndex = (index) => normalizePalette(getTrackByIndex(index)?.palette || DEFAULT_COVER_PALETTE);

        const colorDistance = (left, right) => Math.hypot(
            left[0] - right[0],
            left[1] - right[1],
            left[2] - right[2]
        );

        const getColorSaturation = (rgb) => {
            const max = Math.max(...rgb);
            const min = Math.min(...rgb);
            return max === 0 ? 0 : (max - min) / max;
        };

        const deriveCoverPaletteFromImage = async (src, fallbackPalette = DEFAULT_COVER_PALETTE) => {
            const safeFallbackPalette = normalizePalette(fallbackPalette);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';

            const loaded = new Promise((resolve, reject) => {
                img.onload = () => resolve(img);
                img.onerror = reject;
            });

            img.src = src;
            await loaded;

            const canvas = document.createElement('canvas');
            canvas.width = 32;
            canvas.height = 32;
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (!ctx) return safeFallbackPalette;

            try {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
                const samples = [];
                const centerX = (canvas.width - 1) / 2;
                const centerY = (canvas.height - 1) / 2;
                const maxCenterDistance = Math.hypot(centerX, centerY);

                for (let i = 0; i < data.length; i += 4) {
                    const alpha = data[i + 3];
                    if (alpha < 180) continue;
                    const rgb = [data[i], data[i + 1], data[i + 2]];
                    const luma = rgbToLuma(rgb);
                    if (luma < 24 || luma > 244) continue;

                    const pixelIndex = i / 4;
                    const x = pixelIndex % canvas.width;
                    const y = Math.floor(pixelIndex / canvas.width);
                    const centerWeight = 1 - Math.min(1, Math.hypot(x - centerX, y - centerY) / maxCenterDistance);
                    const saturation = getColorSaturation(rgb);
                    const score = saturation * 1.25 + centerWeight * 0.65 + (1 - Math.abs(luma - 142) / 142) * 0.48;
                    samples.push({ rgb, luma, saturation, score });
                }

                if (!samples.length) return safeFallbackPalette;
                samples.sort((a, b) => b.score - a.score);

                const accentSample = samples[0] || { rgb: safeFallbackPalette.accent, luma: 180 };
                const companionSample = samples.find((sample) => colorDistance(sample.rgb, accentSample.rgb) > 58)
                    || samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.28))]
                    || accentSample;
                const deepSample = [...samples].sort((a, b) => a.luma - b.luma)[Math.floor(samples.length * 0.16)] || accentSample;

                return normalizePalette({
                    a: accentSample.rgb,
                    b: companionSample.rgb,
                    accent: accentSample.rgb,
                    deep: deepSample.rgb
                });
            } catch (error) {
                return safeFallbackPalette;
            }
        };

        const canSampleCoverPalette = (src = '') => /mzstatic\.com/i.test(src);

        const resolveCoverPalette = async (artworkSrc, fallbackPalette = DEFAULT_COVER_PALETTE) => {
            if (!canSampleCoverPalette(artworkSrc)) {
                return normalizePalette(fallbackPalette);
            }

            try {
                return await deriveCoverPaletteFromImage(artworkSrc, fallbackPalette);
            } catch (error) {
                return normalizePalette(fallbackPalette);
            }
        };

        const setCoverPalette = (palette) => {
            const normalized = normalizePalette(palette);
            rootStyle.setProperty('--cover-a', rgbToCss(normalized.a));
            rootStyle.setProperty('--cover-b', rgbToCss(normalized.b));
            rootStyle.setProperty('--cover-accent', rgbToCss(normalized.accent));
            rootStyle.setProperty('--cover-deep', rgbToCss(normalized.deep));
        };

        const primeCoverVisual = async (index) => {
            const artworkSrc = toInlineCoverProxySrc(getCoverSrcByLyricIndex(index));
            const fallbackPalette = getTrackPaletteByIndex(index);
            const [palette] = await Promise.all([
                resolveCoverPalette(artworkSrc, fallbackPalette),
                preloadCoverImage(artworkSrc)
            ]);
            return { artworkSrc, palette };
        };

        const applyCoverVisual = async (index) => {
            if (!coverLayerA || !coverLayerB) return '';

            const requestId = ++coverSwapRequestId;
            const { artworkSrc, palette } = await primeCoverVisual(index);
            if (requestId !== coverSwapRequestId || !artworkSrc) return artworkSrc;

            const incoming = activeCoverLayer === coverLayerA ? coverLayerB : coverLayerA;
            incoming.style.backgroundImage = `url("${artworkSrc}")`;
            setCoverPalette(palette);
            setCoverArtworkUrl(artworkSrc);
            incoming.classList.add('is-active');
            activeCoverLayer.classList.remove('is-active');
            activeCoverLayer = incoming;
            return artworkSrc;
        };

        const getInitialCoverVisual = () => {
            const initialRelease = releases.find((release) => release.title === '万兽之王演唱会录音') || releases[0];
            const artworkSrc = toInlineCoverProxySrc(getReleaseCoverSrc(initialRelease) || getFallbackCoverSrcByLyricIndex(0));
            return {
                artworkSrc,
                palette: normalizePalette(initialRelease?.palette || DEFAULT_COVER_PALETTE)
            };
        };

        // 抽取前的初始封面：默认「万兽之王演唱会录音」，避免用轮播数组序号导致封面语义漂移。
        if (coverLayerA) {
            const { artworkSrc: initialArtworkSrc, palette: initPal } = getInitialCoverVisual();
            coverLayerA.style.backgroundImage = `url("${initialArtworkSrc}")`;
            coverLayerA.classList.add('is-active');
            setCoverPalette(initPal);
            setCoverArtworkUrl(initialArtworkSrc);
        }

        const updateCurrentLyric = (index) => {
            const result = lyricsPool[index];
            lyricEl.innerHTML = lyricToLinesHTML(result.text);
            songEl.innerText = '—— ' + result.song;
            currentLyricIndex = index;
            void applyCoverVisual(index);
            consumeLyricIndexFromQueue(index);
            updateMediaSessionMetadata(index);
            renderPlaylist();
        };

        const revealLyricContentImmediately = () => {
            lyricEl.style.opacity = '1';
            lyricEl.style.transform = 'translateY(0)';
            songEl.style.opacity = '1';
            songEl.style.transform = 'translateY(0)';

            Array.from(lyricEl.querySelectorAll('.lyric-line')).forEach((line) => {
                line.style.opacity = '1';
                line.style.transform = 'translateY(0)';
                line.style.filter = 'blur(0px)';
            });
        };

        const setAudioSourceByIndex = async (index) => {
            const song = lyricsPool[index];
            audioSourceTrackIndex = index;
            const requestId = ++audioSourceRequestId;
            const playbackSrc = getPlayableMusicSrcByIndex(index);
            if (!playbackSrc) {
                console.warn('[vinyl] Missing playable audio URL.', {
                    song: song.song,
                    musicOssUrl: song.musicOssUrl
                });
                audioEl.removeAttribute('src');
                audioEl.load();
                return;
            }

            if (requestId !== audioSourceRequestId) return;
            audioEl.src = playbackSrc;
            audioEl.load();
        };

        const PLAYLIST_CONTENT_REST_TRANSFORM = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset)))';
        const PLAYLIST_CONTENT_ENTER_START_TRANSFORM = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) + 24px))';

        const switchToTrackWithTransition = async (targetIndex, options = {}) => {
            const { stopDuration = 360 } = options;
            if (isTrackSwitching) return;
            if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= lyricsPool.length) return;

            isTrackSwitching = true;
            document.body.classList.add('is-track-transitioning');
            isDrawing = true;
            setPlayButtonBusy(true);
            setFloatingButtonsVisible(false);

            try {
                const cleanupTasks = [];
                const wasLyricVisible = resultArea.classList.contains('is-visible');
                const wasPlaylistVisible = playlistArea.classList.contains('is-visible');
                const shouldOpenLyricAfterSwitch = wasLyricVisible || wasPlaylistVisible;
                const hadSplitState = dynamicIsland.classList.contains('is-split');

                if (wasLyricVisible) cleanupTasks.push(morphResultOut());
                if (wasPlaylistVisible) cleanupTasks.push(morphPlaylistOut());

                if (cleanupTasks.length) {
                    await Promise.all(cleanupTasks);
                }

                if (wasLyricVisible) resetResultVisual();
                if (wasPlaylistVisible) resetPlaylistVisual();

                const armFrom = getCurrentArmAngle();
                const rateFrom = spinAnimation.playbackRate || 0;
                const bridgeRate = Math.max(1.85, rateFrom + 0.92);

                turntable.classList.add('is-playing');
                spinAnimation.play();
                sheenAnimation.play();

                await Promise.all([
                    animateTonearm({
                        from: armFrom,
                        to: ARM_REST_ANGLE,
                        duration: 760,
                        easing: easeInOutCubic
                    }),
                    animateRate({
                        from: rateFrom,
                        to: bridgeRate,
                        duration: 900,
                        easing: easeInOutSine
                    }),
                    stopAndFadeOutAudio(stopDuration)
                ]);

                await updateCurrentLyric(targetIndex);
                await setAudioSourceByIndex(targetIndex);

                await Promise.all([
                    animateTonearm({
                        from: ARM_REST_ANGLE,
                        to: ARM_PLAY_ANGLE,
                        duration: 980,
                        easing: easeInOutCubic
                    }),
                    animateRate({
                        from: bridgeRate,
                        to: 0.68,
                        duration: 1180,
                        easing: easeOutQuart
                    })
                ]);

                if (shouldOpenLyricAfterSwitch) {
                    animateLyricIn();
                } else {
                    setControlSplit(hadSplitState);
                    setFloatingButtonsVisible(true);
                }
                await toggleAudioState(true, { skipMotion: true });
                await updateButtonText('再次抽取');
            } finally {
                document.body.classList.remove('is-track-transitioning');
                setPlayButtonBusy(false);
                isDrawing = false;
                isTrackSwitching = false;
            }
        };

        const switchToTrackHeadless = async (targetIndex) => {
            if (isTrackSwitching) return;
            if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= lyricsPool.length) return;

            isTrackSwitching = true;
            document.body.classList.add('is-track-transitioning');

            try {
                await updateCurrentLyric(targetIndex);

                if (resultArea.classList.contains('is-visible')) {
                    revealLyricContentImmediately();
                }

                await setAudioSourceByIndex(targetIndex);
                await toggleAudioState(true, { skipMotion: true });

                if (document.visibilityState === 'visible') {
                    setFloatingButtonsVisible(true);
                }

                await updateButtonText('再次抽取');
            } finally {
                document.body.classList.remove('is-track-transitioning');
                isTrackSwitching = false;
            }
        };

        const handleTrackEnded = async () => {
            if (isHandlingTrackEnd || isTrackSwitching || currentLyricIndex === -1) return;

            isHandlingTrackEnd = true;
            isAudioPlaying = false;
            updateMediaSessionPlaybackState();

            try {
                const nextIndex = pickNextAutoLyricIndex();
                if (nextIndex === -1) {
                    await toggleAudioState(false, { skipMotion: true, stopDuration: 0 });
                    return;
                }

                if (shouldUseHeadlessTrackSwitch()) {
                    await switchToTrackHeadless(nextIndex);
                } else {
                    await switchToTrackWithTransition(nextIndex, { stopDuration: 220 });
                }
            } finally {
                isHandlingTrackEnd = false;
            }
        };

        const setupMediaSessionHandlers = () => {
            if (!('mediaSession' in navigator)) return;

            const jumpToIndex = (index) => {
                if (!Number.isInteger(index) || index < 0) return;

                if (shouldUseHeadlessTrackSwitch()) {
                    switchToTrackHeadless(index);
                } else {
                    switchToTrackWithTransition(index, { stopDuration: 220 });
                }
            };

            setMediaSessionAction('play', () => {
                toggleAudioState(true, { skipMotion: shouldUseHeadlessTrackSwitch() });
            });

            setMediaSessionAction('pause', () => {
                const stopDuration = shouldUseHeadlessTrackSwitch() ? 0 : 220;
                toggleAudioState(false, { skipMotion: true, stopDuration });
            });

            setMediaSessionAction('seekto', (details = {}) => {
                if (!Number.isFinite(details.seekTime)) return;
                const duration = Number.isFinite(audioEl.duration) ? audioEl.duration : NaN;
                const nextTime = Number.isFinite(duration) && duration > 0
                    ? Math.min(Math.max(0, details.seekTime), duration)
                    : Math.max(0, details.seekTime);

                try {
                    if (details.fastSeek && typeof audioEl.fastSeek === 'function') {
                        audioEl.fastSeek(nextTime);
                    } else {
                        audioEl.currentTime = nextTime;
                    }
                    updateMediaSessionPositionState();
                } catch (error) {
                    // Ignore seek failures on constrained browsers.
                }
            });

            setMediaSessionAction('nexttrack', () => {
                if (currentLyricIndex === -1) return;
                const nextIndex = pickNextAutoLyricIndex();
                jumpToIndex(nextIndex);
            });

            setMediaSessionAction('previoustrack', () => {
                if (currentLyricIndex === -1) return;
                const previousIndex = pickPreviousLyricIndex();
                jumpToIndex(previousIndex);
            });

            setMediaSessionAction('stop', () => {
                toggleAudioState(false, { skipMotion: true, stopDuration: 0 });
            });
        };

        renderPlaylist();
        updatePlaybackModeUI();
        setupMediaSessionHandlers();

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState !== 'visible' || currentLyricIndex === -1) return;

            if (resultArea.classList.contains('is-visible')) {
                revealLyricContentImmediately();
                return;
            }

            if (!playlistArea.classList.contains('is-visible')) {
                setFloatingButtonsVisible(true);
            }
        });

        const resetResultVisual = () => {
            lyricAnimations.forEach((anim) => anim.cancel());
            lyricAnimations = [];
            resultArea.classList.remove('is-visible');
            resultArea.classList.remove('show-dismiss-hint');
            document.body.classList.remove('has-lyric-overlay');
            setOverlayControlsVisible(false);
            resultArea.style.opacity = '0';
            resultArea.style.transform = 'none';
            lyricCloseBtn.style.opacity = '';
            lyricCloseBtn.style.transform = '';
            lyricCloseBtn.style.filter = '';
            lyricEl.style.opacity = '0';
            lyricEl.style.transform = 'translateY(20px)';
            lyricEl.style.filter = '';
            songEl.style.opacity = '0';
            songEl.style.transform = 'translateY(20px)';
            songEl.style.filter = '';
            // player-pill 现在在外部独立管理显示。
        };

        const resetPlaylistVisual = () => {
            playlistAnimations.forEach((anim) => anim.cancel());
            playlistAnimations = [];
            playlistArea.classList.remove('is-visible');
            playlistArea.classList.remove('show-dismiss-hint');
            document.body.classList.remove('has-playlist-overlay');
            setOverlayControlsVisible(false);
            playlistArea.style.opacity = '0';
            playlistArea.style.transform = 'none';
            playlistCloseBtn.style.opacity = '';
            playlistCloseBtn.style.transform = '';
            playlistCloseBtn.style.filter = '';
            playlistContent.style.opacity = '0';
            playlistContent.style.transform = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) + 20px))';
            playlistContent.style.filter = '';
        };

        const animateLyricIn = () => {
            resultArea.classList.add('is-visible');
            document.body.classList.add('has-lyric-overlay');
            if (!hasShownDismissHint) {
                resultArea.classList.add('show-dismiss-hint');
                hasShownDismissHint = true;
            }
            setControlSplit(true);
            setOverlayControlsVisible(true);

            const cardAnim = safeAnimate(resultArea, [
                { opacity: 0, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: 560,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            const lyricAnim = safeAnimate(lyricEl, [
                { opacity: 0, transform: 'translateY(16px) scale(0.995)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' }
            ], {
                duration: 740,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            const songAnim = safeAnimate(songEl, [
                { opacity: 0, transform: 'translateY(12px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: 660,
                delay: 150,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            const lineAnimations = Array.from(lyricEl.querySelectorAll('.lyric-line')).map((line, index) => safeAnimate(line, [
                { opacity: 0, transform: 'translateY(14px) scale(0.99)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' }
            ], {
                duration: 660,
                delay: 100 + index * 66,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            }));

            lyricAnimations = [cardAnim, lyricAnim, songAnim, ...lineAnimations];
        };

        const animatePlaylistIn = () => {
            playlistArea.classList.add('is-visible');
            document.body.classList.add('has-playlist-overlay');
            if (!hasShownPlaylistHint) {
                playlistArea.classList.add('show-dismiss-hint');
                hasShownPlaylistHint = true;
            }
            setControlSplit(true);
            setOverlayControlsVisible(false);

            const cardAnim = safeAnimate(playlistArea, [
                { opacity: 0, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: 560,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            const contentAnim = safeAnimate(playlistContent, [
                { opacity: 0, transform: PLAYLIST_CONTENT_ENTER_START_TRANSFORM },
                { opacity: 1, transform: PLAYLIST_CONTENT_REST_TRANSFORM }
            ], {
                duration: 680,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            const itemAnimations = Array.from(playlistList.querySelectorAll('.playlist-item')).map((item, index) => safeAnimate(item, [
                { opacity: 0, transform: 'translateY(7px) scale(0.992)' },
                { opacity: 1, transform: 'translateY(0) scale(1)' }
            ], {
                duration: 430,
                delay: Math.min(150, index * 16),
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            }));

            playlistAnimations = [cardAnim, contentAnim, ...itemAnimations];
        };

        const morphResultOut = () => {
            lyricAnimations.forEach((anim) => anim.cancel());
            lyricAnimations = [];

            const fadeOutAnimation = safeAnimate(resultArea, [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: 'translateY(-8px)' }
            ], {
                duration: 360,
                fill: 'forwards',
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });

            const closeAnim = safeAnimate(lyricCloseBtn, [
                { opacity: 1, transform: 'translateZ(0) scale(1)' },
                { opacity: 0, transform: 'translate3d(8px, -8px, 0) scale(0.94)' }
            ], {
                duration: 240,
                fill: 'forwards',
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });

            const contentAnim = safeAnimate(lyricEl, [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: 'translateY(-8px)' }
            ], {
                duration: 280,
                fill: 'forwards',
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });

            const songAnim = safeAnimate(songEl, [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: 'translateY(-6px)' }
            ], {
                duration: 260,
                fill: 'forwards',
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });

            lyricAnimations = [fadeOutAnimation, closeAnim, contentAnim, songAnim];

            return fadeOutAnimation.finished || Promise.resolve();
        };

        const morphPlaylistOut = () => {
            playlistAnimations.forEach((anim) => anim.cancel());
            playlistAnimations = [];

            const fadeOutAnimation = safeAnimate(playlistArea, [
                { opacity: 1, transform: 'translateY(0)' },
                { opacity: 0, transform: 'translateY(-8px)' }
            ], {
                duration: 360,
                fill: 'forwards',
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });

            const closeAnim = safeAnimate(playlistCloseBtn, [
                { opacity: 1, transform: 'translateZ(0) scale(1)' },
                { opacity: 0, transform: 'translate3d(8px, -8px, 0) scale(0.94)' }
            ], {
                duration: 240,
                fill: 'forwards',
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });

            const contentAnim = safeAnimate(playlistContent, [
                { opacity: 1, transform: PLAYLIST_CONTENT_REST_TRANSFORM },
                { opacity: 0, transform: 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) - 10px))' }
            ], {
                duration: 300,
                fill: 'forwards',
                easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
            });

            playlistAnimations = [fadeOutAnimation, closeAnim, contentAnim];

            return fadeOutAnimation.finished || Promise.resolve();
        };

        const closeLyricOverlay = async () => {
            if (isOverlayClosing || !resultArea.classList.contains('is-visible')) return;

            const ownsInteractionLock = !isDrawing;
            isOverlayClosing = true;
            if (ownsInteractionLock) {
                isDrawing = true;
                setPlayButtonBusy(true);
            }

            try {
                const textUpdatePromise = updateButtonText('再次抽取');
                await morphResultOut();
                resetResultVisual();
                await textUpdatePromise;
                setFloatingButtonsVisible(true);
            } finally {
                if (ownsInteractionLock) {
                    setPlayButtonBusy(false);
                    isDrawing = false;
                }
                isOverlayClosing = false;
            }
        };

        const closePlaylistOverlay = async () => {
            if (isOverlayClosing || !playlistArea.classList.contains('is-visible')) return;

            const ownsInteractionLock = !isDrawing;
            isOverlayClosing = true;
            if (ownsInteractionLock) {
                isDrawing = true;
                setPlayButtonBusy(true);
            }

            try {
                await morphPlaylistOut();
                resetPlaylistVisual();
                setFloatingButtonsVisible(true);
            } finally {
                if (ownsInteractionLock) {
                    setPlayButtonBusy(false);
                    isDrawing = false;
                }
                isOverlayClosing = false;
            }
        };

        resultArea.addEventListener('click', async (event) => {
            if (!resultArea.classList.contains('is-visible')) return;
            if (event.target !== resultArea && event.target !== lyricDismissHint) return;

            await closeLyricOverlay();
        });

        playlistArea.addEventListener('click', async (event) => {
            if (!playlistArea.classList.contains('is-visible')) return;
            if (event.target !== playlistArea && event.target !== playlistDismissHint) return;

            await closePlaylistOverlay();
        });

        lyricCloseBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            await closeLyricOverlay();
        });

        playlistCloseBtn.addEventListener('click', async (event) => {
            event.stopPropagation();
            await closePlaylistOverlay();
        });

        document.addEventListener('keydown', async (event) => {
            if (event.key !== 'Escape') return;
            if (playlistArea.classList.contains('is-visible')) {
                await closePlaylistOverlay();
                return;
            }
            if (resultArea.classList.contains('is-visible')) {
                await closeLyricOverlay();
            }
        });

        lyricToggleBtn.addEventListener('click', () => {
            if (isDrawing || currentLyricIndex === -1) return;
            setFloatingButtonsVisible(false);
            animateLyricIn();
        });

        playlistToggleBtn.addEventListener('click', () => {
            if (isDrawing || currentLyricIndex === -1) return;
            setFloatingButtonsVisible(false);
            renderPlaylist();
            animatePlaylistIn();
        });

        if (playlistModeSwitch) {
            playlistModeSwitch.addEventListener('click', () => {
                cyclePlaybackMode();
            });
        }

        playlistList.addEventListener('click', async (event) => {
            const playlistItem = event.target.closest('.playlist-item');
            if (!playlistItem || isDrawing || isTrackSwitching) return;

            const nextIndex = Number(playlistItem.dataset.index);
            if (!Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= lyricsPool.length) return;

            await switchToTrackWithTransition(nextIndex, { stopDuration: 320 });
        });

        playButton.addEventListener('click', async () => {
            if (isDrawing) return;
            isDrawing = true;
            setPlayButtonBusy(true);

            const shouldDelayLoadingText = dynamicIsland.classList.contains('is-split');
            setFloatingButtonsVisible(false);
            setControlSplit(false);

            const textUpdateDelay = shouldDelayLoadingText && !prefersReducedMotion ? 260 : 0;
            const textUpdatePromise = wait(textUpdateDelay).then(() => updateButtonText('读取中'));

            let initialArmAngle = ARM_REST_ANGLE;
            let initialRate = 0;
            
            const cleanupTasks = [];

            if (resultArea.classList.contains('is-visible')) {
                cleanupTasks.push(morphResultOut());
            }

            if (playlistArea.classList.contains('is-visible')) {
                cleanupTasks.push(morphPlaylistOut());
            }

            if (isAudioPlaying) {
                cleanupTasks.push(stopAndFadeOutAudio(500));
            }

            await Promise.all(cleanupTasks);

            // 无论上一步干了什么，抽卡启步的状态必须与前一毫秒屏幕上真实呈现的数值无缝对接，不能使用之前存好的死数据，否则导致割裂与突兀
            initialRate = spinAnimation.playbackRate || 0;
            const currentArmAngleStr = getComputedStyle(tonearm).getPropertyValue('--arm-angle');
            initialArmAngle = parseFloat(currentArmAngleStr) || ARM_REST_ANGLE;

            resetResultVisual();
            resetPlaylistVisual();
            turntable.classList.add('is-playing');

            // 保证 play() 瞬间的关联数值严格等于 initialRate，避免光效跳变。
            updateSheenByRate(initialRate);
            spinAnimation.playbackRate = initialRate;

            spinAnimation.play();
            sheenAnimation.play();

            // 点击即加速到最高。
            const maxRate = 5.2;

            await Promise.all([
                textUpdatePromise,
                animateTonearm({
                    from: initialArmAngle,
                    to: ARM_REST_ANGLE, 
                    duration: 1100,
                    easing: easeInOutCubic
                }),
                animateRate({
                    from: initialRate,
                    to: maxRate,
                    duration: 1400,
                    easing: easeInOutSine
                })
            ]);

            await wait(prefersReducedMotion ? 0 : 1200);

            const randomIndex = pickRandomLyricIndex(currentLyricIndex);
            await updateCurrentLyric(randomIndex);

            await toggleAudioState(false, { skipMotion: true, stopDuration: 260 });
            await setAudioSourceByIndex(randomIndex);
            
            // 错开显示歌词和按钮的变形时机
            await Promise.all([
                animateTonearm({
                    from: ARM_REST_ANGLE,
                    to: ARM_PLAY_ANGLE, 
                    duration: 1820,
                    easing: easeInOutCubic
                }),
                animateRate({
                    from: maxRate,
                    to: 0.68,
                    duration: 1820,
                    easing: easeInOutCubic
                })
            ]);

            // 唱针停止后再出现歌词层。
            animateLyricIn();
            await toggleAudioState(true, { skipMotion: true });

            // 让文字在歌词展开时再变，避免时间上同步过于机械。
            await wait(prefersReducedMotion ? 0 : 180);
            await updateButtonText('再次抽取');

            if (!isAudioPlaying) {
                await Promise.all([
                    animateTonearm({
                        from: ARM_PLAY_ANGLE,
                        to: ARM_REST_ANGLE,
                        duration: 760,
                        easing: easeInOutCubic
                    }),
                    animateTurntableToTargetRate({
                        targetRate: 0,
                        duration: 980,
                        easing: easeOutQuart
                    })
                ]);
            }
            setPlayButtonBusy(false);
            isDrawing = false;
        });
