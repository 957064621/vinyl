import {
    COVER_BASE_URL,
    COVER_ROTATION_FILES,
    lyricTextByTitle,
    releases,
    lyricsPool
} from './data.js';
import { renderLyricLinesHTML } from './lyrics/format.js';
import { startCriticalAssetGate } from './app/bootstrap.js';
import { ossImageDerivative } from './config/assets.js';
import {
    createPlaylist,
    createPlaylistSelectionGuard,
    getPlaylistContextScrollTop,
    getPlaylistViewportItems
} from './ui/playlist.js';
import { createAudioController } from './player/audio-controller.js';
import {
    animateWithCleanup,
    createMotionController,
    detectMotionProfile,
    tweenWithCleanup
} from './motion/motion-controller.js';
import { createAppTransitions } from './app/transitions.js';
import { createArchiveMetadata } from './ui/archive-metadata.js';
import { createControlParticleDissolver } from './ui/control-particle-dissolver.js';

const motionProfile = detectMotionProfile();
const controlParticleDissolver = createControlParticleDissolver({
    documentRef: document,
    windowRef: window,
    profile: motionProfile
});
const criticalAssetGate = startCriticalAssetGate({
    motionProfile
});

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
        const playerPill = document.getElementById('playerPill');
        const playerToggleBtn = document.getElementById('playerToggleBtn');
        const trackWrap = document.getElementById('trackWrap');
        const trackFill = document.getElementById('trackFill');
        const playerTime = document.getElementById('playerTime');
        const audioStatus = document.getElementById('audioStatus');
        const audioStatusText = document.getElementById('audioStatusText');
        const audioRetry = document.getElementById('audioRetry');
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
        let lyricAnimations = [];
        let playlistAnimations = [];
        let hasShownDismissHint = false;
        let hasShownPlaylistHint = false;
        let canSetMediaVolume = true;
        let currentLyricIndex = -1;
        let failedTrackTargetIndex = null;
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
        audioEl.setAttribute('webkit-playsinline', '');
        let isAudioPlaying = false;
        let volumeFadeFrame = null;
        let cancelActiveVolumeFade = null;
        let isSeeking = false;
        let timeUpdateRAF = null;
        let suppressPlaybackMotion = false;
        let directPlaybackCommandEpoch = 0;
        let isTrackSwitching = false;
        let isHandlingTrackEnd = false;

        const setPlayButtonBusy = (busy) => {
            playButton.disabled = false;
            playButton.toggleAttribute('data-busy', busy);
            playButton.setAttribute('aria-disabled', busy ? 'true' : 'false');
        };

        setPlayButtonBusy(false);

        let archiveStatusOverride = null;
        const writeArchiveMetadata = createArchiveMetadata({
            documentRef: document,
            tracks: lyricsPool
        });
        const updateArchiveMetadata = (index, audioStatus) => (
            writeArchiveMetadata(index, archiveStatusOverride ?? audioStatus)
        );

        updateArchiveMetadata(-1, 'idle');

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
        const reducedMotionQuery = window.matchMedia
            ? window.matchMedia('(prefers-reduced-motion: reduce)')
            : null;
        const drawButtonPointerQuery = window.matchMedia
            ? window.matchMedia('(hover: hover) and (pointer: fine)')
            : null;
        let prefersReducedMotion = Boolean(reducedMotionQuery?.matches);
        const isCoarsePointer = window.matchMedia && window.matchMedia('(hover: none) and (pointer: coarse)').matches;
        const shouldUseCompactOverlayMotion = playbackPlatform.isIOS || isCoarsePointer;
        const shouldUseCompactPlaylistMotion = playbackPlatform.isIOS || isCoarsePointer;
        const shouldUseLeanPlaylistMotion = () => prefersReducedMotion;
        const overlayCardDuration = shouldUseCompactOverlayMotion ? 900 : 620;
        const overlayLyricDuration = shouldUseCompactOverlayMotion ? 1120 : 840;
        const playlistContentDuration = shouldUseCompactOverlayMotion ? 980 : 680;
        const playlistItemDuration = shouldUseCompactOverlayMotion ? 620 : 430;

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

        const pointerMotionEnabled = () => (
            matchMedia('(hover: hover) and (pointer: fine)').matches && !prefersReducedMotion
        );
        const motionFiltersEnabled = () => !prefersReducedMotion;

        const pointerLight = document.createElement('div');
        pointerLight.className = 'pointer-light';
        pointerLight.setAttribute('aria-hidden', 'true');
        document.body.append(pointerLight);

        let pointerLightFrame = null;
        let pointerLightTarget = null;
        let pointerLightCurrent = null;
        const hidePointerLight = () => {
            pointerLightTarget = null;
            pointerLightCurrent = null;
            if (pointerLightFrame !== null) cancelAnimationFrame(pointerLightFrame);
            pointerLightFrame = null;
            pointerLight.classList.remove('is-visible');
        };
        const renderPointerLight = () => {
            pointerLightFrame = null;
            if (!pointerLightTarget || !pointerMotionEnabled() || document.visibilityState !== 'visible') {
                hidePointerLight();
                return;
            }

            const { x, y } = pointerLightTarget;
            if (!pointerLightCurrent) pointerLightCurrent = { x, y };
            pointerLightCurrent.x += (x - pointerLightCurrent.x) * 0.2;
            pointerLightCurrent.y += (y - pointerLightCurrent.y) * 0.2;
            pointerLight.style.setProperty('--pointer-x', `${pointerLightCurrent.x.toFixed(2)}px`);
            pointerLight.style.setProperty('--pointer-y', `${pointerLightCurrent.y.toFixed(2)}px`);
            pointerLight.classList.add('is-visible');

            if (
                Math.abs(x - pointerLightCurrent.x) > 0.08
                || Math.abs(y - pointerLightCurrent.y) > 0.08
            ) {
                pointerLightFrame = requestAnimationFrame(renderPointerLight);
            }
        };
        const queuePointerLight = (event) => {
            if (event.pointerType && event.pointerType !== 'mouse') return;
            if (!pointerMotionEnabled()) {
                hidePointerLight();
                return;
            }

            pointerLightTarget = { x: event.clientX, y: event.clientY };
            if (pointerLightFrame === null) pointerLightFrame = requestAnimationFrame(renderPointerLight);
        };

        const DRAW_BUTTON_SPOT_DEFAULT_X = 35;
        const DRAW_BUTTON_SPOT_DEFAULT_Y = 0;
        const DRAW_BUTTON_SPOT_EASE = 0.22;
        const DRAW_BUTTON_SPOT_FADE_EASE = 0.16;
        const DRAW_BUTTON_SPOT_STOP_THRESHOLD = 0.06;
        const DRAW_BUTTON_SPOT_FADE_STOP_THRESHOLD = 0.004;
        let drawButtonSpotFrame = null;
        let drawButtonSpotPhase = 'idle';
        let drawButtonSpotCurrentX = DRAW_BUTTON_SPOT_DEFAULT_X;
        let drawButtonSpotCurrentY = DRAW_BUTTON_SPOT_DEFAULT_Y;
        let drawButtonSpotTargetX = DRAW_BUTTON_SPOT_DEFAULT_X;
        let drawButtonSpotTargetY = DRAW_BUTTON_SPOT_DEFAULT_Y;
        let drawButtonSpotCurrentStrength = 0;
        let drawButtonSpotTargetStrength = 0;

        const canUseDrawButtonSpotlight = () => (
            Boolean(drawButtonPointerQuery?.matches)
            && !prefersReducedMotion
            && !playButton.hasAttribute('data-busy')
            && document.documentElement.dataset.motionProfile === 'full'
            && document.visibilityState === 'visible'
        );

        const resetDrawButtonSpotlight = () => {
            drawButtonSpotPhase = 'idle';
            drawButtonSpotCurrentX = DRAW_BUTTON_SPOT_DEFAULT_X;
            drawButtonSpotCurrentY = DRAW_BUTTON_SPOT_DEFAULT_Y;
            drawButtonSpotTargetX = DRAW_BUTTON_SPOT_DEFAULT_X;
            drawButtonSpotTargetY = DRAW_BUTTON_SPOT_DEFAULT_Y;
            drawButtonSpotCurrentStrength = 0;
            drawButtonSpotTargetStrength = 0;
            if (drawButtonSpotFrame !== null) cancelAnimationFrame(drawButtonSpotFrame);
            drawButtonSpotFrame = null;
            playButton.style.removeProperty('--btn-spot-x');
            playButton.style.removeProperty('--btn-spot-y');
            playButton.style.removeProperty('--btn-spot-strength');
        };

        const writeDrawButtonSpotlight = () => {
            playButton.style.setProperty('--btn-spot-x', `${drawButtonSpotCurrentX.toFixed(2)}%`);
            playButton.style.setProperty('--btn-spot-y', `${drawButtonSpotCurrentY.toFixed(2)}%`);
            playButton.style.setProperty('--btn-spot-strength', `${(drawButtonSpotCurrentStrength * 100).toFixed(2)}%`);
        };

        const renderDrawButtonSpotlight = () => {
            drawButtonSpotFrame = null;
            if (drawButtonSpotPhase === 'idle' || !canUseDrawButtonSpotlight()) {
                resetDrawButtonSpotlight();
                return;
            }

            drawButtonSpotCurrentX += (drawButtonSpotTargetX - drawButtonSpotCurrentX) * DRAW_BUTTON_SPOT_EASE;
            drawButtonSpotCurrentY += (drawButtonSpotTargetY - drawButtonSpotCurrentY) * DRAW_BUTTON_SPOT_EASE;
            drawButtonSpotCurrentStrength += (
                drawButtonSpotTargetStrength - drawButtonSpotCurrentStrength
            ) * DRAW_BUTTON_SPOT_FADE_EASE;
            const remainingX = Math.abs(drawButtonSpotTargetX - drawButtonSpotCurrentX);
            const remainingY = Math.abs(drawButtonSpotTargetY - drawButtonSpotCurrentY);
            const remainingStrength = Math.abs(drawButtonSpotTargetStrength - drawButtonSpotCurrentStrength);

            if (Math.max(remainingX, remainingY) <= DRAW_BUTTON_SPOT_STOP_THRESHOLD) {
                drawButtonSpotCurrentX = drawButtonSpotTargetX;
                drawButtonSpotCurrentY = drawButtonSpotTargetY;
            }
            if (remainingStrength <= DRAW_BUTTON_SPOT_FADE_STOP_THRESHOLD) {
                drawButtonSpotCurrentStrength = drawButtonSpotTargetStrength;
            }

            writeDrawButtonSpotlight();

            if (
                Math.max(remainingX, remainingY) > DRAW_BUTTON_SPOT_STOP_THRESHOLD
                || remainingStrength > DRAW_BUTTON_SPOT_FADE_STOP_THRESHOLD
            ) {
                drawButtonSpotFrame = requestAnimationFrame(renderDrawButtonSpotlight);
                return;
            }

            if (drawButtonSpotPhase === 'leaving') resetDrawButtonSpotlight();
        };

        const queueDrawButtonSpotlight = (event) => {
            if ((event.pointerType && event.pointerType !== 'mouse') || !canUseDrawButtonSpotlight()) {
                resetDrawButtonSpotlight();
                return;
            }

            const rect = playButton.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            if (drawButtonSpotPhase === 'idle') writeDrawButtonSpotlight();
            drawButtonSpotPhase = 'tracking';
            drawButtonSpotTargetX = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
            drawButtonSpotTargetY = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
            drawButtonSpotTargetStrength = 1;
            if (drawButtonSpotFrame === null) {
                drawButtonSpotFrame = requestAnimationFrame(renderDrawButtonSpotlight);
            }
        };

        const releaseDrawButtonSpotlight = () => {
            if (drawButtonSpotPhase === 'idle') return;
            drawButtonSpotPhase = 'leaving';
            drawButtonSpotTargetX = DRAW_BUTTON_SPOT_DEFAULT_X;
            drawButtonSpotTargetY = DRAW_BUTTON_SPOT_DEFAULT_Y;
            drawButtonSpotTargetStrength = 0;
            if (drawButtonSpotFrame === null) {
                drawButtonSpotFrame = requestAnimationFrame(renderDrawButtonSpotlight);
            }
        };

        const releasePointerEffects = () => {
            hidePointerLight();
            releaseDrawButtonSpotlight();
        };

        const resetPointerEffects = () => {
            hidePointerLight();
            resetDrawButtonSpotlight();
        };

        document.addEventListener('pointermove', queuePointerLight, { passive: true });
        document.addEventListener('pointerleave', releasePointerEffects);
        window.addEventListener('blur', resetPointerEffects);
        playButton.addEventListener('pointerenter', queueDrawButtonSpotlight, { passive: true });
        playButton.addEventListener('pointermove', queueDrawButtonSpotlight, { passive: true });
        playButton.addEventListener('pointerleave', releaseDrawButtonSpotlight);
        playButton.addEventListener('pointercancel', resetDrawButtonSpotlight);
        const syncDrawButtonPointerCapability = () => {
            if (!canUseDrawButtonSpotlight()) resetDrawButtonSpotlight();
        };
        if (typeof drawButtonPointerQuery?.addEventListener === 'function') {
            drawButtonPointerQuery.addEventListener('change', syncDrawButtonPointerCapability);
        } else {
            drawButtonPointerQuery?.addListener?.(syncDrawButtonPointerCapability);
        }
        const normalizeMotionKeyframes = (keyframes) => {
            if (motionFiltersEnabled() || !Array.isArray(keyframes)) return keyframes;

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
                        duration: Math.min(Math.max(0, Number(options?.duration) || 0), 180),
                        delay: Math.min(Math.max(0, Number(options?.delay) || 0), 40),
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

        const getTrackByIndex = (index) => {
            if (!Number.isInteger(index) || index < 0 || index >= lyricsPool.length) return null;
            return lyricsPool[index];
        };

        const getFallbackCoverSrcByLyricIndex = (index) => {
            const normalizedIndex = Number.isInteger(index) ? Math.abs(index) : 0;
            const coverFile = COVER_ROTATION_FILES[normalizedIndex % COVER_ROTATION_FILES.length];
            return `${COVER_BASE_URL}${coverFile}`;
        };

        const getCoverSrcByLyricIndex = (index) => {
            const track = getTrackByIndex(index);
            if (track) return track.coverOssUrl || track.sourceArtworkUrl || '';
            return getFallbackCoverSrcByLyricIndex(index);
        };

        const toInlineCoverProxySrc = (src = '') => src;

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

        const cancelVolumeFade = () => {
            if (volumeFadeFrame) {
                cancelAnimationFrame(volumeFadeFrame);
                volumeFadeFrame = null;
            }
            cancelActiveVolumeFade?.();
            cancelActiveVolumeFade = null;
        };

        const stopAndFadeOutAudio = async (duration = 420, options = {}) => {
            const { disableControl = true, isCurrent = () => true } = options;
            if (audioEl.paused) {
                if (!isCurrent()) return;
                cancelVolumeFade();
                audioController.pause();
                setPlayerToggleState(false);
                playerToggleBtn.classList.remove('is-disabled');
                return;
            }

            cancelVolumeFade();
            setPlayerToggleState(false);
            playerToggleBtn.classList.toggle('is-disabled', disableControl);

            return new Promise((resolve) => {
                let settled = false;
                const cleanup = () => {
                    if (volumeFadeFrame) {
                        cancelAnimationFrame(volumeFadeFrame);
                        volumeFadeFrame = null;
                    }
                    if (cancelActiveVolumeFade === cancel) cancelActiveVolumeFade = null;
                };
                const finishStop = () => {
                    if (settled) return;
                    if (!isCurrent()) {
                        cancel();
                        return;
                    }
                    settled = true;
                    cleanup();
                    audioController.pause();
                    audioEl.playbackRate = 1;
                    if (canSetMediaVolume) audioEl.volume = 1;
                    playerToggleBtn.classList.remove('is-disabled');
                    setPlayerToggleState(false);
                    resolve();
                };
                const cancel = () => {
                    if (settled) return;
                    settled = true;
                    cleanup();
                    resolve();
                };
                cancelActiveVolumeFade = cancel;

                if (duration <= 0) {
                    finishStop();
                    return;
                }

                const startTime = performance.now();
                const startVolume = Math.max(0, Math.min(1, audioEl.volume));
                const startRate = Number.isFinite(audioEl.playbackRate) ? audioEl.playbackRate : 1;
                const targetRate = canSetMediaVolume ? startRate : Math.max(0.72, startRate * 0.82);

                const frame = (now) => {
                    if (!isCurrent()) {
                        cancel();
                        return;
                    }
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
                if (!prefersReducedMotion) {
                    spinAnimation.play();
                    sheenAnimation.play();
                }
            }

            const result = await animateRate({
                from: currentPlaybackRate,
                to: targetRate,
                duration,
                easing
            });

            if (result.status !== 'completed') return result;

            if (targetRate <= 0 && !isAudioPlaying && !isDrawing && !isTrackSwitching) {
                spinAnimation.pause();
                sheenAnimation.pause();
                turntable.classList.remove('is-playing');
            }
            return result;
        };

        const cancelTurntableMotion = () => {
            tonearmTween.cancel();
            rateTween.cancel();
            cancelVolumeFade();
        };

        const resetRejectedPlaybackVisual = () => {
            cancelTurntableMotion();
            isAudioPlaying = false;
            turntable.classList.remove('is-playing');
            spinAnimation.pause();
            sheenAnimation.pause();
            spinAnimation.playbackRate = 0;
            updateSheenByRate(0);
            setTonearmAngle(ARM_REST_ANGLE);
            playerToggleBtn.classList.remove('is-disabled');
            setPlayerToggleState(false);
        };

        const renderAudioState = ({ status, error }) => {
            const failed = status === 'error';
            audioStatus.hidden = !failed;
            audioStatusText.textContent = failed
                ? `音频加载失败：${error?.message || '未知错误'}`
                : '';
            audioRetry.disabled = status === 'loading';
            dynamicIsland.setAttribute('aria-busy', String(status === 'loading'));
            document.body.dataset.audioState = status;
            updateArchiveMetadata(currentLyricIndex, status);

            if (status === 'playing') {
                const wasPlaying = isAudioPlaying;
                isAudioPlaying = true;
                playerToggleBtn.classList.remove('is-disabled');
                setPlayerToggleState(true);
                if (!wasPlaying && !suppressPlaybackMotion && !isDrawing && !isTrackSwitching) {
                    void animateTurntableToTargetRate({
                        targetRate: 0.68,
                        duration: 1800,
                        easing: (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
                    });
                    void animateTonearm({
                        from: getCurrentArmAngle(),
                        to: ARM_PLAY_ANGLE,
                        duration: 1200,
                        easing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
                    });
                }
                return;
            }

            if (status !== 'paused' && status !== 'ready' && status !== 'error') return;
            isAudioPlaying = false;
            setPlayerToggleState(false);

            if (failed) {
                resetRejectedPlaybackVisual();
                return;
            }
            if (!suppressPlaybackMotion && !isDrawing && !isTrackSwitching) {
                void animateTurntableToTargetRate({
                    targetRate: 0,
                    duration: 1080,
                    easing: (t) => 1 - Math.pow(1 - t, 4)
                });
                void animateTonearm({
                    from: getCurrentArmAngle(),
                    to: ARM_REST_ANGLE,
                    duration: 760,
                    easing: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
                });
            }

            if (
                status === 'paused' &&
                (playbackPlatform.isIOS || playbackPlatform.isWeChat) &&
                document.visibilityState !== 'visible' &&
                audioEl.ended &&
                !isTrackSwitching &&
                currentLyricIndex !== -1
            ) {
                void handleTrackEnded();
            }
        };

        const audioController = createAudioController({
            audio: audioEl,
            MediaMetadataCtor: null,
            onStateChange: renderAudioState,
            onEnded: () => { void handleTrackEnded(); },
            onTimeUpdate: ({ currentTime, duration }) => {
                if (isSeeking || !Number.isFinite(duration) || duration <= 0) return;
                if (timeUpdateRAF) cancelAnimationFrame(timeUpdateRAF);
                timeUpdateRAF = requestAnimationFrame(() => {
                    const progress = Math.max(0, Math.min(1, currentTime / duration));
                    trackFill.style.transform = `translate3d(${(progress - 1) * 100}%, 0, 0)`;
                    const newTime = formatAudioTime(currentTime);
                    if (playerTime.innerText !== newTime) playerTime.innerText = newTime;
                });
            }
        });

        const toggleAudioState = async (play, options = {}) => {
            const {
                skipMotion = false,
                stopDuration = 420,
                retry = false,
                isCurrent = () => true
            } = options;
            const controllerStatus = audioController.getState().status;

            if (play && controllerStatus === 'playing') {
                if (!isCurrent()) return false;
                cancelVolumeFade();
                audioEl.playbackRate = 1;
                if (canSetMediaVolume) audioEl.volume = 1;
                playerToggleBtn.classList.remove('is-disabled');
                setPlayerToggleState(true);
                return true;
            }
            if (!play && !['loading', 'playing'].includes(controllerStatus)) {
                if (!isCurrent()) return false;
                resetRejectedPlaybackVisual();
                return true;
            }

            if (!isCurrent()) return false;
            cancelVolumeFade();
            suppressPlaybackMotion = skipMotion;

            try {
                if (play) {
                    if (canSetMediaVolume) audioEl.volume = 1;
                    playerToggleBtn.classList.remove('is-disabled');
                    try {
                        const played = await (retry ? audioController.retry() : audioController.play());
                        if (!isCurrent()) return false;
                        if (!played) resetRejectedPlaybackVisual();
                        return played;
                    } catch (error) {
                        if (!isCurrent()) return false;
                        audioController.pause();
                        resetRejectedPlaybackVisual();
                        console.warn('[vinyl] Audio playback failed.', {
                            song: audioController.getState().track?.title,
                            message: error.message
                        });
                        return false;
                    }
                }

                if (controllerStatus === 'loading') {
                    if (!isCurrent()) return false;
                    audioController.pause();
                    resetRejectedPlaybackVisual();
                    return true;
                }

                await stopAndFadeOutAudio(stopDuration, { disableControl: false, isCurrent });
                if (!isCurrent()) return false;
                if (skipMotion) resetRejectedPlaybackVisual();
                return true;
            } finally {
                if (isCurrent()) suppressPlaybackMotion = false;
            }
        };

        playerToggleBtn.addEventListener('click', () => {
            const { status } = audioController.getState();
            const shouldPlay = status === 'playing'
                ? !playerToggleBtn.classList.contains('is-playing')
                : status !== 'loading';
            void runDirectPlaybackCommand(
                'player toggle',
                (isCurrent) => toggleAudioState(shouldPlay, { isCurrent })
            );
        });

        const seekFromPointer = (event) => {
            const rect = trackWrap.getBoundingClientRect();
            const fraction = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
            audioController.seekToFraction(fraction);
            const progress = Math.max(0, Math.min(1, fraction));
            trackFill.style.transform = `translate3d(${(progress - 1) * 100}%, 0, 0)`;
            playerTime.innerText = formatAudioTime(audioEl.currentTime);
        };

        trackWrap.addEventListener('pointerdown', (event) => {
            isSeeking = true;
            trackFill.style.transition = 'none';
            trackWrap.setPointerCapture(event.pointerId);
            seekFromPointer(event);
        });
        trackWrap.addEventListener('pointermove', (event) => {
            if (isSeeking) seekFromPointer(event);
        });
        trackWrap.addEventListener('pointerup', (event) => {
            isSeeking = false;
            trackFill.style.transition = '';
            if (trackWrap.hasPointerCapture(event.pointerId)) {
                trackWrap.releasePointerCapture(event.pointerId);
            }
        });
        trackWrap.addEventListener('pointercancel', () => {
            isSeeking = false;
            trackFill.style.transition = '';
        });

        audioRetry.addEventListener('click', async () => {
            audioRetry.disabled = true;
            try {
                if (Number.isInteger(failedTrackTargetIndex)) {
                    const retryIndex = failedTrackTargetIndex;
                    cancelTurntableMotion();
                    await runMotionCommand(() => motion.draw(retryIndex));
                } else {
                    await runDirectPlaybackCommand(
                        'audio retry',
                        (isCurrent) => toggleAudioState(true, { retry: true, isCurrent })
                    );
                }
            } catch {
                // The controller republishes the recoverable error for the status command.
            } finally {
                audioRetry.disabled = false;
            }
        });

        let copyToastTimer = null;
        const showToast = (message, { manual = false, duration = manual ? 5200 : 2500 } = {}) => {
            if (copyToastTimer !== null) clearTimeout(copyToastTimer);
            copyToast.textContent = message;
            copyToast.classList.toggle('is-manual', manual);
            copyToast.removeAttribute('aria-hidden');
            copyToast.classList.add('is-visible');
            copyToastTimer = setTimeout(() => {
                copyToast.classList.remove('is-visible');
                copyToast.classList.remove('is-manual');
                copyToast.setAttribute('aria-hidden', 'true');
                copyToastTimer = null;
            }, duration);
        };

        const copyTextWithSelection = (text) => {
            if (typeof document.execCommand !== 'function') return false;

            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.readOnly = true;
            textarea.setAttribute('aria-hidden', 'true');
            Object.assign(textarea.style, {
                position: 'fixed',
                inset: '0 auto auto -9999px',
                width: '1px',
                height: '1px',
                opacity: '0',
                fontSize: '16px'
            });
            document.body.append(textarea);
            textarea.select();
            textarea.setSelectionRange(0, text.length);

            let copied = false;
            try {
                copied = document.execCommand('copy') === true;
            } catch {
                copied = false;
            } finally {
                textarea.remove();
            }
            return copied;
        };

        const copyWechatId = async () => {
            const wechatId = 'Michael_Yuuu';
            let copied = false;

            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(wechatId);
                    copied = true;
                }
            } catch {
                copied = false;
            }

            if (!copied) copied = copyTextWithSelection(wechatId);
            if (copied) {
                showToast(`微信号 ${wechatId} 已复制`);
                return;
            }

            showToast(`请长按复制：${wechatId}`, { manual: true });
        };

        contactLink.addEventListener('click', () => {
            void copyWechatId();
        });

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

        const createPersistentAnimation = (element, keyframes, options) => {
            if (canUseWebAnimations && typeof element.animate === 'function') {
                return element.animate(normalizeMotionKeyframes(keyframes), options);
            }
            applyFinalKeyframe(element, keyframes);
            return createNoopAnimation();
        };

        const spinAnimation = createPersistentAnimation(vinyl, [
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
        const sheenAnimation = createPersistentAnimation(vinylSheen, [
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
            const sheenRate = clamped === 0 ? 0 : 0.08 + normalized * 1.1;
            vinylSheen.style.opacity = prefersReducedMotion ? '0' : opacity.toFixed(3);
            sheenAnimation.playbackRate = sheenRate;
        };

        const easeInOutCubic = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
        const easeInOutSine = t => -(Math.cos(Math.PI * t) - 1) / 2;
        const easeOutQuart = t => 1 - Math.pow(1 - t, 4);

        const createTweenRunner = () => {
            let activeController = null;

            const cancel = (reason = 'superseded') => {
                activeController?.abort(reason);
            };

            const run = ({ from, to, duration, easing, render, signal }) => {
                cancel();
                const controller = new AbortController();
                activeController = controller;
                const abortFromParent = () => controller.abort(signal.reason);
                signal?.addEventListener('abort', abortFromParent, { once: true });

                if (signal?.aborted) abortFromParent();

                return tweenWithCleanup({
                    from,
                    to,
                    duration: prefersReducedMotion || Math.abs(to - from) < 0.001 ? 0 : duration,
                    easing,
                    render,
                    signal: controller.signal
                }).finally(() => {
                    signal?.removeEventListener('abort', abortFromParent);
                    if (activeController === controller) activeController = null;
                });
            };

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

        const animateTonearm = ({ from, to, duration, easing, signal }) => tonearmTween.run({
            from,
            to,
            duration,
            easing,
            render: setTonearmAngle,
            signal
        });

        const animateRate = ({ from, to, duration, easing, signal }) => rateTween.run({
            from,
            to,
            duration,
            easing,
            render: (rate) => {
                spinAnimation.playbackRate = rate;
                updateSheenByRate(rate);
            },
            signal
        });

        const setInteractiveState = (element, interactive) => {
            element.toggleAttribute('inert', !interactive);
            if (interactive) element.removeAttribute('aria-hidden');
            else element.setAttribute('aria-hidden', 'true');
        };

        const setFloatingButtonsVisible = (visible) => {
            const shouldShow = visible && currentLyricIndex !== -1;
            [lyricToggleBtn, playlistToggleBtn].forEach((button) => {
                button.classList.toggle('is-visible', shouldShow);
                button.tabIndex = shouldShow ? 0 : -1;
                if (shouldShow) button.removeAttribute('aria-hidden');
                else button.setAttribute('aria-hidden', 'true');
            });
        };
        setFloatingButtonsVisible(false);

        const setOverlayControlsVisible = (visible) => {
            dynamicIsland.classList.toggle('is-overlay-control-visible', visible);
            if (visible) {
                setFloatingButtonsVisible(false);
                return;
            }

            setFloatingButtonsVisible(false);
        };

        let controlMotionTimer = null;
        const setControlSplit = (split) => {
            const wasSplit = dynamicIsland.classList.contains('is-split');
            setInteractiveState(playerPill, split);
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
        setControlSplit(false);

        const scrollPlaylistToCurrentContext = (behavior = 'smooth') => {
            if (!playlistList || currentLyricIndex === -1) return;

            const currentItem = playlistList.querySelector(`.playlist-item[data-index="${currentLyricIndex}"]`);
            if (!currentItem) return;

            const scrollBehavior = shouldUseCompactPlaylistMotion || shouldUseLeanPlaylistMotion() ? 'auto' : behavior;
            const contextTop = getPlaylistContextScrollTop(playlistList, currentItem);

            // Assign directly for non-animated opens so WebKit cannot defer
            // the initial position until after the first visible frame.
            if (scrollBehavior === 'auto') {
                playlistList.scrollTop = contextTop;
                return;
            }

            playlistList.scrollTo({ top: contextTop, behavior: scrollBehavior });
        };

        // ── 封面驱动的动态主色 + 径向揭示 ───────────────────────────
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
        let activeCoverReveal = Promise.resolve();
        const COVER_PRELOAD_TIMEOUT_MS = 4000;
        const COVER_REVEAL_DURATION = Object.freeze({
            full: 1080,
            compact: 1160,
            reduce: 0
        });
        const COVER_DEPTH_EASING = Object.freeze({
            approach: 'cubic-bezier(0.32, 0, 0.18, 1)',
            handoff: 'cubic-bezier(0.65, 0, 0.35, 1)',
            settle: 'cubic-bezier(0.22, 0.61, 0.36, 1)'
        });

        const waitForActiveCoverReveal = ({ signal } = {}) => {
            if (signal?.aborted) return Promise.resolve();
            return new Promise((resolve) => {
                let settled = false;
                const finish = () => {
                    if (settled) return;
                    settled = true;
                    signal?.removeEventListener('abort', finish);
                    resolve();
                };
                signal?.addEventListener('abort', finish, { once: true });
                activeCoverReveal.then(finish, finish);
            });
        };

        // 预载后再交叉淡入，避免空白闪烁；两层互相淡入淡出
        const loadCoverImage = (
            image,
            src,
            timeoutMs = COVER_PRELOAD_TIMEOUT_MS,
            signal
        ) => new Promise((resolve) => {
            if (!src) {
                resolve(false);
                return;
            }

            let settled = false;
            let timer = null;
            const finish = (loaded) => {
                if (settled) return;
                settled = true;
                if (timer !== null) clearTimeout(timer);
                signal?.removeEventListener('abort', onAbort);
                image.onload = null;
                image.onerror = null;
                resolve(loaded);
            };
            const onAbort = () => finish(false);

            image.onload = () => finish(true);
            image.onerror = () => finish(false);
            timer = setTimeout(() => finish(false), timeoutMs);
            signal?.addEventListener('abort', onAbort, { once: true });
            if (signal?.aborted) {
                finish(false);
                return;
            }
            image.src = src;
        });

        const preloadCoverImage = (src, signal) => loadCoverImage(
            new Image(),
            src,
            COVER_PRELOAD_TIMEOUT_MS,
            signal
        );

        const setCoverArtworkUrl = (artworkSrc) => {
            const artworkValue = artworkSrc ? `url("${artworkSrc}")` : 'none';
            rootStyle.setProperty('--cover-art-url', artworkValue);
            if (document.body) {
                document.body.style.setProperty('--cover-art-url', artworkValue);
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

        const deriveCoverPaletteFromImage = async (
            src,
            fallbackPalette = DEFAULT_COVER_PALETTE,
            signal
        ) => {
            const safeFallbackPalette = normalizePalette(fallbackPalette);
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.decoding = 'async';
            img.referrerPolicy = 'no-referrer';

            const loaded = await loadCoverImage(img, src, COVER_PRELOAD_TIMEOUT_MS, signal);
            if (!loaded) return safeFallbackPalette;

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

        const resolveCoverPalette = async (
            artworkSrc,
            fallbackPalette = DEFAULT_COVER_PALETTE,
            signal
        ) => {
            if (!canSampleCoverPalette(artworkSrc)) {
                return normalizePalette(fallbackPalette);
            }

            try {
                return await deriveCoverPaletteFromImage(artworkSrc, fallbackPalette, signal);
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

        const primeCoverVisual = async (index, { signal } = {}) => {
            const artworkSrc = toInlineCoverProxySrc(getCoverSrcByLyricIndex(index));
            const fallbackPalette = getTrackPaletteByIndex(index);
            const [palette] = await Promise.all([
                resolveCoverPalette(artworkSrc, fallbackPalette, signal),
                preloadCoverImage(artworkSrc, signal)
            ]);
            if (signal?.aborted) {
                throw signal.reason || new DOMException('Aborted', 'AbortError');
            }
            return { artworkSrc, palette };
        };

        const clearCoverRevealStyles = (layer) => {
            if (!layer) return;
            layer.style.removeProperty('clip-path');
            layer.style.removeProperty('opacity');
            layer.style.removeProperty('transform');
            layer.style.removeProperty('filter');
            layer.style.removeProperty('z-index');
            layer.style.removeProperty('will-change');
        };

        let handoffResidentResizeFrame = null;
        const syncLoadingHandoffResident = () => {
            handoffResidentResizeFrame = null;
            const layer = document.getElementById('loadingHandoffResident');
            const image = layer?.querySelector('.loading-handoff-resident-image');
            const sticker = document.querySelector('.vinyl-sticker');
            if (!layer || !image || !sticker || layer.hasAttribute('data-motion-active')) return;

            const targetRect = sticker.getBoundingClientRect();
            const sourceCenterX = Number(layer.dataset.sourceCenterX);
            const sourceCenterY = Number(layer.dataset.sourceCenterY);
            const handoffSquare = Number(layer.dataset.handoffSquare);
            if (
                targetRect.width <= 0
                || targetRect.height <= 0
                || !Number.isFinite(sourceCenterX)
                || !Number.isFinite(sourceCenterY)
                || !Number.isFinite(handoffSquare)
                || handoffSquare <= 0
            ) return;

            const centerX = targetRect.left + (targetRect.width / 2);
            const centerY = targetRect.top + (targetRect.height / 2);
            const radius = Math.min(targetRect.width, targetRect.height) / 2;
            const scale = (radius * 2) / handoffSquare;
            layer.dataset.centerX = String(centerX);
            layer.dataset.centerY = String(centerY);
            layer.dataset.radius = String(radius);
            layer.style.setProperty('--handoff-center-x', `${centerX}px`);
            layer.style.setProperty('--handoff-center-y', `${centerY}px`);
            layer.style.setProperty('--handoff-radius', `${radius}px`);
            layer.style.setProperty('--handoff-diameter', `${radius * 2}px`);
            layer.style.clipPath = `circle(${radius}px at ${centerX}px ${centerY}px)`;
            image.style.transform = `translate3d(${centerX - sourceCenterX}px, ${centerY - sourceCenterY}px, 0) scale(${scale})`;
        };
        const scheduleLoadingHandoffResidentSync = () => {
            if (handoffResidentResizeFrame !== null) return;
            handoffResidentResizeFrame = requestAnimationFrame(syncLoadingHandoffResident);
        };
        window.addEventListener('resize', scheduleLoadingHandoffResidentSync, { passive: true });

        const releaseLoadingHandoffResident = (duration, signal) => {
            const layer = document.getElementById('loadingHandoffResident');
            if (!layer) return Promise.resolve({ status: 'none' });

            const sticker = document.querySelector('.vinyl-sticker');
            const transferDuration = Math.min(duration, 560);
            const clearRingTransfer = () => {
                if (!sticker) return;
                delete sticker.dataset.ringTransition;
                sticker.style.removeProperty('--vinyl-ring-transfer-ms');
            };

            const initialClipPath = layer.style.clipPath
                || `circle(${layer.dataset.radius || 0}px at ${layer.dataset.centerX || 0}px ${layer.dataset.centerY || 0}px)`;
            const centerX = layer.dataset.centerX || '0';
            const centerY = layer.dataset.centerY || '0';
            const finalClipPath = `circle(0px at ${centerX}px ${centerY}px)`;
            const removeLayer = () => {
                layer.remove();
                if (!document.getElementById('loadingHandoffResident')) {
                    delete document.body?.dataset.loadingHandoffResident;
                }
                clearRingTransfer();
            };

            if (prefersReducedMotion || duration <= 0) {
                removeLayer();
                return Promise.resolve({ status: 'completed' });
            }

            layer.dataset.ringState = 'releasing';
            layer.style.opacity = '1';
            if (sticker) {
                sticker.style.setProperty('--vinyl-ring-transfer-ms', `${transferDuration}ms`);
                sticker.dataset.ringTransition = 'receiving';
            }
            const release = animateWithCleanup(
                layer,
                [
                    { opacity: 1, clipPath: initialClipPath },
                    { opacity: 0, clipPath: finalClipPath }
                ],
                {
                    duration: Math.min(duration, 560),
                    fill: 'forwards',
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                },
                signal,
                safeAnimate
            );

            return release.then((result) => {
                if (result.status === 'completed') {
                    removeLayer();
                } else {
                    clearRingTransfer();
                    layer.dataset.ringState = 'entering';
                    layer.style.opacity = '1';
                    layer.style.clipPath = initialClipPath;
                }
                return result;
            });
        };

        const applyPreparedCoverVisual = async (preparedVisual, { profile = motionProfile, signal } = {}) => {
            if (!coverLayerA || !coverLayerB) return '';

            const { artworkSrc, palette } = preparedVisual;
            const requestId = ++coverSwapRequestId;
            setCoverPalette(palette);
            setCoverArtworkUrl(artworkSrc);
            if (!artworkSrc) {
                [coverLayerA, coverLayerB].forEach((layer) => {
                    layer.getAnimations?.().forEach((animation) => animation.cancel());
                    layer.classList.remove('is-active');
                    layer.style.backgroundImage = '';
                    clearCoverRevealStyles(layer);
                });
                activeCoverLayer = coverLayerA;
                document.body.dataset.coverState = 'neutral';
                return '';
            }

            const outgoing = activeCoverLayer;
            const incoming = activeCoverLayer === coverLayerA ? coverLayerB : coverLayerA;
            outgoing.getAnimations?.().forEach((animation) => animation.cancel());
            incoming.getAnimations?.().forEach((animation) => animation.cancel());
            delete incoming.dataset.loadingHandoff;
            delete incoming.dataset.loadingPrewarm;
            incoming.style.backgroundImage = `url("${artworkSrc}")`;
            incoming.style.opacity = '0';
            incoming.style.zIndex = '1';
            incoming.style.transform = 'scale(1.048) rotate(-0.62deg)';
            incoming.style.filter = 'blur(12px) saturate(0.76) brightness(0.84)';
            incoming.style.willChange = 'opacity, filter, transform';
            outgoing.style.opacity = '1';
            outgoing.style.transform = 'scale(1) rotate(0deg)';
            outgoing.style.filter = 'blur(0px) saturate(1) brightness(1)';
            outgoing.style.zIndex = '0';
            outgoing.style.willChange = 'opacity, filter, transform';
            delete document.body.dataset.coverState;
            incoming.classList.remove('is-active');
            outgoing.classList.add('is-active');

            const duration = COVER_REVEAL_DURATION[profile] ?? COVER_REVEAL_DURATION.full;
            const revealSignal = signal || new AbortController().signal;
            const residentRelease = releaseLoadingHandoffResident(duration, revealSignal);
            const animationOptions = {
                duration,
                fill: 'forwards',
                easing: 'linear'
            };
            const [incomingResult, outgoingResult, residentResult] = await Promise.all([
                animateWithCleanup(
                    incoming,
                    [
                        {
                            offset: 0,
                            opacity: 0,
                            transform: 'scale(1.048) rotate(-0.62deg)',
                            filter: 'blur(12px) saturate(0.76) brightness(0.84)',
                            easing: COVER_DEPTH_EASING.approach
                        },
                        {
                            offset: 0.22,
                            opacity: 0.03,
                            transform: 'scale(1.042) rotate(-0.48deg)',
                            filter: 'blur(10.5px) saturate(0.8) brightness(0.87)',
                            easing: COVER_DEPTH_EASING.handoff
                        },
                        {
                            offset: 0.48,
                            opacity: 0.38,
                            transform: 'scale(1.025) rotate(-0.24deg)',
                            filter: 'blur(5.8px) saturate(0.9) brightness(0.94)',
                            easing: COVER_DEPTH_EASING.handoff
                        },
                        {
                            offset: 0.68,
                            opacity: 0.76,
                            transform: 'scale(1.009) rotate(-0.08deg)',
                            filter: 'blur(2.4px) saturate(0.97) brightness(0.985)',
                            easing: COVER_DEPTH_EASING.handoff
                        },
                        {
                            offset: 0.84,
                            opacity: 0.96,
                            transform: 'scale(1.002) rotate(-0.01deg)',
                            filter: 'blur(0.6px) saturate(0.995) brightness(1)',
                            easing: COVER_DEPTH_EASING.settle
                        },
                        {
                            offset: 1,
                            opacity: 1,
                            transform: 'scale(1) rotate(0deg)',
                            filter: 'blur(0px) saturate(1) brightness(1)'
                        }
                    ],
                    animationOptions,
                    revealSignal,
                    safeAnimate
                ),
                animateWithCleanup(
                    outgoing,
                    [
                        {
                            offset: 0,
                            opacity: 1,
                            transform: 'scale(1) rotate(0deg)',
                            filter: 'blur(0px) saturate(1) brightness(1)',
                            easing: COVER_DEPTH_EASING.approach
                        },
                        {
                            offset: 0.22,
                            opacity: 0.97,
                            transform: 'scale(1) rotate(0deg)',
                            filter: 'blur(0.25px) saturate(0.99) brightness(0.99)',
                            easing: COVER_DEPTH_EASING.handoff
                        },
                        {
                            offset: 0.48,
                            opacity: 0.68,
                            transform: 'scale(0.993) rotate(0.04deg)',
                            filter: 'blur(2.2px) saturate(0.91) brightness(0.92)',
                            easing: COVER_DEPTH_EASING.handoff
                        },
                        {
                            offset: 0.68,
                            opacity: 0.28,
                            transform: 'scale(0.982) rotate(0.14deg)',
                            filter: 'blur(5.6px) saturate(0.8) brightness(0.78)',
                            easing: COVER_DEPTH_EASING.handoff
                        },
                        {
                            offset: 0.84,
                            opacity: 0.04,
                            transform: 'scale(0.974) rotate(0.22deg)',
                            filter: 'blur(8px) saturate(0.73) brightness(0.71)',
                            easing: COVER_DEPTH_EASING.settle
                        },
                        {
                            offset: 1,
                            opacity: 0,
                            transform: 'scale(0.971) rotate(0.24deg)',
                            filter: 'blur(9px) saturate(0.7) brightness(0.68)'
                        }
                    ],
                    animationOptions,
                    revealSignal,
                    safeAnimate
                ),
                residentRelease
            ]);

            if (
                requestId !== coverSwapRequestId
                || incomingResult.status !== 'completed'
                || outgoingResult.status !== 'completed'
                || (residentResult.status !== 'completed' && residentResult.status !== 'none')
            ) return artworkSrc;

            outgoing.classList.remove('is-active');
            incoming.classList.add('is-active');
            activeCoverLayer = incoming;
            clearCoverRevealStyles(outgoing);
            clearCoverRevealStyles(incoming);
            return artworkSrc;
        };

        const getInitialCoverPalette = () => {
            const initialRelease = releases.find((release) => release.title === '万兽之王演唱会录音') || releases[0];
            return normalizePalette(initialRelease?.palette || DEFAULT_COVER_PALETTE);
        };

        // 抽取前只使用初始发行的配色，封面网络请求由首次实际选曲触发。
        setCoverPalette(getInitialCoverPalette());

        const lyricLines = () => Array.from(lyricEl.querySelectorAll('.lyric-line'));
        const LYRIC_FEATHER_MASK = 'linear-gradient(to bottom, #000 0%, #000 33%, rgba(0, 0, 0, 0.96) 35%, rgba(0, 0, 0, 0.68) 39%, rgba(0, 0, 0, 0.3) 44%, transparent 50%, transparent 100%)';
        const createLyricRevealKeyframes = () => ([
            {
                opacity: 0.08,
                transform: 'translateY(22px) scaleX(0.94) scaleY(1.035)',
                filter: 'blur(14px)',
                maskPosition: '0% 70%',
                webkitMaskPosition: '0% 70%'
            },
            {
                offset: 0.38,
                opacity: 0.68,
                transform: 'translateY(9px) scaleX(0.975) scaleY(1.014)',
                filter: 'blur(6px)',
                maskPosition: '0% 46%',
                webkitMaskPosition: '0% 46%'
            },
            {
                offset: 0.76,
                opacity: 0.96,
                transform: 'translateY(2px) scaleX(0.997) scaleY(1.002)',
                filter: 'blur(1.2px)',
                maskPosition: '0% 14%',
                webkitMaskPosition: '0% 14%'
            },
            {
                opacity: 1,
                transform: 'translateY(0) scale(1)',
                filter: 'blur(0px)',
                maskPosition: '0% 0%',
                webkitMaskPosition: '0% 0%'
            }
        ]);
        const createSongRevealKeyframes = () => ([
            {
                opacity: 0,
                transform: 'translateY(14px) scaleX(0.965) scaleY(1.022)',
                filter: 'blur(10px)',
                maskPosition: '0% 70%',
                webkitMaskPosition: '0% 70%'
            },
            {
                offset: 0.72,
                opacity: 0.84,
                transform: 'translateY(2px) scaleX(0.995) scaleY(1.003)',
                filter: 'blur(1.4px)',
                maskPosition: '0% 14%',
                webkitMaskPosition: '0% 14%'
            },
            {
                opacity: 1,
                transform: 'translateY(0) scale(1)',
                filter: 'blur(0px)',
                maskPosition: '0% 0%',
                webkitMaskPosition: '0% 0%'
            }
        ]);
        const applyLyricFeather = (element) => {
            element.style.setProperty('-webkit-mask-image', LYRIC_FEATHER_MASK);
            element.style.setProperty('mask-image', LYRIC_FEATHER_MASK);
            element.style.setProperty('-webkit-mask-repeat', 'no-repeat');
            element.style.setProperty('mask-repeat', 'no-repeat');
            element.style.setProperty('-webkit-mask-size', '100% 300%');
            element.style.setProperty('mask-size', '100% 300%');
            element.style.setProperty('-webkit-mask-position', '0% 70%');
            element.style.setProperty('mask-position', '0% 70%');
        };
        const clearLyricFeather = (element) => {
            element.style.removeProperty('-webkit-mask-image');
            element.style.removeProperty('mask-image');
            element.style.removeProperty('-webkit-mask-repeat');
            element.style.removeProperty('mask-repeat');
            element.style.removeProperty('-webkit-mask-size');
            element.style.removeProperty('mask-size');
            element.style.removeProperty('-webkit-mask-position');
            element.style.removeProperty('mask-position');
        };

        const clearLyricMotionResidue = ({ clearLines = false } = {}) => {
            resultArea.style.removeProperty('clip-path');
            lyricEl.style.removeProperty('clip-path');
            clearLyricFeather(lyricEl);
            if (!clearLines) return;
            lyricLines().forEach((line) => {
                line.style.removeProperty('opacity');
                line.style.removeProperty('transform');
                line.style.removeProperty('filter');
                line.style.removeProperty('clip-path');
                clearLyricFeather(line);
            });
            clearLyricFeather(songEl);
        };

        const revealLyricContentImmediately = () => {
            clearLyricMotionResidue();
            lyricEl.style.opacity = '1';
            lyricEl.style.transform = 'translateY(0)';
            lyricEl.style.filter = 'blur(0px)';
            clearLyricFeather(lyricEl);
            songEl.style.opacity = '1';
            songEl.style.transform = 'translateY(0)';
            songEl.style.filter = 'blur(0px)';
            clearLyricFeather(songEl);

            lyricLines().forEach((line) => {
                line.style.opacity = '1';
                line.style.transform = 'translateY(0)';
                line.style.filter = 'blur(0px)';
                line.style.clipPath = '';
                clearLyricFeather(line);
            });
        };

        const syncEditableLyrics = (nextLyrics = lyricTextByTitle) => {
            for (const track of lyricsPool) {
                const nextText = nextLyrics?.[track.title];
                if (typeof nextText !== 'string' || nextText.length === 0) continue;
                track.text = nextText;
                track.needsLyric = false;
            }

            if (currentLyricIndex < 0) return;
            const currentTrack = lyricsPool[currentLyricIndex];
            lyricEl.innerHTML = renderLyricLinesHTML(currentTrack.text);
            if (resultArea.classList.contains('is-visible')) {
                revealLyricContentImmediately();
            }
        };

        window.addEventListener('vinyl:lyrics-updated', (event) => {
            syncEditableLyrics(event.detail);
        });

        const createAudioTrackByIndex = (index) => {
            const song = lyricsPool[index];
            if (!song) throw new RangeError(`Unknown track index: ${index}`);
            const artworkSrc = toInlineCoverProxySrc(getCoverSrcByLyricIndex(index));

            return {
                ...song,
                title: stripSongMarks(song.song),
                musicOssUrl: song.musicOssUrl,
                artwork: artworkSrc ? [{
                    src: artworkSrc,
                    sizes: '512x512',
                    type: getArtworkType(artworkSrc)
                }] : []
            };
        };

        const setMediaSessionMetadata = (metadata) => {
            if (!navigator.mediaSession) return;
            try {
                navigator.mediaSession.metadata = metadata;
            } catch {
                // Media Session support is partial across browsers and embedded webviews.
            }
        };

        const createMediaSessionMetadata = (track) => {
            if (typeof globalThis.MediaMetadata !== 'function') return null;
            try {
                return new globalThis.MediaMetadata({
                    title: track.title,
                    artist: track.artist || '薛之谦',
                    album: track.album,
                    artwork: track.artwork
                });
            } catch {
                return null;
            }
        };

        const COVER_STYLE_PROPERTIES = [
            '--cover-a',
            '--cover-b',
            '--cover-accent',
            '--cover-deep',
            '--cover-art-url'
        ];
        let trackTransactionSequence = 0;
        let activeTrackTransaction = null;

        const readInlineProperties = (element, properties) => Object.fromEntries(
            properties.map((property) => [property, element.style.getPropertyValue(property)])
        );

        const restoreInlineProperties = (element, properties) => {
            Object.entries(properties).forEach(([property, value]) => {
                if (value) element.style.setProperty(property, value);
                else element.style.removeProperty(property);
            });
        };

        const captureCoverLayer = (layer) => ({
            active: layer?.classList.contains('is-active') || false,
            backgroundImage: layer?.style.backgroundImage || '',
            loadingHandoff: layer?.dataset.loadingHandoff,
            loadingPrewarm: layer?.dataset.loadingPrewarm,
            revealStyles: {
                clipPath: layer?.style.clipPath || '',
                opacity: layer?.style.opacity || '',
                transform: layer?.style.transform || '',
                filter: layer?.style.filter || '',
                zIndex: layer?.style.zIndex || '',
                willChange: layer?.style.willChange || ''
            }
        });

        const restoreCoverLayer = (layer, snapshot) => {
            if (!layer || !snapshot) return;
            layer.getAnimations?.().forEach((animation) => animation.cancel());
            layer.classList.toggle('is-active', snapshot.active);
            layer.style.backgroundImage = snapshot.backgroundImage;
            Object.assign(layer.style, snapshot.revealStyles);
            if (snapshot.loadingHandoff === undefined) delete layer.dataset.loadingHandoff;
            else layer.dataset.loadingHandoff = snapshot.loadingHandoff;
            if (snapshot.loadingPrewarm === undefined) delete layer.dataset.loadingPrewarm;
            else layer.dataset.loadingPrewarm = snapshot.loadingPrewarm;
        };

        const captureTrackSnapshot = () => {
            const audioState = audioController.getState();
            const stableAudioTrack = currentLyricIndex >= 0 ? audioState.track : null;
            return {
                index: currentLyricIndex,
                lyricHTML: lyricEl.innerHTML,
                songText: songEl.textContent,
                drawQueue: [...drawQueue],
                playerTime: playerTime.innerText,
                trackFillTransform: trackFill.style.transform,
                activeCoverLayer,
                coverLayers: new Map([
                    [coverLayerA, captureCoverLayer(coverLayerA)],
                    [coverLayerB, captureCoverLayer(coverLayerB)]
                ]),
                rootCoverProperties: readInlineProperties(document.documentElement, COVER_STYLE_PROPERTIES),
                bodyCoverProperties: readInlineProperties(document.body, ['--cover-art-url']),
                coverState: document.body.dataset.coverState,
                audio: {
                    ...audioState,
                    track: stableAudioTrack,
                    currentTime: Number.isFinite(audioEl.currentTime) ? audioEl.currentTime : 0,
                    volume: Number.isFinite(audioEl.volume) ? audioEl.volume : 1,
                    mediaMetadata: navigator.mediaSession?.metadata || null
                }
            };
        };

        const restoreTrackSnapshot = (snapshot) => {
            coverSwapRequestId += 1;
            for (const [layer, layerSnapshot] of snapshot.coverLayers) {
                restoreCoverLayer(layer, layerSnapshot);
            }
            activeCoverLayer = snapshot.activeCoverLayer || coverLayerA;
            restoreInlineProperties(document.documentElement, snapshot.rootCoverProperties);
            restoreInlineProperties(document.body, snapshot.bodyCoverProperties);
            if (snapshot.coverState === undefined) delete document.body.dataset.coverState;
            else document.body.dataset.coverState = snapshot.coverState;
            activeCoverReveal = Promise.resolve();

            lyricEl.innerHTML = snapshot.lyricHTML;
            songEl.textContent = snapshot.songText;
            currentLyricIndex = snapshot.index;
            drawQueue = [...snapshot.drawQueue];
            playerTime.innerText = snapshot.playerTime;
            trackFill.style.transform = snapshot.trackFillTransform;
            updatePlaylistActiveTrack(snapshot.index);
            updateArchiveMetadata(snapshot.index, audioController.getState().status);
            if (resultArea.classList.contains('is-visible') && snapshot.index >= 0) {
                revealLyricContentImmediately();
            }
        };

        const prepareTrack = (index, { signal } = {}) => {
            if (signal?.aborted) {
                throw signal.reason || new DOMException('Aborted', 'AbortError');
            }

            const transaction = {
                id: ++trackTransactionSequence,
                status: 'preparing',
                targetIndex: index,
                previousIndex: currentLyricIndex,
                track: createAudioTrackByIndex(index),
                snapshot: captureTrackSnapshot(),
                ready: primeCoverVisual(index, { signal })
            };
            activeTrackTransaction = transaction;
            return transaction;
        };

        const commitTrack = async (transaction, { signal, profile = motionProfile } = {}) => {
            const preparedVisual = await transaction.ready;
            if (signal?.aborted) {
                throw signal.reason || new DOMException('Aborted', 'AbortError');
            }
            if (activeTrackTransaction !== transaction || transaction.status !== 'preparing') {
                throw new Error('Track transaction is no longer active');
            }

            const result = lyricsPool[transaction.targetIndex];
            const coverReady = Promise.resolve(applyPreparedCoverVisual(preparedVisual, {
                profile,
                signal
            })).catch((error) => {
                console.warn('[vinyl] Cover reveal failed.', {
                    song: result.song,
                    message: error?.message || String(error)
                });
                return '';
            });
            activeCoverReveal = coverReady;
            await coverReady;
            if (signal?.aborted) {
                throw signal.reason || new DOMException('Aborted', 'AbortError');
            }
            if (activeTrackTransaction !== transaction || transaction.status !== 'preparing') {
                throw new Error('Track transaction is no longer active');
            }

            lyricEl.innerHTML = renderLyricLinesHTML(result.text);
            songEl.textContent = `- ${result.song}`;
            currentLyricIndex = transaction.targetIndex;
            playerTime.innerText = '0:00';
            trackFill.style.transform = 'translate3d(-100%, 0, 0)';
            consumeLyricIndexFromQueue(transaction.targetIndex);
            updatePlaylistActiveTrack(transaction.targetIndex);
            updateArchiveMetadata(transaction.targetIndex, audioController.getState().status);
            setMediaSessionMetadata(createMediaSessionMetadata(transaction.track));
            if (resultArea.classList.contains('is-visible')) revealLyricContentImmediately();
            transaction.status = 'committed';
            failedTrackTargetIndex = null;
            return transaction.track;
        };

        const rollbackTrack = async (
            transaction,
            { resumePlayback = true, retryable = false } = {}
        ) => {
            if (!transaction || transaction.status === 'rolled-back' || transaction.status === 'rolling-back') {
                return { playbackRestored: false };
            }

            transaction.status = 'rolling-back';
            if (activeTrackTransaction === transaction) activeTrackTransaction = null;
            failedTrackTargetIndex = retryable && transaction.previousIndex < 0
                ? transaction.targetIndex
                : null;
            const { snapshot } = transaction;
            const failedAudioState = audioController.getState();
            restoreTrackSnapshot(snapshot);
            cancelVolumeFade();
            audioController.pause();

            let playbackRestored = false;
            try {
                const restored = await audioController.restore(snapshot.audio, {
                    resumePlayback,
                    restoreVolume: canSetMediaVolume,
                    emptyStatus: retryable ? 'error' : 'idle',
                    emptyError: retryable
                        ? failedAudioState.error || new Error(`Audio failed: ${transaction.track?.title || 'unknown'}`)
                        : null
                });
                playbackRestored = restored.playbackRestored;
            } catch (error) {
                console.warn('[vinyl] Previous track recovery failed.', {
                    song: snapshot.audio.track?.title,
                    message: error?.message || String(error)
                });
                playbackRestored = false;
            } finally {
                transaction.status = 'rolled-back';
                updateArchiveMetadata(currentLyricIndex, audioController.getState().status);
            }

            return { playbackRestored };
        };

        const PLAYLIST_CONTENT_REST_TRANSFORM = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset)))';
        const PLAYLIST_CONTENT_ENTER_START_TRANSFORM = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) + 24px))';
        const PLAYLIST_CONTENT_ENTER_MID_TRANSFORM = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) + 10px))';
        const PLAYLIST_CONTENT_ENTER_NEAR_TRANSFORM = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) + 2px))';
        const PLAYLIST_OPEN_START_OPACITY = Object.freeze({
            full: Object.freeze({ area: 0.2, content: 0.5 }),
            compact: Object.freeze({ area: 0.035, content: 0.02 }),
            reduce: Object.freeze({ area: 0, content: 0 })
        });

        const switchToTrackWithTransition = async (targetIndex, options = {}) => {
            if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= lyricsPool.length) return;
            cancelTurntableMotion();
            return runMotionCommand(() => motion.switchTrack(targetIndex, { ...options, headless: false }));
        };

        const playlist = createPlaylist({
            listEl: playlistList,
            releases,
            tracks: lyricsPool,
            getCoverCandidates: (release) => {
                const fallback = release.coverOssUrl || release.sourceArtworkUrl;
                if (!fallback) return null;

                let isOssArtwork = false;
                try {
                    isOssArtwork = new URL(fallback).hostname.endsWith('.aliyuncs.com');
                } catch {
                    isOssArtwork = false;
                }

                if (!isOssArtwork) {
                    return { src: fallback, srcset: '', fallback };
                }

                return {
                    src: ossImageDerivative(fallback, 480),
                    srcset: `${ossImageDerivative(fallback, 480)} 480w, ${ossImageDerivative(fallback, 960)} 960w`,
                    fallback
                };
            },
            onSelect: createPlaylistSelectionGuard({
                isLocked: () => false,
                onSelect: (index) => switchToTrackWithTransition(index, {
                    stopDuration: 320,
                    showLyrics: true
                })
            })
        });

        let playlistWarmupHandle = null;
        const schedulePlaylistWarmup = () => {
            if (playlist.rendered || playlistWarmupHandle !== null || currentLyricIndex < 0) return;

            const warmPlaylist = () => {
                playlistWarmupHandle = null;
                if (playlist.rendered || currentLyricIndex < 0) return;
                playlist.ensureRendered();
                playlist.setActive(currentLyricIndex);
            };

            if (typeof window.requestIdleCallback === 'function') {
                playlistWarmupHandle = window.requestIdleCallback(warmPlaylist, { timeout: 1600 });
                return;
            }

            playlistWarmupHandle = window.setTimeout(warmPlaylist, 240);
        };

        const updatePlaylistActiveTrack = (index) => playlist.setActive(index);

        const switchToTrackHeadless = async (targetIndex) => {
            if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= lyricsPool.length) return;
            cancelTurntableMotion();
            return runMotionCommand(() => motion.switchTrack(targetIndex, { headless: true }));
        };

        const handleTrackEnded = async () => {
            if (isHandlingTrackEnd || currentLyricIndex === -1) return;

            isHandlingTrackEnd = true;
            isAudioPlaying = false;

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

        const jumpToMediaTrack = (index) => {
            if (!Number.isInteger(index) || index < 0) return;
            if (shouldUseHeadlessTrackSwitch()) {
                void switchToTrackHeadless(index);
            } else {
                void switchToTrackWithTransition(index, { stopDuration: 220 });
            }
        };

        audioController.bindMediaActions({
            playTrack: () => runDirectPlaybackCommand(
                'media session play',
                (isCurrent) => toggleAudioState(true, {
                    skipMotion: shouldUseHeadlessTrackSwitch(),
                    isCurrent
                })
            ),
            pauseTrack: () => runDirectPlaybackCommand('media session pause', (isCurrent) => toggleAudioState(false, {
                skipMotion: true,
                stopDuration: shouldUseHeadlessTrackSwitch() ? 0 : 220,
                isCurrent
            })),
            nextTrack: () => {
                if (currentLyricIndex !== -1) jumpToMediaTrack(pickNextAutoLyricIndex());
            },
            previousTrack: () => {
                if (currentLyricIndex !== -1) jumpToMediaTrack(pickPreviousLyricIndex());
            },
            stopTrack: () => runDirectPlaybackCommand(
                'media session stop',
                (isCurrent) => toggleAudioState(false, {
                    skipMotion: true,
                    stopDuration: 0,
                    isCurrent
                })
            )
        });

        updatePlaybackModeUI();

        document.documentElement.toggleAttribute('data-document-hidden', document.hidden);
        document.addEventListener('visibilitychange', () => {
            document.documentElement.toggleAttribute('data-document-hidden', document.hidden);
            if (document.hidden) {
                hidePointerLight();
                resetDrawButtonSpotlight();
            }
            motion.setDocumentVisible(!document.hidden);
            if (document.visibilityState !== 'visible' || currentLyricIndex === -1) return;

            if (resultArea.classList.contains('is-visible')) {
                revealLyricContentImmediately();
                return;
            }

            if (!playlistArea.classList.contains('is-visible')) {
                setFloatingButtonsVisible(true);
            }
        });

        const resetResultVisual = ({ preserveFloatingButtons = false } = {}) => {
            lyricAnimations.forEach((anim) => anim.cancel());
            lyricAnimations = [];
            clearLyricMotionResidue({ clearLines: true });
            resultArea.classList.remove('is-visible');
            resultArea.classList.remove('show-dismiss-hint');
            setInteractiveState(resultArea, false);
            document.body.classList.remove('has-lyric-overlay');
            if (!preserveFloatingButtons) setOverlayControlsVisible(false);
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

        const resetPlaylistVisual = ({ preserveFloatingButtons = false } = {}) => {
            playlistAnimations.forEach((anim) => anim.cancel());
            playlistAnimations = [];
            playlistArea.classList.remove('is-visible');
            playlistArea.classList.remove('show-dismiss-hint');
            setInteractiveState(playlistArea, false);
            document.body.classList.remove('has-playlist-overlay');
            if (!preserveFloatingButtons) setOverlayControlsVisible(false);
            playlistArea.style.opacity = '0';
            playlistArea.style.transform = 'none';
            playlistCloseBtn.style.opacity = '';
            playlistCloseBtn.style.transform = '';
            playlistCloseBtn.style.filter = '';
            playlistContent.style.opacity = '0';
            playlistContent.style.transform = 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) + 20px))';
            playlistContent.style.filter = '';
        };

        const revealPlaylistItems = () => {
            Array.from(playlistList.querySelectorAll('.playlist-item')).forEach((item) => {
                item.style.opacity = '1';
                item.style.transform = 'translateY(0) scale(1)';
            });
        };

        const animateLyricIn = ({ showOverlayControls = true } = {}) => {
            resultArea.classList.add('is-visible');
            document.body.classList.add('has-lyric-overlay');
            if (!hasShownDismissHint) {
                resultArea.classList.add('show-dismiss-hint');
                hasShownDismissHint = true;
            }
            setControlSplit(true);
            setOverlayControlsVisible(showOverlayControls);

            const cardAnim = safeAnimate(resultArea, [
                { opacity: 0, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'translateY(0)' }
            ], {
                duration: overlayCardDuration,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            applyLyricFeather(lyricEl);
            applyLyricFeather(songEl);
            lyricLines().forEach((line) => {
                line.style.opacity = '1';
                line.style.transform = 'none';
                line.style.filter = 'none';
            });
            const lyricAnim = safeAnimate(lyricEl, createLyricRevealKeyframes(), {
                duration: overlayLyricDuration,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            const songAnim = safeAnimate(songEl, createSongRevealKeyframes(), {
                duration: Math.round(overlayLyricDuration * 0.7),
                delay: Math.round(overlayLyricDuration * 0.3),
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            lyricAnimations = [cardAnim, lyricAnim, songAnim];
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

            const useContentOnlyMotion = shouldUseCompactPlaylistMotion || shouldUseLeanPlaylistMotion();
            const cardAnim = useContentOnlyMotion
                ? null
                : safeAnimate(playlistArea, [
                    { opacity: 0, transform: 'translateY(8px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ], {
                    duration: overlayCardDuration,
                    fill: 'forwards',
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                });

            if (useContentOnlyMotion) {
                playlistArea.style.opacity = '1';
                playlistArea.style.transform = 'translateY(0)';
            }

            const contentAnim = safeAnimate(playlistContent, [
                { opacity: 0, transform: PLAYLIST_CONTENT_ENTER_START_TRANSFORM },
                { opacity: 1, transform: PLAYLIST_CONTENT_REST_TRANSFORM }
            ], {
                duration: playlistContentDuration,
                fill: 'forwards',
                easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
            });

            const playlistItems = Array.from(playlistList.querySelectorAll('.playlist-item'));
            revealPlaylistItems();

            playlistAnimations = [cardAnim, contentAnim].filter(Boolean);
            if (useContentOnlyMotion) return;

            requestAnimationFrame(() => {
                if (!playlistArea.classList.contains('is-visible')) return;

                const listRect = playlistList.getBoundingClientRect();
                const currentItemPosition = playlistItems.findIndex(
                    (item) => Number(item.dataset.index) === currentLyricIndex
                );
                const itemAnimationTargets = getPlaylistViewportItems(
                    playlistItems,
                    listRect,
                    currentItemPosition
                );
                const itemAnimations = itemAnimationTargets.map((item, index) => safeAnimate(item, [
                    { opacity: 0, transform: 'translateY(7px) scale(0.992)' },
                    { opacity: 1, transform: 'translateY(0) scale(1)' }
                ], {
                    duration: playlistItemDuration,
                    delay: Math.min(150, index * 16),
                    fill: 'forwards',
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                }));

                playlistAnimations.push(...itemAnimations);
            });
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

        const runOverlayAnimation = (element, keyframes, options, signal) => animateWithCleanup(
            element,
            keyframes,
            { ...options, fill: 'forwards' },
            signal,
            safeAnimate
        );

        let lastOverlaySnapshot = null;
        const overlayFocusOrigin = new Map();
        const snapshotOverlays = () => ({
            lyrics: resultArea.classList.contains('is-visible'),
            playlist: playlistArea.classList.contains('is-visible'),
            split: dynamicIsland.classList.contains('is-split')
        });
        const resetInactiveOverlay = (isLyrics) => {
            if (isLyrics && playlistArea.classList.contains('is-visible')) {
                resetPlaylistVisual();
            }
            if (!isLyrics && resultArea.classList.contains('is-visible')) {
                resetResultVisual();
            }
        };

        const primeOverlayOpen = (kind, profile) => {
            const isLyrics = kind === 'lyrics';
            const element = isLyrics ? resultArea : playlistArea;
            const content = isLyrics ? lyricEl : playlistContent;
            const playlistStart = PLAYLIST_OPEN_START_OPACITY[profile]
                || PLAYLIST_OPEN_START_OPACITY.compact;

            element.style.opacity = `${isLyrics ? 0 : playlistStart.area}`;
            element.style.transform = isLyrics
                ? 'translate3d(0, 0, 0)'
                : 'translateY(8px)';
            content.style.opacity = `${isLyrics ? 0.08 : playlistStart.content}`;
            content.style.transform = isLyrics
                ? 'translateY(22px) scaleX(0.94) scaleY(1.035)'
                : PLAYLIST_CONTENT_ENTER_START_TRANSFORM;
            content.style.clipPath = '';
            content.style.filter = isLyrics ? 'blur(14px)' : '';

            if (!isLyrics) return;
            songEl.style.opacity = '0';
            songEl.style.transform = 'translateY(14px) scaleX(0.965) scaleY(1.022)';
            songEl.style.filter = 'blur(10px)';
            applyLyricFeather(lyricEl);
            applyLyricFeather(songEl);
            lyricLines().forEach((line) => {
                line.style.opacity = '1';
                line.style.transform = 'none';
                line.style.filter = 'none';
                line.style.clipPath = '';
                clearLyricFeather(line);
            });
        };

        const rememberOverlayFocusOrigin = (kind, element) => {
            const activeElement = document.activeElement;
            if (
                activeElement
                && activeElement !== document.body
                && !element.contains(activeElement)
            ) {
                overlayFocusOrigin.set(kind, activeElement);
            }
        };

        const focusWithoutScroll = (element) => {
            if (!element?.isConnected || element.closest?.('[inert]')) return;
            try {
                element.focus({ preventScroll: true });
            } catch {
                element.focus();
            }
        };

        const settleOverlayOpen = (kind) => {
            const isLyrics = kind === 'lyrics';
            const element = isLyrics ? resultArea : playlistArea;
            const content = isLyrics ? lyricEl : playlistContent;
            const closeButton = isLyrics ? lyricCloseBtn : playlistCloseBtn;
            const focusOrigin = overlayFocusOrigin.get(kind);

            setInteractiveState(element, true);
            element.style.opacity = '1';
            element.style.transform = isLyrics ? 'none' : 'translateY(0)';
            content.style.opacity = '1';
            content.style.transform = isLyrics ? 'translateY(0)' : PLAYLIST_CONTENT_REST_TRANSFORM;
            content.style.clipPath = '';
            content.style.filter = '';
            closeButton.style.opacity = '';
            closeButton.style.transform = '';
            closeButton.style.filter = '';
            if (isLyrics) {
                revealLyricContentImmediately();
            } else {
                revealPlaylistItems();
            }
            setControlSplit(true);
            setOverlayControlsVisible(isLyrics);

            if (
                document.visibilityState === 'visible'
                && (document.activeElement === document.body || document.activeElement === focusOrigin)
            ) {
                focusWithoutScroll(closeButton);
            }
        };

        const settleOverlayClosed = (kind, restoreFocus) => {
            const isLyrics = kind === 'lyrics';
            const element = isLyrics ? resultArea : playlistArea;
            const focusOrigin = overlayFocusOrigin.get(kind);

            if (isLyrics) resetResultVisual({ preserveFloatingButtons: true });
            else resetPlaylistVisual({ preserveFloatingButtons: true });
            if (resultArea.classList.contains('is-visible')) setOverlayControlsVisible(true);
            else setFloatingButtonsVisible(true);

            if (
                restoreFocus
                && (element.contains(document.activeElement) || document.activeElement === document.body)
            ) {
                focusWithoutScroll(focusOrigin);
            }
        };

        setInteractiveState(resultArea, false);
        setInteractiveState(playlistArea, false);

        const overlays = {
            readState: snapshotOverlays,
            async open(kind, { signal, duration, profile }) {
                const isLyrics = kind === 'lyrics';
                resetInactiveOverlay(isLyrics);
                if (kind === 'playlist') {
                    playlist.ensureRendered();
                    playlist.setActive(currentLyricIndex);
                    revealPlaylistItems();
                    scrollPlaylistToCurrentContext('auto');
                }

                const element = isLyrics ? resultArea : playlistArea;
                const content = isLyrics ? lyricEl : playlistContent;
                rememberOverlayFocusOrigin(kind, element);
                primeOverlayOpen(kind, profile);
                element.classList.add('is-visible');
                setInteractiveState(element, true);
                document.body.classList.toggle('has-lyric-overlay', isLyrics);
                document.body.classList.toggle('has-playlist-overlay', !isLyrics);
                if (isLyrics && !hasShownDismissHint) {
                    resultArea.classList.add('show-dismiss-hint');
                    hasShownDismissHint = true;
                }
                if (!isLyrics && !hasShownPlaylistHint) {
                    playlistArea.classList.add('show-dismiss-hint');
                    hasShownPlaylistHint = true;
                }
                setControlSplit(true);
                setOverlayControlsVisible(false);

                const primaryEasing = profile === 'compact'
                    ? 'cubic-bezier(0.65, 0, 0.35, 1)'
                    : 'cubic-bezier(0.16, 1, 0.3, 1)';
                try {
                    if (isLyrics) {
                        const overlayDuration = profile === 'full' ? 680 : (profile === 'compact' ? 900 : 0);
                        const blockDuration = profile === 'full' ? 840 : (profile === 'compact' ? 1120 : 0);
                        const blockDelay = profile === 'full' ? 100 : (profile === 'compact' ? 120 : 0);
                        const songDuration = Math.round(blockDuration * 0.7);
                        const songDelay = blockDelay + Math.round(blockDuration * 0.3);
                        await Promise.all([
                            runOverlayAnimation(element, [
                                {
                                    opacity: 0,
                                    transform: 'translate3d(0, 0, 0)'
                                },
                                {
                                    opacity: 1,
                                    transform: 'translate3d(0, 0, 0)'
                                }
                            ], { duration: overlayDuration, easing: primaryEasing }, signal),
                            runOverlayAnimation(lyricEl, createLyricRevealKeyframes(), {
                                duration: blockDuration,
                                delay: blockDelay,
                                easing: primaryEasing
                            }, signal),
                            runOverlayAnimation(songEl, createSongRevealKeyframes(), {
                                duration: songDuration,
                                delay: songDelay,
                                easing: primaryEasing
                            }, signal)
                        ]);
                    } else {
                        if (profile === 'compact') {
                            /* Give WebKit one paint with the primed low-opacity
                               glass before the animated surface becomes visible. */
                            await new Promise((resolve) => requestAnimationFrame(resolve));
                        }
                        const cardDuration = profile === 'full'
                            ? duration
                            : (profile === 'compact' ? Math.min(duration, 600) : 0);
                        const contentDuration = profile === 'compact'
                            ? Math.min(duration, 760)
                            : duration;
                        const playlistStart = PLAYLIST_OPEN_START_OPACITY[profile]
                            || PLAYLIST_OPEN_START_OPACITY.compact;
                        const areaKeyframes = profile === 'compact' ? [
                            { opacity: playlistStart.area, transform: 'translateZ(0)' },
                            { offset: 0.2, opacity: 0.2, transform: 'translateZ(0)' },
                            { offset: 0.5, opacity: 0.68, transform: 'translateZ(0)' },
                            { opacity: 1, transform: 'translateZ(0)' }
                        ] : [
                            { opacity: playlistStart.area, transform: 'translateZ(0)' },
                            { opacity: 1, transform: 'translateZ(0)' }
                        ];
                        const contentKeyframes = profile === 'compact' ? [
                            { opacity: playlistStart.content, transform: PLAYLIST_CONTENT_ENTER_START_TRANSFORM },
                            { offset: 0.22, opacity: playlistStart.content, transform: PLAYLIST_CONTENT_ENTER_START_TRANSFORM },
                            { offset: 0.46, opacity: 0.24, transform: PLAYLIST_CONTENT_ENTER_MID_TRANSFORM },
                            { offset: 0.78, opacity: 0.72, transform: PLAYLIST_CONTENT_ENTER_NEAR_TRANSFORM },
                            { opacity: 1, transform: PLAYLIST_CONTENT_REST_TRANSFORM }
                        ] : [
                            { opacity: playlistStart.content, transform: PLAYLIST_CONTENT_ENTER_START_TRANSFORM },
                            { opacity: 1, transform: PLAYLIST_CONTENT_REST_TRANSFORM }
                        ];
                        await Promise.all([
                            runOverlayAnimation(
                                element,
                                areaKeyframes,
                                {
                                    duration: cardDuration,
                                    easing: profile === 'compact'
                                        ? 'cubic-bezier(0.32, 0, 0.2, 1)'
                                        : primaryEasing
                                },
                                signal
                            ),
                            runOverlayAnimation(
                                content,
                                contentKeyframes,
                                {
                                    duration: contentDuration,
                                    easing: profile === 'compact'
                                        ? 'cubic-bezier(0.32, 0, 0.2, 1)'
                                        : primaryEasing
                                },
                                signal
                            )
                        ]);
                    }
                } finally {
                    settleOverlayOpen(kind);
                    if (isLyrics) schedulePlaylistWarmup();
                }
            },

            async close(kind, { signal, duration, profile }) {
                const isLyrics = kind === 'lyrics';
                const element = isLyrics ? resultArea : playlistArea;
                if (!element.classList.contains('is-visible')) return;

                const restoreFocus = element.contains(document.activeElement);
                setInteractiveState(element, false);
                const content = isLyrics ? lyricEl : playlistContent;
                const closeButton = isLyrics ? lyricCloseBtn : playlistCloseBtn;
                const contentStartTransform = isLyrics
                    ? 'translateY(0)'
                    : PLAYLIST_CONTENT_REST_TRANSFORM;
                const contentExitTransform = isLyrics
                    ? 'translateY(-8px)'
                    : 'translateY(calc(var(--playlist-lift, -8vh) - var(--lyric-ios-offset) - 10px))';
                const overlayCloseDuration = profile === 'compact'
                    ? Math.min(duration, 460)
                    : Math.min(duration, profile === 'reduce' ? 0 : 420);
                const contentCloseDuration = profile === 'compact'
                    ? Math.min(duration, 360)
                    : Math.min(duration, 300);
                const closeButtonDuration = profile === 'compact'
                    ? Math.min(duration, 260)
                    : Math.min(duration, 220);

                dynamicIsland.classList.remove('is-overlay-control-visible');
                setFloatingButtonsVisible(true);
                try {
                    await Promise.all([
                        runOverlayAnimation(element, isLyrics ? [
                            {
                                opacity: 1,
                                transform: 'translate3d(0, 0, 0)'
                            },
                            {
                                opacity: 0,
                                transform: 'translate3d(0, 0, 0)'
                            }
                        ] : [
                            { opacity: 1, transform: 'translateY(0)' },
                            { opacity: 0, transform: 'translateY(-8px)' }
                        ], {
                            duration: overlayCloseDuration,
                            easing: 'cubic-bezier(0.4, 0, 0.2, 1)'
                        }, signal),
                        runOverlayAnimation(content, [
                            { opacity: 1, transform: contentStartTransform },
                            { opacity: 0, transform: contentExitTransform }
                        ], { duration: contentCloseDuration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }, signal),
                        runOverlayAnimation(closeButton, [
                            { opacity: 1, transform: 'translateZ(0) scale(1)' },
                            { opacity: 0, transform: 'translate3d(8px, -8px, 0) scale(0.94)' }
                        ], { duration: closeButtonDuration, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }, signal)
                    ]);
                } finally {
                    settleOverlayClosed(kind, restoreFocus);
                }
            },

            async closeAll({ signal, duration, profile }) {
                const snapshot = snapshotOverlays();
                lastOverlaySnapshot = snapshot;
                await Promise.all([
                    this.close('lyrics', { signal, duration, profile }),
                    this.close('playlist', { signal, duration, profile })
                ]);
                return snapshot;
            },

            async refresh({ signal, duration, profile }) {
                const snapshot = lastOverlaySnapshot;
                if (snapshot?.playlist) {
                    playlist.setActive(currentLyricIndex);
                    scrollPlaylistToCurrentContext('auto');
                }
                if (signal.aborted) return;
                const element = snapshot?.playlist ? playlistContent : lyricEl;
                await runOverlayAnimation(element, [
                    { opacity: 0.55, transform: 'translateY(4px)' },
                    { opacity: 1, transform: 'translateY(0)' }
                ], {
                    duration: Math.min(duration, profile === 'reduce' ? 0 : (profile === 'compact' ? 420 : 280)),
                    easing: 'cubic-bezier(0.22, 1, 0.36, 1)'
                }, signal);
            },

            async restoreAfterTrackSwitch(snapshot, { signal, duration, profile }) {
                if (snapshot?.playlist) {
                    await this.open('playlist', { signal, duration, profile });
                    return;
                }
                if (snapshot?.lyrics) {
                    await this.open('lyrics', { signal, duration, profile });
                    return;
                }
                setControlSplit(Boolean(snapshot?.split));
                if (!signal.aborted && document.visibilityState === 'visible') {
                    setFloatingButtonsVisible(true);
                }
            },

            setDocumentVisible() {},
            dispose() {
                lyricAnimations.forEach((animation) => animation.cancel());
                playlistAnimations.forEach((animation) => animation.cancel());
                lyricAnimations = [];
                playlistAnimations = [];
            }
        };

        const controls = {
            async setLabel(label, { signal, duration }) {
                if (btnTextEl.innerText === label) return;
                const labelDuration = Math.floor(duration / 2);
                try {
                    await runOverlayAnimation(btnTextEl, [
                        { opacity: 1, transform: 'translateY(0)' },
                        { opacity: 0, transform: 'translateY(-4px)' }
                    ], { duration: labelDuration, easing: 'ease-out' }, signal);
                    if (signal.aborted) return;
                    btnTextEl.innerText = label;
                    await runOverlayAnimation(btnTextEl, [
                        { opacity: 0, transform: 'translateY(4px)' },
                        { opacity: 1, transform: 'translateY(0)' }
                    ], { duration: labelDuration, easing: 'ease-out' }, signal);
                } finally {
                    // 淡出完成后会留下行内 opacity:0；若换字被打断，必须落到
                    // 目标文案并恢复可见，按钮不能停在空白状态。
                    if (signal.aborted) {
                        btnTextEl.innerText = label;
                        btnTextEl.style.opacity = '1';
                        btnTextEl.style.transform = 'translateY(0)';
                    }
                }
            }
        };

        const turntableController = {
            readState() {
                return {
                    arm: getCurrentArmAngle(),
                    rate: spinAnimation.playbackRate || 0,
                    spinning: turntable.classList.contains('is-playing')
                };
            },
            moveArmTo(target, { signal, duration, from = getCurrentArmAngle() }) {
                // 唱臂是机械动作里最显眼的一段：放慢并用正弦缓动，起落更从容。
                return animateTonearm({
                    from,
                    to: target === 'play' ? ARM_PLAY_ANGLE : ARM_REST_ANGLE,
                    duration: duration * 1.5,
                    easing: easeInOutSine,
                    signal
                });
            },
            async rampRateTo(targetRate, { signal, duration, from = spinAnimation.playbackRate || 0 }) {
                if (targetRate > 0) this.setSpinning(true);
                const result = await animateRate({
                    from,
                    to: targetRate,
                    duration,
                    easing: easeInOutCubic,
                    signal
                });
                if (targetRate <= 0 && result.status === 'completed') this.setSpinning(false);
                return result;
            },
            setSpinning(active) {
                turntable.classList.toggle('is-playing', active);
                if (
                    active
                    && !prefersReducedMotion
                    && document.visibilityState === 'visible'
                ) {
                    spinAnimation.play();
                    sheenAnimation.play();
                } else {
                    spinAnimation.pause();
                    sheenAnimation.pause();
                }
            },
            setMotionPreference(reduced) {
                if (reduced) {
                    cancelTurntableMotion();
                    const isPlaying = audioController.getState().status === 'playing';
                    turntable.classList.toggle('is-playing', isPlaying);
                    spinAnimation.playbackRate = isPlaying ? 0.68 : 0;
                    updateSheenByRate(spinAnimation.playbackRate);
                    setTonearmAngle(isPlaying ? ARM_PLAY_ANGLE : ARM_REST_ANGLE);
                    spinAnimation.pause();
                    sheenAnimation.pause();
                    return;
                }

                updateSheenByRate(spinAnimation.playbackRate || 0);
                if (
                    document.visibilityState === 'visible'
                    && audioController.getState().status === 'playing'
                ) {
                    spinAnimation.play();
                    sheenAnimation.play();
                }
            },
            async restoreState(state, { duration = 0 } = {}) {
                cancelTurntableMotion();
                const cleanupSignal = new AbortController().signal;
                const targetRate = Number.isFinite(state?.rate) ? Math.max(0, state.rate) : 0;
                const targetArm = Number.isFinite(state?.arm) ? state.arm : ARM_REST_ANGLE;
                if (targetRate > 0 || state?.spinning) this.setSpinning(true);
                await Promise.all([
                    animateTonearm({
                        from: getCurrentArmAngle(),
                        to: targetArm,
                        duration,
                        easing: easeInOutSine,
                        signal: cleanupSignal
                    }),
                    animateRate({
                        from: spinAnimation.playbackRate || 0,
                        to: targetRate,
                        duration,
                        easing: easeInOutCubic,
                        signal: cleanupSignal
                    })
                ]);
                this.setSpinning(Boolean(state?.spinning) && targetRate > 0);
            },
            async resetAfterPlaybackError() {
                resetRejectedPlaybackVisual();
            },
            setDocumentVisible(visible) {
                if (!visible) {
                    spinAnimation.pause();
                    sheenAnimation.pause();
                } else if (!prefersReducedMotion && audioController.getState().status === 'playing') {
                    spinAnimation.play();
                    sheenAnimation.play();
                }
            },
            dispose() {
                cancelTurntableMotion();
                spinAnimation.cancel();
                sheenAnimation.cancel();
            }
        };

        const AUDIO_PREPARE_TIMEOUT_MS = 8000;
        const createAudioReadinessGate = (signal) => {
            let finishGate = () => {};
            const promise = new Promise((resolve) => {
                let settled = false;
                let timer = null;
                const finish = (ready) => {
                    if (settled) return;
                    settled = true;
                    if (timer !== null) clearTimeout(timer);
                    audioEl.removeEventListener('loadedmetadata', onReady);
                    audioEl.removeEventListener('canplay', onReady);
                    audioEl.removeEventListener('error', onError);
                    signal?.removeEventListener('abort', onAbort);
                    resolve(ready);
                };
                const onReady = () => finish(true);
                const onError = () => finish(false);
                const onAbort = () => finish(false);
                finishGate = finish;

                audioEl.addEventListener('loadedmetadata', onReady, { once: true });
                audioEl.addEventListener('canplay', onReady, { once: true });
                audioEl.addEventListener('error', onError, { once: true });
                signal?.addEventListener('abort', onAbort, { once: true });
                timer = setTimeout(() => finish(false), AUDIO_PREPARE_TIMEOUT_MS);
                if (signal?.aborted) finish(false);
            });
            return { promise, finish: finishGate };
        };

        const motionAudio = {
            getState: () => audioController.getState(),
            pause() {
                cancelVolumeFade();
                audioController.pause();
            },
            async load(track, { signal } = {}) {
                const readiness = createAudioReadinessGate(signal);
                try {
                    const loaded = await audioController.load(track);
                    if (loaded === false) {
                        readiness.finish(false);
                        return false;
                    }
                    if (audioEl.readyState >= HTMLMediaElement.HAVE_METADATA) {
                        readiness.finish(true);
                    }
                    const ready = await readiness.promise;
                    if (
                        !ready
                        && !signal?.aborted
                        && audioController.getState().status !== 'error'
                    ) {
                        audioEl.dispatchEvent(new Event('error'));
                    }
                    return ready;
                } catch (error) {
                    readiness.finish(false);
                    throw error;
                }
            },
            play: ({ signal }) => {
                if (canSetMediaVolume) audioEl.volume = 1;
                return audioController.play({ signal });
            }
        };

        document.documentElement.dataset.motionProfile = motionProfile;
        const motion = createMotionController({
            profile: motionProfile,
            transitions: createAppTransitions({
                turntable: turntableController,
                overlays,
                controls,
                audio: motionAudio,
                prepareTrack,
                commitTrack,
                rollbackTrack,
                waitForCoverReveal: waitForActiveCoverReveal
            }),
            onActivityChange: ({ active, name }) => {
                archiveStatusOverride = active && name === 'draw' ? 'drawing' : null;
                isDrawing = active && (name === 'draw' || name === 'switch-track');
                isTrackSwitching = active && name === 'switch-track';
                document.body.classList.toggle('is-track-transitioning', isTrackSwitching);
                setPlayButtonBusy(isDrawing);
                if (isDrawing) resetDrawButtonSpotlight();
                updateArchiveMetadata(currentLyricIndex, audioController.getState().status);
            }
        });

        const settleReducedMotionPresentation = () => {
            if (controlMotionTimer) {
                clearTimeout(controlMotionTimer);
                controlMotionTimer = null;
            }
            dynamicIsland.classList.remove('is-opening', 'is-collapsing');

            lyricAnimations.forEach((animation) => animation.cancel());
            playlistAnimations.forEach((animation) => animation.cancel());
            lyricAnimations = [];
            playlistAnimations = [];
            btnTextEl.getAnimations?.().forEach((animation) => animation.cancel());
            btnTextEl.textContent = currentLyricIndex === -1 ? '抽取' : '再次抽取';
            btnTextEl.style.opacity = '1';
            btnTextEl.style.transform = 'translateY(0)';

            if (resultArea.classList.contains('is-visible')) {
                resultArea.style.opacity = '1';
                resultArea.style.transform = 'translateY(0)';
                revealLyricContentImmediately();
            }

            if (playlistArea.classList.contains('is-visible')) {
                playlistArea.style.opacity = '1';
                playlistArea.style.transform = 'translateY(0)';
                playlistContent.style.opacity = '1';
                playlistContent.style.transform = PLAYLIST_CONTENT_REST_TRANSFORM;
                revealPlaylistItems();
            }
        };

        const syncMotionPreference = () => {
            prefersReducedMotion = Boolean(reducedMotionQuery?.matches);
            if (prefersReducedMotion) hidePointerLight();
            const nextProfile = detectMotionProfile();
            document.documentElement.dataset.motionProfile = nextProfile;
            controlParticleDissolver.setProfile(nextProfile);
            if (nextProfile !== 'full') resetDrawButtonSpotlight();
            criticalAssetGate.setProfile?.(nextProfile);
            turntableController.setMotionPreference(prefersReducedMotion);
            void motion.setProfile(nextProfile).then(() => {
                if (prefersReducedMotion && motion.profile === 'reduce') settleReducedMotionPresentation();
            });
        };

        if (typeof reducedMotionQuery?.addEventListener === 'function') {
            reducedMotionQuery.addEventListener('change', syncMotionPreference);
        } else {
            reducedMotionQuery?.addListener?.(syncMotionPreference);
        }
        window.addEventListener('resize', syncMotionPreference, { passive: true });

        const runMotionCommand = async (
            command,
            { invalidatePlaybackCommand = true } = {}
        ) => {
            if (invalidatePlaybackCommand) {
                directPlaybackCommandEpoch += 1;
                suppressPlaybackMotion = false;
            }
            try {
                return await command();
            } catch (error) {
                console.warn('[vinyl] Motion command failed.', { message: error?.message });
                return { status: 'cancelled' };
            }
        };

        const runOverlayMotionCommand = (command) => runMotionCommand(command, {
            invalidatePlaybackCommand: false
        });

        const runDirectPlaybackCommand = async (reason, command) => {
            const commandEpoch = ++directPlaybackCommandEpoch;
            const isCurrent = () => commandEpoch === directPlaybackCommandEpoch;
            suppressPlaybackMotion = false;
            await motion.cancel(reason);
            if (!isCurrent()) return { status: 'cancelled' };
            cancelTurntableMotion();
            try {
                return await command(isCurrent);
            } finally {
                if (!isCurrent()) return;
                if (currentLyricIndex !== -1) {
                    setControlSplit(true);
                    if (resultArea.classList.contains('is-visible')) {
                        setOverlayControlsVisible(true);
                    } else if (playlistArea.classList.contains('is-visible')) {
                        setOverlayControlsVisible(false);
                    } else {
                        setFloatingButtonsVisible(true);
                    }
                }
            }
        };

        const closeLyricOverlay = async () => {
            if (!resultArea.classList.contains('is-visible')) return;
            return runOverlayMotionCommand(() => motion.closeOverlay('lyrics'));
        };

        const closePlaylistOverlay = async () => {
            if (!playlistArea.classList.contains('is-visible')) return;
            return runOverlayMotionCommand(() => motion.closeOverlay('playlist'));
        };

        let pendingOverlayPassthroughClick = null;

        /* On coarse-pointer devices a tap can land on a fixed player control
           underneath an overlay while the overlay is still compositing. The
           bubbling click listener then never sees the backdrop target. Catch
           that pointer at the document boundary, close the active overlay, and
           prevent the underlying control from receiving the same tap. */
        document.addEventListener('pointerup', (event) => {
            if (!isCoarsePointer && event.pointerType !== 'touch') return;

            const activeOverlay = playlistArea.classList.contains('is-visible')
                ? {
                    area: playlistArea,
                    protectedSelector: '#playlistCloseBtn, .playlist-title, .playlist-mode-wrap, .playlist-list',
                    close: closePlaylistOverlay
                }
                : resultArea.classList.contains('is-visible')
                    ? {
                        area: resultArea,
                        protectedSelector: '#lyricText, #songName, #lyricCloseBtn',
                        close: closeLyricOverlay
                    }
                    : null;
            if (!activeOverlay) return;

            const target = event.target;
            const targetElement = target instanceof Element ? target : null;
            if (targetElement?.closest(activeOverlay.protectedSelector)) return;

            pendingOverlayPassthroughClick = {
                target,
                clientX: event.clientX,
                clientY: event.clientY,
                expiresAt: performance.now() + 700
            };
            if (event.cancelable) event.preventDefault();
            event.stopPropagation();
            void activeOverlay.close();
        }, true);

        document.addEventListener('click', (event) => {
            const pending = pendingOverlayPassthroughClick;
            if (!pending) return;

            pendingOverlayPassthroughClick = null;
            const withinSyntheticClickWindow = performance.now() <= pending.expiresAt;
            const matchesTarget = event.target === pending.target;
            const matchesPosition = Math.hypot(
                event.clientX - pending.clientX,
                event.clientY - pending.clientY
            ) <= 18;
            if (!withinSyntheticClickWindow || (!matchesTarget && !matchesPosition)) return;

            if (event.cancelable) event.preventDefault();
            event.stopImmediatePropagation();
        }, true);

        const isTouchBlankTarget = (target, protectedSelector) => {
            if (!isCoarsePointer || !(target instanceof Element)) return false;
            return !target.closest(protectedSelector);
        };

        resultArea.addEventListener('click', async (event) => {
            if (!resultArea.classList.contains('is-visible')) return;
            const isBackdrop = event.target === resultArea || event.target === lyricDismissHint;
            const isTouchBlank = isTouchBlankTarget(
                event.target,
                '#lyricText, #songName, #lyricCloseBtn'
            );
            if (!isBackdrop && !isTouchBlank) return;

            await closeLyricOverlay();
        });

        playlistArea.addEventListener('click', async (event) => {
            if (!playlistArea.classList.contains('is-visible')) return;
            const isBackdrop = event.target === playlistArea || event.target === playlistDismissHint;
            const isTouchBlank = isTouchBlankTarget(
                event.target,
                '#playlistCloseBtn, .playlist-title, .playlist-mode-wrap, .playlist-list'
            );
            if (!isBackdrop && !isTouchBlank) return;

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
            if (currentLyricIndex === -1) return;
            void runOverlayMotionCommand(() => motion.openOverlay('lyrics'));
        });

        playlistToggleBtn.addEventListener('click', () => {
            if (currentLyricIndex === -1) return;
            void runOverlayMotionCommand(() => motion.openOverlay('playlist'));
        });

        if (playlistModeSwitch) {
            playlistModeSwitch.addEventListener('click', () => {
                cyclePlaybackMode();
            });
        }

        playButton.addEventListener('click', async () => {
            setFloatingButtonsVisible(false);
            setControlSplit(false);
            cancelTurntableMotion();
            const targetIndex = pickRandomLyricIndex(currentLyricIndex);
            await runMotionCommand(() => motion.draw(targetIndex));
        });
