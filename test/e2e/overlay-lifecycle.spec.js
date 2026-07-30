import { test, expect } from '@playwright/test';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const DETERMINISTIC_COVER = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800" viewBox="0 0 600 800">
    <rect width="600" height="800" fill="#101722"/>
    <rect x="32" y="32" width="536" height="736" fill="#dceeff"/>
    <rect x="68" y="68" width="464" height="664" fill="#26394a"/>
  </svg>
`);

const installDeterministicCovers = async (page) => {
  const coverPaths = new Set(
    CRITICAL_IMAGE_MANIFEST.map(({ source }) => new URL(source).pathname)
  );

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (request.resourceType() !== 'image') return route.continue();
    if (!coverPaths.has(new URL(request.url()).pathname)) return route.continue();
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: DETERMINISTIC_COVER
    });
  });
};

const installDeterministicAudio = async (page) => {
  await page.addInitScript(() => {
    HTMLMediaElement.prototype.load = function load() {
      queueMicrotask(() => this.dispatchEvent(new Event('loadedmetadata')));
    };
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
  });
};

const waitForApp = async (page) => {
  await installDeterministicCovers(page);
  await installDeterministicAudio(page);
  await page.goto('./');
  await page.locator('#loadingSkip').click();
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
};

const drawAndOpenPlaylist = async (page) => {
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  await expect(page.locator('#playlistToggleBtn')).toHaveClass(/is-visible/);
  await page.locator('#playlistToggleBtn').click();
  await expect(page.locator('#playlistArea')).toHaveClass(/is-visible/);
  await page.waitForFunction(() => {
    const content = document.querySelector('#playlistContent');
    return Number.parseFloat(getComputedStyle(content).opacity) >= 0.99;
  });
  await page.waitForFunction(() => {
    const currentItem = document.querySelector('.playlist-item.is-current');
    return currentItem && Number.parseFloat(getComputedStyle(currentItem).opacity) >= 0.99;
  });
};

const accessibilityState = (page, selector) => page.locator(selector).evaluate((element) => ({
  inert: element.hasAttribute('inert'),
  ariaHidden: element.getAttribute('aria-hidden'),
  visible: element.classList.contains('is-visible'),
  opacity: getComputedStyle(element).opacity
}));

test('initially hidden player and overlays are absent from sequential focus', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);

  for (const selector of ['#playerPill', '#resultArea', '#playlistArea']) {
    await expect(page.locator(selector)).toHaveAttribute('inert', '');
    await expect(page.locator(selector)).toHaveAttribute('aria-hidden', 'true');
  }

  await page.locator('body').focus();
  const focusedIds = [];
  for (let index = 0; index < 8; index += 1) {
    await page.keyboard.press('Tab');
    focusedIds.push(await page.evaluate(() => document.activeElement?.id || ''));
  }
  expect(focusedIds).not.toContain('playerToggleBtn');
  expect(focusedIds).not.toContain('lyricCloseBtn');
  expect(focusedIds).not.toContain('playlistCloseBtn');
  expect(focusedIds).not.toContain('playlistModeSwitch');
});

test('compact playlist is prewarmed and fades in without an empty flash', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#playButton')).not.toHaveAttribute('data-busy', '', { timeout: 12_000 });
  await expect(page.locator('.playlist-item')).toHaveCount(142, { timeout: 5_000 });

  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  const itemCountBeforeOpen = await page.locator('.playlist-item').count();

  await page.evaluate(() => {
    const frames = [];
    window.__playlistOpenFrames = frames;
    window.__playlistOpenFramesDone = new Promise((resolve) => {
      const startedAt = performance.now();
      const sample = (now) => {
        const area = document.querySelector('#playlistArea');
        const content = document.querySelector('#playlistContent');
        frames.push({
          time: now - startedAt,
          visible: area.classList.contains('is-visible'),
          area: Number.parseFloat(getComputedStyle(area).opacity),
          content: Number.parseFloat(getComputedStyle(content).opacity),
          items: document.querySelectorAll('.playlist-item').length
        });
        if (now - startedAt >= 1200) resolve(frames);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });

  await page.locator('#playlistToggleBtn').click();
  const frames = await page.evaluate(() => window.__playlistOpenFramesDone);
  await expect(page.locator('#playlistArea')).toHaveClass(/is-visible/);
  await expect(page.locator('#playlistContent')).toHaveCSS('opacity', '1');

  expect(await page.locator('.playlist-item').count()).toBe(itemCountBeforeOpen);
  expect(frames.every(({ items }) => items === itemCountBeforeOpen)).toBe(true);
  const visibleFrames = frames.filter(({ visible }) => visible);
  const areaSamples = visibleFrames.map(({ area }) => area);
  const firstPositive = areaSamples.find((opacity) => opacity > 0.01);
  expect(firstPositive).toBeDefined();
  expect(firstPositive).toBeLessThan(0.95);
  expect(areaSamples.some((opacity) => opacity > 0.08 && opacity < 0.92)).toBe(true);
  for (let index = 1; index < areaSamples.length; index += 1) {
    expect(areaSamples[index] + 0.02).toBeGreaterThanOrEqual(areaSamples[index - 1]);
  }
  const composedFrames = visibleFrames.filter(({ area }) => area > 0.2 && area < 0.98);
  expect(composedFrames.length).toBeGreaterThan(0);
  const veilFrames = composedFrames.filter(({ area }) => area < 0.68);
  expect(veilFrames.some(({ area, content }) => content <= area * 0.45)).toBe(true);
  const handoffFrames = composedFrames.filter(({ area }) => area > 0.56);
  expect(handoffFrames.some(({ content }) => content > 0.12 && content < 0.95)).toBe(true);
});

test('primary 393x727 mobile composition keeps every lower rail separated', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.setViewportSize({ width: 393, height: 727 });
  await waitForApp(page);

  const initial = await page.evaluate(() => ({
    metadata: document.querySelector('#archiveTrackMeta').getBoundingClientRect().toJSON(),
    draw: document.querySelector('#playButton').getBoundingClientRect().toJSON(),
    vinyl: document.querySelector('#vinylRecord').getBoundingClientRect().toJSON()
  }));
  expect(initial.vinyl.bottom + 8).toBeLessThanOrEqual(initial.metadata.top);
  expect(initial.metadata.bottom + 24).toBeLessThanOrEqual(initial.draw.top);

  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#playButton')).not.toHaveAttribute('data-busy', '', { timeout: 12_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  await page.waitForFunction(() => Number.parseFloat(
    getComputedStyle(document.querySelector('#playerPill')).opacity
  ) >= 0.99);

  const settled = await page.evaluate(() => ({
    metadata: document.querySelector('#archiveTrackMeta').getBoundingClientRect().toJSON(),
    draw: document.querySelector('#playButton').getBoundingClientRect().toJSON(),
    player: document.querySelector('#playerPill').getBoundingClientRect().toJSON(),
    contact: document.querySelector('#contactLink').getBoundingClientRect().toJSON(),
    viewportHeight: innerHeight
  }));
  expect(settled.metadata.bottom + 24).toBeLessThanOrEqual(settled.draw.top);
  expect(settled.draw.bottom + 8).toBeLessThanOrEqual(settled.player.top);
  expect(settled.player.bottom + 10).toBeLessThanOrEqual(settled.contact.top);
  expect(settled.contact.bottom).toBeLessThanOrEqual(settled.viewportHeight - 8);
});

test('short compact viewport keeps fixed controls clear of metadata and playlist', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.setViewportSize({ width: 320, height: 568 });
  await waitForApp(page);

  const initialBounds = await page.evaluate(() => ({
    metadata: document.querySelector('#archiveTrackMeta').getBoundingClientRect().toJSON(),
    draw: document.querySelector('#playButton').getBoundingClientRect().toJSON(),
    vinyl: document.querySelector('#vinylRecord').getBoundingClientRect().toJSON(),
    header: document.querySelector('.header').getBoundingClientRect().toJSON(),
    headerRuleBottom: Number.parseFloat(
      getComputedStyle(document.querySelector('.header'), '::after').bottom
    )
  }));
  expect(initialBounds.metadata.bottom + 12).toBeLessThanOrEqual(initialBounds.draw.top);
  const headerLineBottom = initialBounds.header.bottom - initialBounds.headerRuleBottom;
  expect(headerLineBottom + 28).toBeLessThanOrEqual(initialBounds.vinyl.top);

  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#playButton')).not.toHaveAttribute('data-busy', '', { timeout: 12_000 });
  await expect(page.locator('.playlist-item')).toHaveCount(142, { timeout: 5_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  await page.locator('#playlistToggleBtn').click();
  await expect(page.locator('#playlistArea')).toHaveClass(/is-visible/);
  await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('#playlistContent')).opacity) >= 0.99);

  const overlayBounds = await page.evaluate(() => ({
    playlist: document.querySelector('#playlistContent').getBoundingClientRect().toJSON(),
    draw: document.querySelector('#playButton').getBoundingClientRect().toJSON(),
    player: document.querySelector('#playerPill').getBoundingClientRect().toJSON(),
    viewportHeight: innerHeight
  }));
  expect(overlayBounds.playlist.bottom + 12).toBeLessThanOrEqual(overlayBounds.draw.top);
  expect(overlayBounds.draw.bottom + 6).toBeLessThanOrEqual(overlayBounds.player.top);
  expect(overlayBounds.player.bottom + 12).toBeLessThanOrEqual(overlayBounds.viewportHeight);
});

test('mobile overlays keep glass controls and playlist content in separate safe regions', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForApp(page);

  const headerStageGap = await page.evaluate(() => {
    const header = document.querySelector('.header');
    const headerBounds = header.getBoundingClientRect();
    const lineBottom = headerBounds.bottom - Number.parseFloat(
      getComputedStyle(header, '::after').bottom
    );
    return {
      lineBottom,
      vinylTop: document.querySelector('#vinylRecord').getBoundingClientRect().top
    };
  });
  expect(headerStageGap.lineBottom + 28).toBeLessThanOrEqual(headerStageGap.vinylTop);

  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#playButton')).not.toHaveAttribute('data-busy', '', { timeout: 12_000 });

  const lyricCloseMaterial = await page.locator('#lyricCloseBtn').evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      backdropFilter: style.backdropFilter || style.webkitBackdropFilter,
      boxShadow: style.boxShadow,
      focusVisible: button.matches(':focus-visible')
    };
  });
  expect(lyricCloseMaterial.backdropFilter).toBe('none');
  expect(lyricCloseMaterial.boxShadow).not.toContain('0px 0px 0px 1px');
  expect(lyricCloseMaterial.outlineStyle === 'none' || lyricCloseMaterial.outlineWidth === '0px')
    .toBe(true);

  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  await page.locator('#playlistToggleBtn').click();
  await expect(page.locator('#playlistArea')).toHaveClass(/is-visible/);
  await page.waitForFunction(() => Number.parseFloat(
    getComputedStyle(document.querySelector('#playlistContent')).opacity
  ) >= 0.99);

  const geometry = await page.evaluate(() => {
    const playlist = document.querySelector('#playlistContent').getBoundingClientRect();
    const list = document.querySelector('#playlistList');
    const draw = document.querySelector('#playButton').getBoundingClientRect();
    const player = document.querySelector('#playerPill').getBoundingClientRect();
    const closeStyle = getComputedStyle(document.querySelector('#playlistCloseBtn'));
    const controlStyles = Object.fromEntries([
      '#playButton',
      '#playerToggleBtn',
      '#playlistToggleBtn',
      '#lyricToggleBtn',
      '#playlistCloseBtn',
      '#playlistModeSwitch'
    ].map((selector) => {
      const style = getComputedStyle(document.querySelector(selector));
      return [selector, style.backdropFilter || style.webkitBackdropFilter];
    }));
    return {
      playlist: playlist.toJSON(),
      draw: draw.toJSON(),
      player: player.toJSON(),
      listScrollsInternally: list.scrollHeight > list.clientHeight,
      listOverflowY: getComputedStyle(list).overflowY,
      closeOutline: `${closeStyle.outlineStyle} ${closeStyle.outlineWidth}`,
      controlStyles
    };
  });

  expect(geometry.playlist.bottom + 20).toBeLessThanOrEqual(geometry.draw.top);
  expect(geometry.draw.bottom + 6).toBeLessThanOrEqual(geometry.player.top);
  expect(geometry.listScrollsInternally).toBe(true);
  expect(geometry.listOverflowY).toBe('auto');
  for (const selector of ['#playButton', '#playlistToggleBtn', '#lyricToggleBtn']) {
    expect(geometry.controlStyles[selector]).toContain('blur(16px)');
  }
  for (const selector of ['#playerToggleBtn', '#playlistCloseBtn', '#playlistModeSwitch']) {
    expect(geometry.controlStyles[selector]).toBe('none');
  }
});

test('short wide viewports keep playlist content above the fixed control rail', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.setViewportSize({ width: 1280, height: 640 });
  await waitForApp(page);
  await drawAndOpenPlaylist(page);

  const readGeometry = () => page.evaluate(() => {
    const playlist = document.querySelector('#playlistContent').getBoundingClientRect();
    const controls = [
      document.querySelector('#playButton'),
      document.querySelector('#playerPill'),
      document.querySelector('#playlistToggleBtn'),
      document.querySelector('#lyricToggleBtn')
    ].map((element) => ({
      rect: element.getBoundingClientRect().toJSON(),
      opacity: Number.parseFloat(getComputedStyle(element).opacity) || 0
    })).filter(({ rect, opacity }) => rect.width > 0 && rect.height > 0 && opacity > 0.05);
    return {
      playlist: playlist.toJSON(),
      controlsTop: Math.min(...controls.map(({ rect }) => rect.top)),
      viewport: { width: innerWidth, height: innerHeight }
    };
  });

  for (const viewport of [
    { width: 1280, height: 640 },
    { width: 844, height: 390 }
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const geometry = await readGeometry();
    expect(geometry.viewport).toEqual(viewport);
    expect(geometry.playlist.bottom + 10).toBeLessThanOrEqual(geometry.controlsTop);
    expect(geometry.playlist.top).toBeGreaterThanOrEqual(48);
  }
});

test('desktop playlist material begins revealing with the backdrop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#playButton')).not.toHaveAttribute('data-busy', '', { timeout: 12_000 });
  await expect(page.locator('.playlist-item')).toHaveCount(142, { timeout: 5_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);

  await page.evaluate(() => {
    const frames = [];
    window.__desktopPlaylistOpenFrames = frames;
    window.__desktopPlaylistOpenFramesDone = new Promise((resolve) => {
      const startedAt = performance.now();
      const sample = (now) => {
        const area = document.querySelector('#playlistArea');
        const content = document.querySelector('#playlistContent');
        frames.push({
          time: now - startedAt,
          active: document.body.classList.contains('has-playlist-overlay'),
          area: Number.parseFloat(getComputedStyle(area).opacity),
          content: Number.parseFloat(getComputedStyle(content).opacity)
        });
        if (now - startedAt >= 360) resolve(frames);
        else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    });
  });

  await page.locator('#playlistToggleBtn').dispatchEvent('click');
  const frames = await page.evaluate(() => window.__desktopPlaylistOpenFramesDone);
  const activeFrames = frames.filter(({ active }) => active);
  expect(activeFrames.length).toBeGreaterThan(0);
  const firstActiveTime = activeFrames[0].time;
  const openingWindow = activeFrames.filter(({ time }) => time - firstActiveTime <= 80);
  const peakArea = Math.max(...openingWindow.map(({ area }) => area));
  const peakContent = Math.max(...openingWindow.map(({ content }) => content));
  expect(peakArea).toBeGreaterThan(0.12);
  expect(peakContent).toBeGreaterThan(0.08);
});

test('direct playback interruption settles an opening overlay fully open', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);

  await page.locator('#lyricToggleBtn').click();
  await page.waitForTimeout(40);
  await page.locator('#playerToggleBtn').click();

  await expect.poll(() => accessibilityState(page, '#resultArea')).toEqual({
    inert: false,
    ariaHidden: null,
    visible: true,
    opacity: '1'
  });
  await expect(page.locator('body')).toHaveClass(/has-lyric-overlay/);
});

test('direct playback interruption settles a closing overlay fully closed', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });

  await page.locator('#lyricCloseBtn').click({ noWaitAfter: true });
  await page.waitForTimeout(40);
  await page.locator('#playerToggleBtn').click();

  await expect.poll(() => accessibilityState(page, '#resultArea')).toEqual({
    inert: true,
    ariaHidden: 'true',
    visible: false,
    opacity: '0'
  });
  await expect(page.locator('body')).not.toHaveClass(/has-lyric-overlay/);
  const centerIsBlocked = await page.evaluate(() => Boolean(
    document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)?.closest('#resultArea')
  ));
  expect(centerIsBlocked).toBe(false);
});

test('normal overlay close restores focus to its launcher', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);

  await page.locator('#lyricToggleBtn').click();
  await expect(page.locator('#lyricCloseBtn')).toBeFocused();
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#lyricToggleBtn')).toBeFocused();
});

test('lyrics are primed hidden before the visible class exposes the overlay', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);

  await page.evaluate(() => {
    const area = document.querySelector('#resultArea');
    window.__lyricExposureState = null;
    const observer = new MutationObserver(() => {
      if (!area.classList.contains('is-visible') || window.__lyricExposureState) return;
      const lyric = document.querySelector('#lyricText');
      const song = document.querySelector('#songName');
      const line = lyric.querySelector('.lyric-line');
      window.__lyricExposureState = {
        areaOpacity: area.style.opacity,
        areaTransform: area.style.transform,
        lyricOpacity: lyric.style.opacity,
        lyricTransform: lyric.style.transform,
        lyricFilter: lyric.style.filter,
        lyricHasFeather: lyric.style.maskImage.includes('linear-gradient'),
        lyricMaskPosition: lyric.style.maskPosition,
        lyricMaskSize: lyric.style.maskSize,
        songOpacity: song.style.opacity,
        songTransform: song.style.transform,
        songHasFeather: song.style.maskImage.includes('linear-gradient'),
        lineOpacity: line?.style.opacity || '',
        lineFilter: line?.style.filter || '',
        lineTransform: line?.style.transform || '',
        lineHasFeather: line?.style.maskImage.includes('linear-gradient') || false,
        inert: area.hasAttribute('inert'),
        ariaHidden: area.getAttribute('aria-hidden')
      };
      observer.disconnect();
    });
    observer.observe(area, { attributes: true, attributeFilter: ['class'] });
  });

  await page.locator('#lyricToggleBtn').click();
  await expect.poll(() => page.evaluate(() => window.__lyricExposureState)).not.toBeNull();
  expect(await page.evaluate(() => window.__lyricExposureState)).toEqual({
    areaOpacity: '0',
    areaTransform: 'translate3d(0px, 0px, 0px)',
    lyricOpacity: '0.08',
    lyricTransform: 'translateY(22px) scaleX(0.94) scaleY(1.035)',
    lyricFilter: 'blur(14px)',
    lyricHasFeather: true,
    lyricMaskPosition: '0% 70%',
    lyricMaskSize: '100% 300%',
    songOpacity: '0',
    songTransform: 'translateY(14px) scaleX(0.965) scaleY(1.022)',
    songHasFeather: true,
    lineOpacity: '1',
    lineFilter: 'none',
    lineTransform: 'none',
    lineHasFeather: false,
    inert: false,
    ariaHidden: null
  });
  await expect.poll(() => accessibilityState(page, '#resultArea')).toEqual({
    inert: false,
    ariaHidden: null,
    visible: true,
    opacity: '1'
  });
});

test('lyrics reveal as one feathered block without per-line staggering', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'mobile-chromium'].includes(testInfo.project.name));
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);

  await page.locator('#lyricToggleBtn').click();
  await page.waitForFunction(() => document.querySelector('#lyricText')?.getAnimations().some(
    (animation) => animation.effect?.getKeyframes?.().some(({ transform }) => (
      `${transform}`.includes('scaleX(0.94)')
    ))
  ));

  const opening = await page.evaluate(() => {
    const area = document.querySelector('#resultArea');
    const lyric = document.querySelector('#lyricText');
    const song = document.querySelector('#songName');
    const areaFrames = area.getAnimations().flatMap((animation) => (
      animation.effect?.getKeyframes?.() || []
    ));
    const describeReveal = (element) => {
      const animation = element.getAnimations().find((candidate) => (
        candidate.effect.getKeyframes().some(({ filter }) => `${filter}`.includes('blur('))
      ));
      const timing = animation.effect.getTiming();
      const keyframes = animation.effect.getKeyframes();
      const style = getComputedStyle(element);
      return {
        delay: Number(timing.delay || 0),
        duration: Number(timing.duration || 0),
        filters: keyframes.map(({ filter }) => filter || ''),
        transforms: keyframes.map(({ transform }) => transform || ''),
        maskPositions: keyframes.map(({ maskPosition }) => maskPosition || ''),
        maskSizes: keyframes.map(({ maskSize }) => maskSize || ''),
        clips: keyframes.map(({ clipPath }) => clipPath || ''),
        hasFeather: [
          style.maskImage,
          style.webkitMaskImage,
          element.style.maskImage,
          element.style.webkitMaskImage
        ].some((value) => value && value !== 'none')
      };
    };
    const lines = Array.from(document.querySelectorAll('#lyricText .lyric-line'));
    return {
      profile: document.documentElement.dataset.motionProfile,
      areaClips: areaFrames.map(({ clipPath }) => clipPath || ''),
      lyricReveal: describeReveal(lyric),
      songReveal: describeReveal(song),
      lineAnimationCount: lines.reduce((count, line) => count + line.getAnimations().length, 0),
      lineStates: lines.map((line) => ({
        opacity: getComputedStyle(line).opacity,
        maskImage: line.style.maskImage
      }))
    };
  });

  expect(opening.areaClips.every((clip) => clip === '')).toBe(true);
  const expectedBlockDelay = opening.profile === 'full' ? 100 : 120;
  const expectedBlockDuration = opening.profile === 'full' ? 840 : 1120;
  const expectedSongDuration = Math.round(expectedBlockDuration * 0.7);
  const expectedSongDelay = expectedBlockDelay + Math.round(expectedBlockDuration * 0.3);
  for (const [label, reveal, delay, duration, maskPositions] of [
    ['lyric block', opening.lyricReveal, expectedBlockDelay, expectedBlockDuration, [70, 46, 14, 0]],
    ['song name', opening.songReveal, expectedSongDelay, expectedSongDuration, [70, 14, 0]]
  ]) {
    expect(Math.abs(reveal.delay - delay), `${label} delay`).toBeLessThanOrEqual(1);
    expect(Math.abs(reveal.duration - duration), `${label} duration`).toBeLessThanOrEqual(1);
    expect(reveal.filters.at(-1), `${label} settles sharp`).toBe('blur(0px)');
    expect(reveal.transforms.at(-1), `${label} settles in place`).toMatch(/translateY\(0(?:px)?\)/);
    expect(reveal.maskPositions[0], `${label} starts with only the leading edge exposed`).toBe('0% 70%');
    expect(reveal.maskPositions.at(-1), `${label} clears feather continuously`).toBe('0% 0%');
    expect(
      reveal.maskPositions.map((position) => Number.parseFloat(position.split(' ')[1]))
    ).toEqual(maskPositions);
    expect(reveal.clips.every((clip) => clip === ''), `${label} has no hard clip`).toBe(true);
    expect(reveal.hasFeather, `${label} has a feather mask while moving`).toBe(true);
  }
  expect(opening.lyricReveal.filters[0]).toBe('blur(14px)');
  expect(opening.lyricReveal.transforms[0]).toContain('scaleX(0.94)');
  expect(opening.songReveal.filters[0]).toBe('blur(10px)');
  expect(opening.lineAnimationCount).toBe(0);
  expect(opening.lineStates.every(({ opacity, maskImage }) => (
    opacity === '1' && maskImage === ''
  ))).toBe(true);

  await page.waitForFunction(() => {
    const lyric = document.querySelector('#lyricText');
    const song = document.querySelector('#songName');
    return !lyric?.hasAttribute('data-motion-active')
      && !song?.hasAttribute('data-motion-active')
      && lyric?.style.maskImage === ''
      && song?.style.maskImage === ''
      && getComputedStyle(lyric).opacity === '1';
  });

  await page.locator('#lyricCloseBtn').dispatchEvent('click');
  await page.waitForFunction(() => document.querySelector('#resultArea')?.getAnimations().some((animation) => {
    const frames = animation.effect?.getKeyframes?.() || [];
    return Number(frames[0]?.opacity) === 1 && Number(frames.at(-1)?.opacity) === 0;
  }));
  const closingClips = await page.locator('#resultArea').evaluate((area) => (
    area.getAnimations().flatMap((animation) => (
      animation.effect?.getKeyframes?.().map(({ clipPath }) => clipPath || '') || []
    ))
  ));
  expect(closingClips.every((clip) => clip === '')).toBe(true);

  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  const residue = await page.evaluate(() => ({
    areaClip: document.querySelector('#resultArea').style.clipPath,
    lyricClip: document.querySelector('#lyricText').style.clipPath,
    lyricMask: document.querySelector('#lyricText').style.maskImage,
    lineStyles: Array.from(document.querySelectorAll('#lyricText .lyric-line')).map((line) => ({
      opacity: line.style.opacity,
      transform: line.style.transform,
      filter: line.style.filter,
      clipPath: line.style.clipPath,
      maskImage: line.style.maskImage
    }))
  }));
  expect(residue).toEqual({
    areaClip: '',
    lyricClip: '',
    lyricMask: '',
    lineStyles: expect.arrayContaining([
      { opacity: '', transform: '', filter: '', clipPath: '', maskImage: '' }
    ])
  });
});

test('playlist selection closes the playlist and opens the selected track lyrics', async ({ page }) => {
  await waitForApp(page);
  await drawAndOpenPlaylist(page);

  const target = page.locator('.playlist-item:not(.is-current)').first();
  const selected = await target.evaluate((item) => ({
    index: item.dataset.index,
    song: item.querySelector('.playlist-song')?.textContent?.trim() || ''
  }));
  await target.click();

  await expect(page.locator('#playlistArea')).not.toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await expect(page.locator('body')).toHaveClass(/has-lyric-overlay/);
  await expect(page.locator('body')).not.toHaveClass(/has-playlist-overlay/);
  await expect(page.locator(`.playlist-item[data-index="${selected.index}"]`)).toHaveClass(/is-current/);
  await expect(page.locator('#songName')).toContainText(selected.song);
  await expect.poll(() => accessibilityState(page, '#playlistArea')).toEqual({
    inert: true,
    ariaHidden: 'true',
    visible: false,
    opacity: '0'
  });
  await expect.poll(() => accessibilityState(page, '#resultArea')).toEqual({
    inert: false,
    ariaHidden: null,
    visible: true,
    opacity: '1'
  });
  await expect(page.locator('#lyricCloseBtn')).toBeFocused();
});

test('overlay supersession keeps one focus-safe interactive layer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndOpenPlaylist(page);

  const hiddenControls = await page.locator('#lyricToggleBtn, #playlistToggleBtn').evaluateAll((controls) => (
    controls.map((control) => ({
      id: control.id,
      tabIndex: control.tabIndex,
      ariaHidden: control.getAttribute('aria-hidden')
    }))
  ));
  expect(hiddenControls).toEqual([
    { id: 'playlistToggleBtn', tabIndex: -1, ariaHidden: 'true' },
    { id: 'lyricToggleBtn', tabIndex: -1, ariaHidden: 'true' }
  ]);

  await page.locator('#lyricToggleBtn').evaluate((control) => control.click());
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/);
  await expect(page.locator('#playlistArea')).not.toHaveClass(/is-visible/);
  await expect(page.locator('body')).toHaveClass(/has-lyric-overlay/);
  await expect(page.locator('body')).not.toHaveClass(/has-playlist-overlay/);

  const center = await page.evaluate(() => {
    const target = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return {
      id: target?.id || '',
      insidePlaylist: Boolean(target?.closest('#playlistArea'))
    };
  });
  expect(center.insidePlaylist).toBe(false);
});

test('playlist close starts from its rendered rest position', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await waitForApp(page);
  await drawAndOpenPlaylist(page);

  const before = await page.locator('#playlistContent').evaluate((content) => ({
    top: content.getBoundingClientRect().top,
    transform: getComputedStyle(content).transform
  }));
  await page.locator('#playlistCloseBtn').dispatchEvent('click');
  const firstFrame = await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => {
      const content = document.querySelector('#playlistContent');
      resolve({
        top: content.getBoundingClientRect().top,
        transform: getComputedStyle(content).transform
      });
    });
  }));

  expect(before.transform).not.toBe('none');
  expect(firstFrame.transform).not.toBe('none');
  expect(Math.abs(firstFrame.top - before.top)).toBeLessThanOrEqual(2);
});
