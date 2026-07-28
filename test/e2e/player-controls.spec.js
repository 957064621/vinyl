import { test, expect } from '@playwright/test';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';
import { DRAW_LYRIC_HOLD_MS } from '../../src/app/transitions.js';

const DETERMINISTIC_COVER = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#101722"/>
    <rect x="32" y="32" width="536" height="736" fill="#dceeff"/>
    <rect x="68" y="68" width="464" height="664" fill="#26394a"/>
  </svg>
`);

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1024, height: 900 },
  { width: 820, height: 900 },
  { width: 768, height: 900 },
  { width: 390, height: 844 },
  { width: 320, height: 568 }
];

const AUDIO_ERROR_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 390, height: 844 },
  { width: 320, height: 568 }
];

const SHORT_LYRIC_VIEWPORTS = [
  { width: 390, height: 720 },
  { width: 320, height: 568 }
];

const SHORT_SCREEN_LYRIC_SAMPLE = [
  '我以为是规则 失去最爱的一个',
  '才能记忆深刻',
  '那些幼稚的 轻狂的 勇敢的 从此收着',
  '我还在羡慕什么 街上哭的那个',
  '你却无比希望他抱住另一个',
  '那是你离开了北京的生活'
];

const installDeterministicCovers = async (page) => {
  const criticalPaths = new Set(
    CRITICAL_IMAGE_MANIFEST.map(({ source }) => new URL(source).pathname)
  );

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'image') return route.continue();

    let pathname = '';
    try {
      pathname = new URL(request.url()).pathname;
    } catch {
      return route.abort('blockedbyclient');
    }

    if (!criticalPaths.has(pathname)) return route.abort('blockedbyclient');
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: DETERMINISTIC_COVER
    });
  });
};

const installDeterministicMedia = async (page) => {
  await page.addInitScript(() => {
    const mediaState = new WeakMap();
    const stateFor = (media) => {
      if (!mediaState.has(media)) {
        mediaState.set(media, {
          paused: true,
          ended: false,
          currentTime: 0,
          duration: 900
        });
      }
      return mediaState.get(media);
    };

    Object.defineProperties(HTMLMediaElement.prototype, {
      paused: {
        configurable: true,
        get() { return stateFor(this).paused; }
      },
      ended: {
        configurable: true,
        get() { return stateFor(this).ended; }
      },
      currentTime: {
        configurable: true,
        get() { return stateFor(this).currentTime; },
        set(value) { stateFor(this).currentTime = Number(value) || 0; }
      },
      duration: {
        configurable: true,
        get() { return stateFor(this).duration; }
      }
    });

    HTMLMediaElement.prototype.load = function load() {
      const state = stateFor(this);
      state.currentTime = 0;
      state.ended = false;
      window.__testAudio = this;
    };
    HTMLMediaElement.prototype.play = function play() {
      const state = stateFor(this);
      state.paused = false;
      state.ended = false;
      window.__testAudio = this;
      this.dispatchEvent(new Event('play'));
      return Promise.resolve();
    };
    HTMLMediaElement.prototype.pause = function pause() {
      const state = stateFor(this);
      const shouldDispatch = !state.paused;
      state.paused = true;
      window.__testAudio = this;
      if (shouldDispatch) this.dispatchEvent(new Event('pause'));
    };

    const handlers = Object.create(null);
    const mediaSession = {
      metadata: null,
      playbackState: 'none',
      setActionHandler(name, handler) {
        handlers[name] = handler;
      },
      setPositionState() {}
    };

    Object.defineProperty(navigator, 'mediaSession', {
      configurable: true,
      value: mediaSession
    });
    Object.defineProperty(globalThis, 'MediaMetadata', {
      configurable: true,
      value: class MediaMetadata {
        constructor(init) { Object.assign(this, init); }
      }
    });
    window.__mediaSessionHandlers = handlers;
    window.__mediaSession = mediaSession;
  });
};

const waitForApp = async (page) => {
  await installDeterministicCovers(page);
  await installDeterministicMedia(page);
  await page.goto('./');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
};

const waitForAppWithMediaFailure = async (page) => {
  await installDeterministicCovers(page);
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() === 'media') return route.abort('failed');
    return route.fallback();
  });
  await page.goto('./');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
};

const drawAndOpenLyrics = async (page) => {
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#playerToggleBtn')).toHaveClass(/is-playing/, { timeout: 12_000 });
  await expect(page.locator('#dynamicIsland')).toHaveClass(/is-split/);
};

const drawAndCloseLyrics = async (page) => {
  await drawAndOpenLyrics(page);
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  await expect(page.locator('#lyricToggleBtn')).toHaveClass(/is-visible/);
  await expect(page.locator('#playlistToggleBtn')).toHaveClass(/is-visible/);
  await expect.poll(() => page.locator('#dynamicIsland').evaluate((island) => (
    island.classList.contains('is-opening') || island.classList.contains('is-collapsing')
  ))).toBe(false);
};

const readTurntableState = (page) => page.evaluate(() => {
  const turntable = document.querySelector('#turntable');
  const playerToggle = document.querySelector('#playerToggleBtn');
  const tonearm = document.querySelector('#tonearm');
  const vinyl = document.querySelector('#vinylRecord');
  const sheen = document.querySelector('#vinylSheen');
  const animationState = (element) => element.getAnimations()
    .filter((animation) => animation.effect?.target === element)
    .map((animation) => ({
      playState: animation.playState,
      playbackRate: animation.playbackRate,
      duration: animation.effect?.getTiming().duration
    }));

  return {
    turntablePlaying: turntable.classList.contains('is-playing'),
    playerPlaying: playerToggle.classList.contains('is-playing'),
    armAngle: Number.parseFloat(getComputedStyle(tonearm).getPropertyValue('--arm-angle')),
    vinylAnimations: animationState(vinyl),
    sheenAnimations: animationState(sheen)
  };
});

const waitForTurntableRest = async (page) => {
  await expect.poll(async () => {
    const state = await readTurntableState(page);
    return {
      turntablePlaying: state.turntablePlaying,
      playerPlaying: state.playerPlaying,
      armAtRest: Math.abs(state.armAngle + 96) <= 0.1,
      vinylPaused: state.vinylAnimations.length === 1
        && state.vinylAnimations[0].playState === 'paused',
      sheenPaused: state.sheenAnimations.length === 1
        && state.sheenAnimations[0].playState === 'paused'
    };
  }, { timeout: 5_000 }).toEqual({
    turntablePlaying: false,
    playerPlaying: false,
    armAtRest: true,
    vinylPaused: true,
    sheenPaused: true
  });
};

const expectCompleteRestState = async (page) => {
  await waitForTurntableRest(page);
  const state = await readTurntableState(page);
  expect(state.vinylAnimations).toEqual([{ playState: 'paused', playbackRate: 0, duration: 14_000 }]);
  expect(state.sheenAnimations).toEqual([{ playState: 'paused', playbackRate: 0, duration: 7_000 }]);
  expect(state.armAngle).toBeCloseTo(-96, 1);
};

const hitTestControlCenter = (page, selector) => page.locator(selector).evaluate((control) => {
  const rect = control.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  const hit = document.elementFromPoint(x, y);
  return {
    hit: Boolean(hit?.closest(control.id ? `#${control.id}` : null) === control),
    point: { x, y },
    hitId: hit?.id || '',
    hitClass: typeof hit?.className === 'string' ? hit.className : ''
  };
});

test('draw keeps the switched record cover visible for 500ms before lyrics appear', async ({ page }) => {
  await waitForApp(page);
  await page.evaluate(() => {
    const coverRoot = document.querySelector('.vinyl-sticker');
    const resultArea = document.querySelector('#resultArea');
    const archiveState = document.querySelector('#archivePlaybackState');
    const initialActiveCover = coverRoot.querySelector('.vinyl-cover.is-active');
    window.__drawRevealTiming = {
      coverChangedAt: null,
      coverAt: null,
      lyricsAt: null,
      archiveStates: [archiveState.textContent]
    };

    const sampleCover = () => {
      const timing = window.__drawRevealTiming;
      const activeCover = coverRoot.querySelector('.vinyl-cover.is-active');
      if (activeCover && activeCover !== initialActiveCover) {
        timing.coverChangedAt ??= performance.now();
        const inactiveCovers = Array.from(coverRoot.querySelectorAll('.vinyl-cover'))
          .filter((cover) => cover !== activeCover);
        const activeOpacity = Number.parseFloat(getComputedStyle(activeCover).opacity);
        const inactiveOpacity = Math.max(
          0,
          ...inactiveCovers.map((cover) => Number.parseFloat(getComputedStyle(cover).opacity))
        );
        if (
          activeCover.style.backgroundImage
          && activeOpacity >= 0.99
          && inactiveOpacity <= 0.01
        ) {
          timing.coverAt ??= performance.now();
        }
      }
      if (timing.coverAt === null) requestAnimationFrame(sampleCover);
    };
    requestAnimationFrame(sampleCover);

    new MutationObserver(() => {
      if (
        window.__drawRevealTiming.lyricsAt === null
        && resultArea.classList.contains('is-visible')
      ) {
        window.__drawRevealTiming.lyricsAt = performance.now();
      }
    }).observe(resultArea, { attributes: true, attributeFilter: ['class'] });

    new MutationObserver(() => {
      window.__drawRevealTiming.archiveStates.push(archiveState.textContent);
    }).observe(archiveState, { childList: true, subtree: true, characterData: true });
  });

  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#archivePlaybackState')).toHaveText('播放', { timeout: 12_000 });

  const timing = await page.evaluate(() => ({
    ...window.__drawRevealTiming,
    activeCoverCount: document.querySelectorAll('.vinyl-cover.is-active').length
  }));
  expect(timing.coverAt).not.toBeNull();
  expect(timing.coverChangedAt).not.toBeNull();
  expect(timing.lyricsAt).not.toBeNull();
  expect(timing.lyricsAt - timing.coverAt)
    .toBeGreaterThanOrEqual(DRAW_LYRIC_HOLD_MS - 20);
  expect(timing.lyricsAt - timing.coverAt)
    .toBeLessThanOrEqual(DRAW_LYRIC_HOLD_MS + 150);
  expect(timing.activeCoverCount).toBe(1);
  expect(timing.archiveStates).toContain('抽取中');
  expect(timing.archiveStates.at(-1)).toBe('播放');
  const drawingIndex = timing.archiveStates.indexOf('抽取中');
  expect(timing.archiveStates.slice(drawingIndex, -1)).not.toContain('读取');
  expect(timing.archiveStates.slice(drawingIndex, -1)).not.toContain('暂停');
});

test('redraw keeps the replacement cover fully visible for 500ms before reopening lyrics', async ({ page }, testInfo) => {
  await waitForApp(page);
  await drawAndOpenLyrics(page);

  await page.evaluate((holdMs) => {
    const coverRoot = document.querySelector('.vinyl-sticker');
    const resultArea = document.querySelector('#resultArea');
    const initialActiveCover = coverRoot.querySelector('.vinyl-cover.is-active');
    let resolveMidHold;
    window.__redrawCoverHoldPromise = new Promise((resolve) => {
      resolveMidHold = resolve;
    });
    window.__redrawRevealTiming = {
      initialActiveCoverId: initialActiveCover?.id || '',
      replacementCoverId: '',
      replacementHadLoadingHandoff: null,
      replacementAnimationName: '',
      coverChangedAt: null,
      coverSettledAt: null,
      lyricsClosedAt: null,
      lyricsAt: null,
      sawLyricsClosed: false,
      midHoldLyricsVisible: null
    };

    const readLyricsState = () => {
      const timing = window.__redrawRevealTiming;
      const visible = resultArea.classList.contains('is-visible');
      if (!visible) {
        timing.sawLyricsClosed = true;
        timing.lyricsClosedAt ??= performance.now();
      } else if (timing.sawLyricsClosed && timing.lyricsAt === null) {
        timing.lyricsAt = performance.now();
      }
    };
    new MutationObserver(readLyricsState).observe(resultArea, {
      attributes: true,
      attributeFilter: ['class']
    });

    const sampleCover = () => {
      const timing = window.__redrawRevealTiming;
      const activeCover = coverRoot.querySelector('.vinyl-cover.is-active');
      if (activeCover && activeCover !== initialActiveCover) {
        timing.replacementCoverId = activeCover.id;
        if (timing.coverChangedAt === null) {
          timing.coverChangedAt = performance.now();
          timing.replacementHadLoadingHandoff = activeCover.hasAttribute('data-loading-handoff')
            || activeCover.hasAttribute('data-loading-prewarm');
          timing.replacementAnimationName = getComputedStyle(activeCover).animationName;
        }
        const inactiveCovers = Array.from(coverRoot.querySelectorAll('.vinyl-cover'))
          .filter((cover) => cover !== activeCover);
        const activeOpacity = Number.parseFloat(getComputedStyle(activeCover).opacity);
        const inactiveOpacity = Math.max(
          0,
          ...inactiveCovers.map((cover) => Number.parseFloat(getComputedStyle(cover).opacity))
        );
        if (activeOpacity >= 0.99 && inactiveOpacity <= 0.01) {
          if (timing.coverSettledAt === null) {
            timing.coverSettledAt = performance.now();
            setTimeout(() => {
              timing.midHoldLyricsVisible = resultArea.classList.contains('is-visible');
              resolveMidHold();
            }, holdMs / 2);
          }
        }
      }

      if (timing.coverSettledAt === null || timing.lyricsAt === null) {
        requestAnimationFrame(sampleCover);
      }
    };
    requestAnimationFrame(sampleCover);
  }, DRAW_LYRIC_HOLD_MS);

  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/, { timeout: 5_000 });
  await page.evaluate(() => window.__redrawCoverHoldPromise);
  expect(await page.evaluate(() => window.__redrawRevealTiming.midHoldLyricsVisible)).toBe(false);
  await testInfo.attach('redraw-cover-hold', {
    body: await page.screenshot(),
    contentType: 'image/png'
  });
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect.poll(() => page.evaluate(() => (
    window.__redrawRevealTiming.coverSettledAt !== null
      && window.__redrawRevealTiming.lyricsAt !== null
  )), { timeout: 5_000 }).toBe(true);

  const timing = await page.evaluate(() => ({ ...window.__redrawRevealTiming }));
  expect(timing.replacementCoverId).not.toBe(timing.initialActiveCoverId);
  expect(timing.replacementHadLoadingHandoff).toBe(false);
  expect(timing.replacementAnimationName).not.toContain('loading-target-cover-reveal');
  expect(timing.coverChangedAt).not.toBeNull();
  expect(timing.coverSettledAt).not.toBeNull();
  expect(timing.lyricsAt).not.toBeNull();
  expect(timing.lyricsAt - timing.coverSettledAt)
    .toBeGreaterThanOrEqual(DRAW_LYRIC_HOLD_MS - 20);
  expect(timing.lyricsAt - timing.coverSettledAt)
    .toBeLessThanOrEqual(DRAW_LYRIC_HOLD_MS + 150);
});

test('normal pause settles the record, sheen, and tonearm at rest', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndCloseLyrics(page);

  await page.locator('#playerToggleBtn').click();

  await expectCompleteRestState(page);
});

test('Media Session pause reaches the same complete rest state', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndCloseLyrics(page);

  await page.evaluate(() => {
    const pause = window.__mediaSessionHandlers.pause;
    if (typeof pause !== 'function') throw new Error('Media Session pause handler was not installed');
    pause();
  });

  await expectCompleteRestState(page);
});

test('rapid pause then play is not overwritten by the old stop tween', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndCloseLyrics(page);

  const toggle = page.locator('#playerToggleBtn');
  await toggle.click();
  await page.waitForTimeout(80);
  await toggle.click();

  // This outlives both the 420ms audio fade and the old 1080ms stop tween.
  await page.waitForTimeout(1_700);
  const state = await readTurntableState(page);
  expect(state.playerPlaying).toBe(true);
  expect(state.turntablePlaying).toBe(true);
  expect(state.armAngle).toBeCloseTo(-34, 1);
  expect(state.vinylAnimations).toHaveLength(1);
  expect(state.sheenAnimations).toHaveLength(1);
  expect(state.vinylAnimations[0].playState).toBe('running');
  expect(state.sheenAnimations[0].playState).toBe('running');
  expect(state.vinylAnimations[0].playbackRate).toBeGreaterThan(0);
  expect(state.sheenAnimations[0].playbackRate).toBeGreaterThan(0);
});

test('rapid pause, play, then pause settles the latest intent completely', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndCloseLyrics(page);

  const toggle = page.locator('#playerToggleBtn');
  await toggle.click();
  await page.waitForTimeout(80);
  await toggle.click();
  await page.waitForTimeout(80);
  await toggle.click();

  await expectCompleteRestState(page);
});

for (const action of ['play', 'pause']) {
  test(`Media Session ${action} during draw acceleration cannot strand turntable motion`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');
    await waitForApp(page);

    await page.locator('#playButton').click();
    await page.waitForTimeout(180);
    await page.evaluate((actionName) => {
      const handler = window.__mediaSessionHandlers[actionName];
      if (typeof handler !== 'function') throw new Error(`Missing Media Session ${actionName} handler`);
      handler();
    }, action);

    await expectCompleteRestState(page);
  });
}

test('successful Media Session replay interrupted by a redraw restores usable controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndCloseLyrics(page);

  await page.locator('#playButton').click();
  await page.waitForTimeout(180);
  await page.evaluate(() => {
    const play = window.__mediaSessionHandlers.play;
    if (typeof play !== 'function') throw new Error('Missing Media Session play handler');
    play();
  });

  await expect(page.locator('#playerToggleBtn')).toHaveClass(/is-playing/);
  await expect(page.locator('#dynamicIsland')).toHaveClass(/is-split/);
  await expect(page.locator('#playerPill')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#playerPill')).not.toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#lyricToggleBtn')).toHaveClass(/is-visible/);
  await expect(page.locator('#playlistToggleBtn')).toHaveClass(/is-visible/);
  expect(await hitTestControlCenter(page, '#playerToggleBtn')).toMatchObject({ hit: true });
});

test('persistent record animations keep real timing when reduced motion becomes full', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-reduce');
  await waitForApp(page);

  const timings = async () => page.evaluate(() => {
    const timingFor = (selector) => document.querySelector(selector)
      .getAnimations()
      .find((animation) => animation.effect?.target === document.querySelector(selector))
      ?.effect?.getTiming().duration;
    return {
      vinyl: timingFor('#vinylRecord'),
      sheen: timingFor('#vinylSheen')
    };
  });

  expect(await timings()).toEqual({ vinyl: 14_000, sheen: 7_000 });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect.poll(timings).toEqual({ vinyl: 14_000, sheen: 7_000 });
});

test('媚人 publishes its independent release cover and metadata', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndCloseLyrics(page);

  await page.locator('#playlistToggleBtn').click();
  await expect(page.locator('#playlistArea')).toHaveClass(/is-visible/);
  await page.locator('.playlist-group[data-release="媚人 - Single"] .playlist-item').click();

  await expect(page.locator('#archiveRelease')).toHaveText('媚人 - Single');
  await expect(page.locator('#archiveYear')).toHaveText('2026');
  await expect(page.locator('body')).not.toHaveAttribute('data-cover-state', 'neutral');
  const artworkState = await page.evaluate(() => ({
    artwork: window.__mediaSession.metadata?.artwork,
    coverArtUrl: getComputedStyle(document.documentElement).getPropertyValue('--cover-art-url').trim(),
    activeCoverCount: document.querySelectorAll('.vinyl-cover.is-active').length,
    inlineCovers: Array.from(document.querySelectorAll('.vinyl-cover'), (cover) => cover.style.backgroundImage)
  }));
  expect(artworkState.artwork).toHaveLength(1);
  expect(artworkState.artwork[0].src).toContain('4896016816485.jpg');
  expect(artworkState.coverArtUrl).toContain('4896016816485.jpg');
  expect(artworkState.activeCoverCount).toBe(1);
  expect(artworkState.inlineCovers.some((value) => value.includes('4896016816485.jpg'))).toBe(true);
});

for (const viewport of VIEWPORTS) {
  test(`controls and time stay within bounds at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');
    await page.setViewportSize(viewport);
    await waitForApp(page);
    await drawAndCloseLyrics(page);

    await page.evaluate(() => {
      const audio = window.__testAudio;
      if (!audio) throw new Error('Deterministic audio element was not captured');
      audio.currentTime = 600;
      audio.dispatchEvent(new Event('timeupdate'));
    });
    await expect(page.locator('#playerTime')).toHaveText('10:00');

    const geometry = await page.evaluate(() => {
      const rectOf = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      };
      const intersects = (left, right, tolerance = 1) => (
        Math.min(left.right, right.right) - Math.max(left.left, right.left) > tolerance
        && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > tolerance
      );
      const within = (inner, outer, tolerance = 1) => (
        inner.left >= outer.left - tolerance
        && inner.right <= outer.right + tolerance
        && inner.top >= outer.top - tolerance
        && inner.bottom <= outer.bottom + tolerance
      );

      const player = rectOf('#playerPill');
      const time = rectOf('#playerTime');
      const footer = rectOf('#contactLink');
      const viewportRect = {
        left: 0,
        right: window.innerWidth,
        top: 0,
        bottom: window.innerHeight
      };
      const timeElement = document.querySelector('#playerTime');
      const range = document.createRange();
      range.selectNodeContents(timeElement);
      const textRect = range.getBoundingClientRect();
      const text = {
        left: textRect.left,
        right: textRect.right,
        top: textRect.top,
        bottom: textRect.bottom,
        width: textRect.width,
        height: textRect.height
      };

      return {
        player,
        playlist: rectOf('#playlistToggleBtn'),
        lyrics: rectOf('#lyricToggleBtn'),
        footer,
        time,
        text,
        playlistIntersectsPlayer: intersects(rectOf('#playlistToggleBtn'), player),
        lyricsIntersectsPlayer: intersects(rectOf('#lyricToggleBtn'), player),
        footerIntersectsPlayer: intersects(footer, player),
        footerIntersectsPlaylist: intersects(footer, rectOf('#playlistToggleBtn')),
        footerIntersectsLyrics: intersects(footer, rectOf('#lyricToggleBtn')),
        playerInsideViewport: within(player, viewportRect),
        playlistInsideViewport: within(rectOf('#playlistToggleBtn'), viewportRect),
        lyricsInsideViewport: within(rectOf('#lyricToggleBtn'), viewportRect),
        footerInsideViewport: within(footer, viewportRect),
        timeInsidePlayer: within(time, player),
        textInsideTime: within(text, time),
        textInsidePlayer: within(text, player)
      };
    });

    expect(geometry.playlist.width).toBeGreaterThan(0);
    expect(geometry.lyrics.width).toBeGreaterThan(0);
    expect(geometry.player.width).toBeGreaterThan(0);
    expect(geometry.playlistIntersectsPlayer).toBe(false);
    expect(geometry.lyricsIntersectsPlayer).toBe(false);
    expect(geometry.footerIntersectsPlayer).toBe(false);
    expect(geometry.footerIntersectsPlaylist).toBe(false);
    expect(geometry.footerIntersectsLyrics).toBe(false);
    expect(geometry.playerInsideViewport).toBe(true);
    expect(geometry.playlistInsideViewport).toBe(true);
    expect(geometry.lyricsInsideViewport).toBe(true);
    expect(geometry.footerInsideViewport).toBe(true);
    expect(geometry.timeInsidePlayer).toBe(true);
    expect(geometry.textInsideTime).toBe(true);
    expect(geometry.textInsidePlayer).toBe(true);
  });
}

for (const viewport of SHORT_LYRIC_VIEWPORTS) {
  test(`short lyric overlay stays clear of top-level controls at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');
    await page.setViewportSize(viewport);
    await waitForApp(page);
    await drawAndOpenLyrics(page);

    await page.locator('#lyricText').evaluate((lyric, lines) => {
      lyric.replaceChildren(...lines.map((text) => {
        const line = document.createElement('span');
        line.className = 'lyric-line';
        line.textContent = text;
        line.style.opacity = '1';
        line.style.transform = 'translateY(0) scale(1)';
        return line;
      }));
    }, SHORT_SCREEN_LYRIC_SAMPLE);

    const geometry = await page.evaluate(() => {
      const rectOf = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right
        };
      };
      const lyric = rectOf('#lyricText');
      const song = rectOf('#songName');
      return {
        content: {
          top: Math.min(lyric.top, song.top),
          bottom: Math.max(lyric.bottom, song.bottom),
          left: Math.min(lyric.left, song.left),
          right: Math.max(lyric.right, song.right)
        },
        close: rectOf('#lyricCloseBtn'),
        controls: rectOf('#dynamicIsland')
      };
    });

    expect(geometry.content.top).toBeGreaterThanOrEqual(geometry.close.bottom + 8);
    expect(geometry.content.bottom).toBeLessThanOrEqual(geometry.controls.top - 8);
  });
}

for (const viewport of AUDIO_ERROR_VIEWPORTS) {
  test(`audio error recovery stays visible at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');
    await page.setViewportSize(viewport);
    await waitForAppWithMediaFailure(page);

    await page.locator('#playButton').click();
    await expect(page.locator('body')).toHaveAttribute('data-audio-state', 'error', { timeout: 12_000 });
    await expect(page.locator('#audioStatus')).toBeVisible();
    await expect(page.locator('#audioRetry')).toBeEnabled();

    const geometry = await page.evaluate(() => {
      const rectOf = (selector) => {
        const rect = document.querySelector(selector).getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom
        };
      };
      const withinViewport = (rect) => (
        rect.left >= -1
        && rect.right <= window.innerWidth + 1
        && rect.top >= -1
        && rect.bottom <= window.innerHeight + 1
      );
      const intersects = (left, right, tolerance = 1) => (
        Math.min(left.right, right.right) - Math.max(left.left, right.left) > tolerance
        && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > tolerance
      );

      const status = rectOf('#audioStatus');
      const retry = rectOf('#audioRetry');
      const player = rectOf('#playerPill');
      const retryElement = document.querySelector('#audioRetry');
      const retryHit = document.elementFromPoint(
        (retry.left + retry.right) / 2,
        (retry.top + retry.bottom) / 2
      );

      return {
        statusInsideViewport: withinViewport(status),
        retryInsideViewport: withinViewport(retry),
        statusIntersectsPlayer: intersects(status, player),
        retryHit: retryHit === retryElement || retryElement.contains(retryHit)
      };
    });

    expect(geometry.statusInsideViewport).toBe(true);
    expect(geometry.retryInsideViewport).toBe(true);
    expect(geometry.statusIntersectsPlayer).toBe(false);
    expect(geometry.retryHit).toBe(true);
  });
}

test('draw and player controls stay hit-testable above lyrics and playlist overlays', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndOpenLyrics(page);

  for (const selector of ['#playButton', '#playerToggleBtn']) {
    expect(await hitTestControlCenter(page, selector), `${selector} above lyrics`).toMatchObject({ hit: true });
  }

  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  await expect(page.locator('#playlistToggleBtn')).toHaveClass(/is-visible/);
  await page.locator('#playlistToggleBtn').click();
  await expect(page.locator('#playlistArea')).toHaveClass(/is-visible/);
  await expect(page.locator('body')).toHaveClass(/has-playlist-overlay/);

  for (const selector of ['#playButton', '#playerToggleBtn']) {
    expect(await hitTestControlCenter(page, selector), `${selector} above playlist`).toMatchObject({ hit: true });
  }
});
