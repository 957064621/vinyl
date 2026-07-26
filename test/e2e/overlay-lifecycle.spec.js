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
    HTMLMediaElement.prototype.load = function load() {};
    HTMLMediaElement.prototype.play = function play() {
      return Promise.resolve();
    };
  });
};

const waitForApp = async (page) => {
  await installDeterministicCovers(page);
  await installDeterministicAudio(page);
  await page.goto('./');
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
        songOpacity: song.style.opacity,
        lineOpacity: line?.style.opacity || '',
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
    areaTransform: 'translateY(8px)',
    lyricOpacity: '0',
    lyricTransform: 'translateY(16px) scale(0.995)',
    songOpacity: '0',
    lineOpacity: '0',
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
