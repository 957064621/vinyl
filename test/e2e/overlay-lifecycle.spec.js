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
        if (now - startedAt >= 720) resolve(frames);
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
  expect(composedFrames.every(({ content }) => content > 0.01)).toBe(true);
});

test('short compact viewport keeps fixed controls clear of metadata and playlist', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.setViewportSize({ width: 320, height: 568 });
  await waitForApp(page);

  const initialBounds = await page.evaluate(() => ({
    metadata: document.querySelector('#archiveTrackMeta').getBoundingClientRect().toJSON(),
    draw: document.querySelector('#playButton').getBoundingClientRect().toJSON()
  }));
  expect(initialBounds.metadata.bottom + 12).toBeLessThanOrEqual(initialBounds.draw.top);

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
        songOpacity: song.style.opacity,
        lineOpacity: line?.style.opacity || '',
        lineFilter: line?.style.filter || '',
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
    areaTransform: 'translate3d(0, 0, 0) scale(0.985)',
    lyricOpacity: '0',
    lyricTransform: 'translateY(18px) scaleY(0.78) scaleX(0.985)',
    lyricFilter: 'blur(14px)',
    songOpacity: '0',
    lineOpacity: '0',
    lineFilter: 'blur(14px)',
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

test('lyrics reveal from the live vinyl center and retract without transition residue', async ({ page }, testInfo) => {
  test.skip(!['desktop-chromium', 'mobile-chromium'].includes(testInfo.project.name));
  await waitForApp(page);
  await page.locator('#playButton').click();
  await expect(page.locator('#resultArea')).toHaveClass(/is-visible/, { timeout: 12_000 });
  await page.locator('#lyricCloseBtn').click();
  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);

  await page.locator('#lyricToggleBtn').click();
  await page.waitForFunction(() => document.querySelector('#resultArea')?.getAnimations().some((animation) => (
    animation.effect?.getKeyframes?.().some(({ clipPath }) => `${clipPath}`.startsWith('circle(0%'))
  )));

  const opening = await page.evaluate(() => {
    const area = document.querySelector('#resultArea');
    const vinyl = document.querySelector('#vinylRecord');
    const areaRect = area.getBoundingClientRect();
    const vinylRect = vinyl.getBoundingClientRect();
    const animation = area.getAnimations().find((candidate) => (
      candidate.effect?.getKeyframes?.().some(({ clipPath }) => `${clipPath}`.startsWith('circle(0%'))
    ));
    const lineTimings = Array.from(document.querySelectorAll('#lyricText .lyric-line'))
      .map((line) => line.getAnimations().map((candidate) => {
        const timing = candidate.effect.getTiming();
        const keyframes = candidate.effect.getKeyframes();
        return {
          delay: Number(timing.delay || 0),
          duration: Number(timing.duration || 0),
          filters: keyframes.map(({ filter }) => filter || ''),
          clips: keyframes.map(({ clipPath }) => clipPath || '')
        };
      }).find(({ filters }) => filters.some((filter) => filter.includes('blur('))))
      .filter(Boolean);
    return {
      profile: document.documentElement.dataset.motionProfile,
      originX: Number.parseFloat(area.style.getPropertyValue('--overlay-origin-x')),
      originY: Number.parseFloat(area.style.getPropertyValue('--overlay-origin-y')),
      expectedX: ((vinylRect.left + vinylRect.width / 2 - areaRect.left) / areaRect.width) * 100,
      expectedY: ((vinylRect.top + vinylRect.height / 2 - areaRect.top) / areaRect.height) * 100,
      areaWidth: areaRect.width,
      areaHeight: areaRect.height,
      frames: animation.effect.getKeyframes().map(({ clipPath }) => clipPath),
      lineTimings
    };
  });

  const originErrorPx = Math.hypot(
    ((opening.originX - opening.expectedX) / 100) * opening.areaWidth,
    ((opening.originY - opening.expectedY) / 100) * opening.areaHeight
  );
  expect(originErrorPx).toBeLessThanOrEqual(2.5);
  expect(opening.frames[0]).toContain('circle(0%');
  expect(opening.frames.at(-1)).toContain('circle(150%');
  expect(opening.lineTimings.length).toBeGreaterThan(1);
  const expectedLineDelay = opening.profile === 'full' ? 110 : 84;
  const expectedLineDuration = opening.profile === 'full' ? 580 : 460;
  const delays = opening.lineTimings.map(({ delay }) => delay);
  expect(delays.slice(1).every((delay, index) => (
    Math.abs((delay - delays[index]) - expectedLineDelay) <= 1
  ))).toBe(true);
  expect(opening.lineTimings.every(({ duration, filters, clips }) => (
    Math.abs(duration - expectedLineDuration) <= 1
    && filters[0] === 'blur(14px)'
    && filters.at(-1) === 'blur(0px)'
    && clips.every((clip) => clip === '')
  ))).toBe(true);

  await expect.poll(() => accessibilityState(page, '#resultArea')).toEqual({
    inert: false,
    ariaHidden: null,
    visible: true,
    opacity: '1'
  });
  await page.locator('#lyricCloseBtn').click({ noWaitAfter: true });
  await page.waitForFunction(() => document.querySelector('#resultArea')?.getAnimations().some((animation) => {
    const frames = animation.effect?.getKeyframes?.() || [];
    return `${frames.at(-1)?.clipPath}`.startsWith('circle(0%');
  }));

  const closingFrames = await page.locator('#resultArea').evaluate((area) => (
    area.getAnimations()
      .find((animation) => `${animation.effect?.getKeyframes?.().at(-1)?.clipPath}`.startsWith('circle(0%'))
      .effect.getKeyframes()
      .map(({ clipPath }) => clipPath)
  ));
  expect(closingFrames[0]).toContain('circle(150%');
  expect(closingFrames.at(-1)).toContain('circle(0%');

  await expect(page.locator('#resultArea')).not.toHaveClass(/is-visible/);
  const residue = await page.evaluate(() => ({
    areaClip: document.querySelector('#resultArea').style.clipPath,
    lyricClip: document.querySelector('#lyricText').style.clipPath,
    originX: document.querySelector('#resultArea').style.getPropertyValue('--overlay-origin-x'),
    originY: document.querySelector('#resultArea').style.getPropertyValue('--overlay-origin-y'),
    lineStyles: Array.from(document.querySelectorAll('#lyricText .lyric-line')).map((line) => ({
      opacity: line.style.opacity,
      transform: line.style.transform,
      filter: line.style.filter,
      clipPath: line.style.clipPath
    }))
  }));
  expect(residue).toEqual({
    areaClip: '',
    lyricClip: '',
    originX: '',
    originY: '',
    lineStyles: expect.arrayContaining([
      { opacity: '', transform: '', filter: '', clipPath: '' }
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
