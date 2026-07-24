import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { CRITICAL_IMAGE_MANIFEST } from '../../src/config/assets.js';

const PROFILES = Object.freeze({
  desktop: {
    width: '136px',
    height: '48px',
    fontSize: '15px',
    letterSpacing: '1.35px',
    islandWidth: '438px',
    duration: 7200,
    orbit: 'btn-perimeter-orbit-full',
    fade: 'btn-perimeter-fade-full'
  },
  mobile: {
    width: '106px',
    height: '46px',
    fontSize: '13px',
    letterSpacing: '1.17px',
    islandWidth: '306px',
    duration: 9600,
    orbit: 'btn-perimeter-orbit-compact',
    fade: 'btn-perimeter-fade-compact'
  }
});
const LOCKED_SHARED_STYLE = Object.freeze({
  borderRadius: '999px',
  padding: '0px',
  margin: '0px',
  fontFamily: 'Manrope, "SF Pro Display", "PingFang SC", "Microsoft YaHei", sans-serif',
  fontWeight: '500',
  backgroundColor: 'rgba(12, 18, 29, 0.44)',
  backdropFilter: 'blur(12px) saturate(1.36)',
  border: '1px solid rgba(224, 239, 255, 0.18)'
});
const PRE_FLOW_LOCK_PROPERTIES = Object.freeze({
  button: ['width', 'height', 'border-radius', 'padding', 'margin', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'background-image', 'background-color', 'backdrop-filter', 'border', 'box-shadow', 'transform'],
  surface: ['content', 'inset', 'border-radius', 'background-image', 'background-color', 'opacity', 'transform', 'filter', 'box-shadow'],
  island: ['width', 'height', 'min-height', 'grid-template-columns', 'background-image', 'background-color', 'backdrop-filter', 'border', 'box-shadow', 'transform'],
  labelViewport: ['width', 'height', 'overflow', 'transform'],
  label: ['font-family', 'font-size', 'font-weight', 'letter-spacing', 'color', 'opacity', 'filter', 'transform'],
  sheen: ['content', 'inset', 'border-radius', 'background-image', 'opacity', 'transform', 'filter', 'animation-name', 'animation-duration', 'animation-timing-function']
});
const PRE_FLOW_GOLDEN_SHA256 = Object.freeze({
  desktop: Object.freeze({
    idle: '1153c3af18eb8abab6e9b7231af2219fe5a33b9407b8ab68716e4c431a526158',
    hover: '5f992bb63ac9a46beb26c076df90aa1832dc27930cd50a332e7e3317ffcf570c',
    active: '7c7f135cf33a5dd3ed58a94c92453de2e6cfba0c0e8cb992ad3ea9e14fd7f96f',
    busy: '1153c3af18eb8abab6e9b7231af2219fe5a33b9407b8ab68716e4c431a526158',
    'lyric-overlay': '1153c3af18eb8abab6e9b7231af2219fe5a33b9407b8ab68716e4c431a526158',
    'playlist-overlay': '1153c3af18eb8abab6e9b7231af2219fe5a33b9407b8ab68716e4c431a526158',
    split: '2b4646586dc21d587aa9a72a1fe2b7e81b883a07bc9859482c5c9285cfab4d06',
    collapsing: '6cb374868712cda95546e914e0c4f959397efbc6aa3d88a212893b93e7481881',
    loading: '1153c3af18eb8abab6e9b7231af2219fe5a33b9407b8ab68716e4c431a526158'
  }),
  mobile: Object.freeze({
    idle: '3f2b1fa0213a332a9ffe954cb6b1487bd8d740a47ec40de13a210f7c7168f439',
    hover: '3f2b1fa0213a332a9ffe954cb6b1487bd8d740a47ec40de13a210f7c7168f439',
    active: 'ca903782aa28d9236f0ba8362a53b5866e7d9393b5acff60948ec9051a403192',
    busy: '3f2b1fa0213a332a9ffe954cb6b1487bd8d740a47ec40de13a210f7c7168f439',
    'lyric-overlay': '3f2b1fa0213a332a9ffe954cb6b1487bd8d740a47ec40de13a210f7c7168f439',
    'playlist-overlay': '3f2b1fa0213a332a9ffe954cb6b1487bd8d740a47ec40de13a210f7c7168f439',
    split: '3a3caf299a14e33dfa886256d61891a0ff25eea73d585b07c3bb483dceb0e689',
    collapsing: 'ee42bb14cfa0064d63bc332df032f7a0f3e55fbbdb7bd3b07e21307176fbc9e1',
    loading: '3f2b1fa0213a332a9ffe954cb6b1487bd8d740a47ec40de13a210f7c7168f439'
  }),
  reduce: Object.freeze({
    idle: '07eb3a5f5158bdcd1e4ba4fdcd003c9dc85b485996af6d57f8c60269e1515036',
    hover: '07eb3a5f5158bdcd1e4ba4fdcd003c9dc85b485996af6d57f8c60269e1515036',
    active: '72f3e07e5125af7a6d33993965c8f103078b3babc2948ac45aa7e8bc3824c952',
    busy: '07eb3a5f5158bdcd1e4ba4fdcd003c9dc85b485996af6d57f8c60269e1515036',
    'lyric-overlay': '07eb3a5f5158bdcd1e4ba4fdcd003c9dc85b485996af6d57f8c60269e1515036',
    'playlist-overlay': '07eb3a5f5158bdcd1e4ba4fdcd003c9dc85b485996af6d57f8c60269e1515036',
    split: 'c0222000b5bcfe699bbd5da14d9e42e04fd2da791ad1c351d9a9e57abf72c794',
    collapsing: '07eb3a5f5158bdcd1e4ba4fdcd003c9dc85b485996af6d57f8c60269e1515036',
    loading: '07eb3a5f5158bdcd1e4ba4fdcd003c9dc85b485996af6d57f8c60269e1515036'
  })
});
const DETERMINISTIC_COVER = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="600" height="800">
    <rect width="600" height="800" fill="#101722"/>
    <rect x="36" y="36" width="528" height="728" fill="#b7ddff"/>
  </svg>
`);

const installCovers = async (page, { hold = false } = {}) => {
  const paths = new Set(CRITICAL_IMAGE_MANIFEST.map(({ source }) => new URL(source).pathname));
  let release;
  const held = hold ? new Promise((resolve) => { release = resolve; }) : Promise.resolve();
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'image') return route.continue();
    const pathname = new URL(route.request().url()).pathname;
    if (!paths.has(pathname)) return route.abort('blockedbyclient');
    await held;
    return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: DETERMINISTIC_COVER });
  });
  return release;
};

const waitForApp = async (page) => {
  await installCovers(page);
  await page.goto('./');
  await expect(page.locator('#loadingScreen')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('#appRoot')).not.toHaveAttribute('inert', '');
};

const getSummaryMetrics = (page) => page.locator('#playButton').evaluate((button) => {
  const style = getComputedStyle(button);
  const island = getComputedStyle(document.querySelector('#dynamicIsland'));
  const rect = button.getBoundingClientRect();
  return {
    rect: { width: rect.width, height: rect.height },
    style: Object.fromEntries([
      'width', 'height', 'borderRadius', 'padding', 'margin', 'fontFamily', 'fontSize',
      'fontWeight', 'letterSpacing', 'backgroundImage', 'backgroundColor',
      'backdropFilter', 'border', 'boxShadow', 'transform'
    ].map((property) => [property, style[property]])),
    island: Object.fromEntries(['width', 'height', 'minHeight'].map((property) => [property, island[property]]))
  };
});

const getCompleteLock = (page) => page.locator('#playButton').evaluate((button) => {
  const serialize = (style) => Object.fromEntries(Array.from(style, (property) => [
    property,
    style.getPropertyValue(property)
  ]));
  const rect = (node) => {
    const box = node.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height };
  };
  const island = document.querySelector('#dynamicIsland');
  const labelViewport = document.querySelector('#btnLabelViewport');
  const label = document.querySelector('#btnText');
  const sheen = document.querySelector('.btn-sheen');
  return {
    rects: {
      button: rect(button),
      island: rect(island),
      labelViewport: rect(labelViewport),
      label: rect(label)
    },
    button: serialize(getComputedStyle(button)),
    buttonBefore: serialize(getComputedStyle(button, '::before')),
    buttonAfter: serialize(getComputedStyle(button, '::after')),
    island: serialize(getComputedStyle(island)),
    islandBefore: serialize(getComputedStyle(island, '::before')),
    islandAfter: serialize(getComputedStyle(island, '::after')),
    labelViewport: serialize(getComputedStyle(labelViewport)),
    label: serialize(getComputedStyle(label)),
    existingSheenAfter: serialize(getComputedStyle(sheen, '::after'))
  };
});

const getPreFlowGoldenLock = (page) => page.locator('#playButton').evaluate((button, propertyGroups) => {
  const take = (style, keys) => Object.fromEntries(keys.map((key) => [key, style.getPropertyValue(key)]));
  const rect = (node) => {
    const value = node.getBoundingClientRect();
    return Object.fromEntries(['x', 'y', 'width', 'height'].map((key) => [
      key,
      Math.round(value[key] * 100) / 100
    ]));
  };
  const island = document.querySelector('#dynamicIsland');
  const labelViewport = document.querySelector('#btnLabelViewport');
  const label = document.querySelector('#btnText');
  const sheen = document.querySelector('.btn-sheen');
  return {
    rects: {
      button: rect(button),
      island: rect(island),
      labelViewport: rect(labelViewport),
      label: rect(label)
    },
    button: take(getComputedStyle(button), propertyGroups.button),
    buttonBefore: take(getComputedStyle(button, '::before'), propertyGroups.surface),
    buttonAfter: take(getComputedStyle(button, '::after'), propertyGroups.surface),
    island: take(getComputedStyle(island), propertyGroups.island),
    islandBefore: take(getComputedStyle(island, '::before'), propertyGroups.surface),
    islandAfter: take(getComputedStyle(island, '::after'), propertyGroups.surface),
    labelViewport: take(getComputedStyle(labelViewport), propertyGroups.labelViewport),
    label: take(getComputedStyle(label), propertyGroups.label),
    existingSheenAfter: take(getComputedStyle(sheen, '::after'), propertyGroups.sheen)
  };
}, PRE_FLOW_LOCK_PROPERTIES);

const installStateFixture = (page) => page.evaluate(async () => {
  const freeze = document.createElement('style');
  freeze.id = 'flow-state-freeze';
  freeze.textContent = `
    *, *::before, *::after {
      animation-play-state: paused !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }
  `;
  const baseline = document.createElement('style');
  baseline.id = 'flow-baseline-disable';
  baseline.textContent = '.btn-sheen::before { animation: none !important; opacity: 0 !important; }';
  document.head.append(freeze, baseline);
  const existingAnimations = document.getAnimations();
  for (const animation of existingAnimations) animation.pause();
  await Promise.all(existingAnimations.map((animation) => animation.ready));
  for (const animation of existingAnimations) animation.currentTime = 0;
  await new Promise(requestAnimationFrame);
});

const setState = async (page, state) => {
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await page.evaluate((next) => {
    document.body.classList.remove('has-lyric-overlay', 'has-playlist-overlay');
    document.querySelector('#dynamicIsland').classList.remove('is-split', 'is-opening', 'is-collapsing');
    document.querySelector('#playButton').removeAttribute('data-busy');
    document.querySelector('[data-flow-loading-fixture]')?.remove();
    if (next === 'busy') document.querySelector('#playButton').setAttribute('data-busy', '');
    if (next === 'lyric-overlay') document.body.classList.add('has-lyric-overlay');
    if (next === 'playlist-overlay') document.body.classList.add('has-playlist-overlay');
    if (next === 'split') document.querySelector('#dynamicIsland').classList.add('is-split');
    if (next === 'collapsing') document.querySelector('#dynamicIsland').classList.add('is-collapsing');
    if (next === 'loading') {
      const loading = document.createElement('div');
      loading.setAttribute('data-flow-loading-fixture', '');
      loading.id = 'loadingScreen';
      document.querySelector('#appRoot').before(loading);
    }
  }, state);
  if (state === 'hover') await page.locator('#playButton').hover();
  if (state === 'active') {
    await page.locator('#playButton').hover();
    await page.mouse.down();
  }
  await page.waitForTimeout(20);
};

const setControlledPeak = (page, peakAt) => page.locator('.btn-sheen').evaluate(async (node, time) => {
  document.querySelector('#flow-baseline-disable')?.remove();
  const animations = node.getAnimations({ subtree: true })
    .filter(({ animationName }) => animationName.startsWith('btn-perimeter-'));
  await Promise.all(animations.map((animation) => animation.ready));
  for (const animation of animations) {
    if (animation.animationName.startsWith('btn-perimeter-')) animation.currentTime = time;
  }
  await new Promise(requestAnimationFrame);
}, peakAt);

const restoreBaseline = (page) => page.evaluate(() => {
  if (document.querySelector('#flow-baseline-disable')) return;
  const baseline = document.createElement('style');
  baseline.id = 'flow-baseline-disable';
  baseline.textContent = '.btn-sheen::before { animation: none !important; opacity: 0 !important; }';
  document.head.append(baseline);
});

const getFlowState = (page) => page.locator('.btn-sheen').evaluate((node) => {
  const pseudo = getComputedStyle(node, '::before');
  return {
    angle: Number.parseFloat(pseudo.getPropertyValue('--btn-flow-angle')),
    opacity: Number.parseFloat(pseudo.opacity),
    animations: node.getAnimations({ subtree: true })
      .filter(({ animationName }) => animationName.startsWith('btn-perimeter-'))
      .map(({ animationName, currentTime, effect, playState, playbackRate }) => ({
        animationName,
        currentTime,
        duration: effect.getTiming().duration,
        easing: effect.getKeyframes()[0]?.easing,
        playState,
        playbackRate
      }))
  };
});

const decodeScreenshot = async (page, buffer) => page.evaluate(async (base64) => {
  const response = await fetch(`data:image/png;base64,${base64}`);
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0);
  return {
    width: bitmap.width,
    height: bitmap.height,
    pixels: [...context.getImageData(0, 0, bitmap.width, bitmap.height).data]
  };
}, buffer.toString('base64'));

const getPixelGeometry = (page) => page.locator('#playButton').evaluate((button) => {
  const buttonRect = button.getBoundingClientRect();
  const labelRect = document.querySelector('#btnLabelViewport').getBoundingClientRect();
  return {
    left: buttonRect.left,
    top: buttonRect.top,
    devicePixelRatio,
    width: buttonRect.width,
    height: buttonRect.height,
    label: {
      left: labelRect.left - buttonRect.left,
      top: labelRect.top - buttonRect.top,
      right: labelRect.right - buttonRect.left,
      bottom: labelRect.bottom - buttonRect.top
    }
  };
});

const measurePillDelta = (before, after, geometry) => {
  expect(after.width).toBe(before.width);
  expect(after.height).toBe(before.height);
  const buckets = Object.fromEntries(['perimeter', 'interior', 'center', 'label'].map((name) => [name, {
    sum: [0, 0, 0], max: [0, 0, 0], count: 0, changed: 0
  }]));
  const radius = geometry.height / 2;
  const add = (name, index) => {
    const bucket = buckets[name];
    let changed = false;
    for (let channel = 0; channel < 3; channel += 1) {
      const delta = Math.abs(after.pixels[index + channel] - before.pixels[index + channel]) / 255;
      bucket.sum[channel] += delta;
      bucket.max[channel] = Math.max(bucket.max[channel], delta);
      changed ||= delta > (1 / 255);
    }
    bucket.count += 1;
    if (changed) bucket.changed += 1;
  };
  for (let py = 0; py < before.height; py += 1) {
    for (let px = 0; px < before.width; px += 1) {
      const x = Math.floor(geometry.left) + px + 0.5 - geometry.left;
      const y = Math.floor(geometry.top) + py + 0.5 - geometry.top;
      const qx = Math.abs(x - geometry.width / 2) - (geometry.width / 2 - radius);
      const qy = Math.abs(y - geometry.height / 2);
      const signedDistance = Math.hypot(Math.max(qx, 0), Math.max(qy, 0))
        + Math.min(Math.max(qx, qy), 0)
        - radius;
      if (signedDistance > 0) continue;
      const index = (py * before.width + px) * 4;
      const onPerimeter = signedDistance >= -2;
      add(onPerimeter ? 'perimeter' : 'interior', index);
      if (x >= geometry.width * 0.15 && x < geometry.width * 0.85
        && y >= geometry.height * 0.15 && y < geometry.height * 0.85) add('center', index);
      if (x >= geometry.label.left && x < geometry.label.right
        && y >= geometry.label.top && y < geometry.label.bottom) add('label', index);
    }
  }
  return Object.fromEntries(Object.entries(buckets).map(([name, bucket]) => [name, {
    average: bucket.sum.map((sum) => sum / bucket.count),
    max: bucket.max,
    changedRatio: bucket.changed / bucket.count,
    count: bucket.count
  }]));
};

const assertPixelConcentration = (delta) => {
  expect(delta.center.average.every((value) => value < (4 / 255))).toBe(true);
  expect(delta.interior.average.every((value) => value < (1 / 255))).toBe(true);
  expect(delta.interior.max.every((value) => value < (64 / 255))).toBe(true);
  expect(delta.interior.changedRatio).toBeLessThan(0.01);
  expect(delta.label.average.every((value) => value < (0.5 / 255))).toBe(true);
  expect(delta.label.max.every((value) => value < (4 / 255))).toBe(true);
  expect(delta.label.changedRatio).toBeLessThan(0.001);
  const perimeterEnergy = delta.perimeter.average.reduce((sum, value) => sum + value, 0);
  const interiorEnergy = delta.interior.average.reduce((sum, value) => sum + value, 0);
  expect(perimeterEnergy).toBeGreaterThan(Math.max(5 * interiorEnergy, 0.0005));
  expect(delta.perimeter.changedRatio).toBeGreaterThan(Math.max(2 * delta.interior.changedRatio, 0.01));
};

const cleanRestart = async (page) => {
  await page.locator('#playButton').evaluate((button) => button.setAttribute('data-busy', ''));
  await expect.poll(() => getFlowState(page)).toMatchObject({ opacity: 0, animations: [] });
  await page.waitForTimeout(50);
  return page.locator('#playButton').evaluate(async (button) => {
    button.removeAttribute('data-busy');
    await new Promise(requestAnimationFrame);
    const orbit = button.querySelector('.btn-sheen').getAnimations({ subtree: true })
      .find(({ animationName }) => animationName.startsWith('btn-perimeter-orbit-'));
    if (orbit) await orbit.ready;
    return performance.now() - (Number(orbit?.currentTime) || 0);
  });
};

test.use({ video: 'on' });

test('same-state baseline locks every existing button surface and required control state', async ({ page }, testInfo) => {
  await waitForApp(page);
  await page.waitForTimeout(1_500);
  await expect(page.locator('#playButton')).not.toHaveClass(/is-text-swapping/, { timeout: 5_000 });
  const profileName = testInfo.project.name.startsWith('mobile') ? 'mobile' : 'desktop';
  const goldenProfileName = testInfo.project.name === 'mobile-reduce' ? 'reduce' : profileName;
  const profile = PROFILES[profileName];
  const summary = await getSummaryMetrics(page);
  expect(summary.style).toMatchObject({
    ...LOCKED_SHARED_STYLE,
    width: profile.width,
    height: profile.height,
    fontSize: profile.fontSize,
    letterSpacing: profile.letterSpacing
  });
  expect(summary.island).toMatchObject({ width: profile.islandWidth, height: '48px', minHeight: '48px' });
  await installStateFixture(page);

  const baselines = {};
  for (const state of [
    'idle', 'hover', 'active', 'busy', 'lyric-overlay', 'playlist-overlay',
    'split', 'collapsing', 'loading'
  ]) {
    await setState(page, state);
    const preFlowLock = await getPreFlowGoldenLock(page);
    await writeFile(testInfo.outputPath(`pre-flow-${state}.json`), `${JSON.stringify(preFlowLock, null, 2)}\n`);
    const preFlowDigest = createHash('sha256').update(JSON.stringify(preFlowLock)).digest('hex');
    expect(preFlowDigest, `${state} must match the persisted 600107c pre-flow golden`)
      .toBe(PRE_FLOW_GOLDEN_SHA256[goldenProfileName][state]);
    const baseline = await getCompleteLock(page);
    baselines[state] = baseline;
    await setControlledPeak(page, profileName === 'mobile' ? 600 : 600);
    const enabled = await getCompleteLock(page);
    expect(enabled, `${state} complete computed-style lock`).toEqual(baseline);

    const flow = await getFlowState(page);
    const stopped = ['busy', 'lyric-overlay', 'playlist-overlay', 'loading'].includes(state)
      || testInfo.project.name === 'mobile-reduce';
    if (stopped) {
      expect(flow).toMatchObject({ opacity: 0, animations: [] });
    } else {
      expect(flow.animations.map(({ animationName }) => animationName)).toEqual([profile.orbit, profile.fade]);
    }
    await restoreBaseline(page);
  }
  if (profileName === 'desktop') {
    expect(baselines.hover.button['background-image']).not.toBe(baselines.idle.button['background-image']);
    expect(baselines.hover.button['box-shadow']).not.toBe(baselines.idle.button['box-shadow']);
    expect(baselines.active.button.transform).not.toBe(baselines.idle.button.transform);
  }
  if (testInfo.project.name === 'mobile-reduce') {
    await setState(page, 'idle');
    expect(await getFlowState(page)).toMatchObject({ opacity: 0, animations: [] });
    await page.locator('#playButton').screenshot({
      path: testInfo.outputPath('button-reduced-motion.png'),
      scale: 'css'
    });
  }
});

test('controlled peak is confined to the signed-distance outer 2px pill mask', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-reduce');
  await waitForApp(page);
  await page.waitForTimeout(1_000);
  const profileName = testInfo.project.name === 'mobile-chromium' ? 'mobile' : 'desktop';
  await installStateFixture(page);
  await setState(page, 'idle');
  const button = page.locator('#playButton');
  const geometry = await getPixelGeometry(page);
  const idle = await button.screenshot({ path: testInfo.outputPath('button-controlled-idle.png'), scale: 'css' });
  await setControlledPeak(page, 600);
  const controlledState = await getFlowState(page);
  expect(controlledState.animations.map(({ animationName }) => animationName)).toEqual([
    PROFILES[profileName].orbit,
    PROFILES[profileName].fade
  ]);
  for (const animation of controlledState.animations) {
    expect(animation.currentTime).toBeCloseTo(600, 0);
    expect(animation.playState).toBe('paused');
  }
  expect(Number.isFinite(controlledState.angle)).toBe(true);
  expect(controlledState.opacity).toBeGreaterThan(profileName === 'mobile' ? 0.54 : 0.68);
  const peak = await button.screenshot({ path: testInfo.outputPath('button-controlled-peak.png'), scale: 'css' });
  const idlePixels = await decodeScreenshot(page, idle);
  const peakPixels = await decodeScreenshot(page, peak);
  const delta = measurePillDelta(idlePixels, peakPixels, geometry);
  await writeFile(testInfo.outputPath('controlled-pixel-metrics.json'), JSON.stringify({
    profile: profileName,
    geometry,
    screenshot: { width: idlePixels.width, height: idlePixels.height },
    delta
  }, null, 2));
  assertPixelConcentration(delta);
});

test('loading stage has no perimeter pseudo animation before critical resources resolve', async ({ page }) => {
  const release = await installCovers(page, { hold: true });
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#loadingScreen')).toHaveCount(1);
  await expect(page.locator('#appRoot')).toHaveAttribute('inert', '');
  expect(await getFlowState(page)).toMatchObject({ opacity: 0, animations: [] });
  release();
});

test('unregistered cycle sentinel keeps the capable-browser fallback transparent', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.setContent(`
    <style>
      #registrationProbe::before {
        --unregistered-cycle: unsupported;
        content: "";
        opacity: 0;
      }
      @supports ((-webkit-mask-composite: xor) or (mask-composite: exclude)) and (background: conic-gradient(from 0deg, transparent, white)) {
        #registrationProbe::before {
          animation:
            registration-probe-orbit var(--unregistered-cycle) linear infinite,
            registration-probe-fade var(--unregistered-cycle) linear infinite;
        }
      }
      @keyframes registration-probe-orbit { to { transform: translateX(1px); } }
      @keyframes registration-probe-fade { to { opacity: 1; } }
    </style>
    <div id="registrationProbe"></div>
  `);
  const fallback = await page.locator('#registrationProbe').evaluate((probe) => ({
    hasMask: CSS.supports('-webkit-mask-composite', 'xor') || CSS.supports('mask-composite', 'exclude'),
    hasConicGradient: CSS.supports('background', 'conic-gradient(from 0deg, transparent, white)'),
    animationName: getComputedStyle(probe, '::before').animationName,
    opacity: Number.parseFloat(getComputedStyle(probe, '::before').opacity),
    animations: probe.getAnimations({ subtree: true }).map(({ animationName }) => animationName)
  }));
  expect(fallback).toEqual({
    hasMask: true,
    hasConicGradient: true,
    animationName: 'none',
    opacity: 0,
    animations: []
  });
});

test('desktop and 390x844 record exact natural orbit, fade, idle, and pixel evidence', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name === 'mobile-reduce');
  const mobile = testInfo.project.name === 'mobile-chromium';
  const profile = PROFILES[mobile ? 'mobile' : 'desktop'];
  const viewport = mobile ? { width: 390, height: 844 } : { width: 1280, height: 720 };
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    reducedMotion: 'no-preference',
    recordVideo: { dir: testInfo.outputPath('raw-video'), size: viewport }
  });
  const page = await context.newPage();
  const video = page.video();
  await waitForApp(page);
  await page.waitForTimeout(1_500);
  expect(await page.evaluate(() => [innerWidth, innerHeight])).toEqual([viewport.width, viewport.height]);

  const button = page.locator('#playButton');
  const geometry = await getPixelGeometry(page);
  const startedAt = await cleanRestart(page);
  const samples = [];
  let idle;
  let peak;
  for (const target of [0, 300, 600, 900, 1200, 1500]) {
    await page.waitForFunction(({ start, elapsed }) => performance.now() - start >= elapsed, {
      start: startedAt,
      elapsed: target
    });
    samples.push({ target, ...(await getFlowState(page)) });
    if (target === 0) idle = await button.screenshot({ path: testInfo.outputPath('natural-idle.png'), scale: 'css' });
    if (target === 600) peak = await button.screenshot({ path: testInfo.outputPath('natural-peak.png'), scale: 'css' });
  }

  const expectedAnimations = [
    {
      animationName: profile.orbit,
      duration: profile.duration,
      easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
      playState: 'running',
      playbackRate: 1
    },
    {
      animationName: profile.fade,
      duration: profile.duration,
      easing: 'linear',
      playState: 'running',
      playbackRate: 1
    }
  ];
  for (const sample of samples) expect(sample.animations).toMatchObject(expectedAnimations);
  const orbitAngles = samples.slice(0, 5).map(({ angle }) => angle);
  expect(orbitAngles[0]).toBeLessThan(20);
  for (let index = 1; index < orbitAngles.length; index += 1) {
    const minimumProgress = index === orbitAngles.length - 1 ? 2 : 15;
    expect(orbitAngles[index]).toBeGreaterThan(orbitAngles[index - 1] + minimumProgress);
  }
  expect(orbitAngles.at(-1)).toBeGreaterThan(350);
  expect(samples[0].opacity).toBeLessThan(0.08);
  expect(samples[2].opacity).toBeGreaterThan(mobile ? 0.45 : 0.58);
  expect(samples[4].opacity).toBeLessThan(0.08);
  expect(samples[5].opacity).toBe(0);
  expect(samples[5].angle).toBeGreaterThan(350);

  const delta = measurePillDelta(
    await decodeScreenshot(page, idle),
    await decodeScreenshot(page, peak),
    geometry
  );
  assertPixelConcentration(delta);
  await writeFile(testInfo.outputPath('natural-flow-metrics.json'), JSON.stringify({
    profile: mobile ? 'mobile' : 'desktop', viewport, expectedAnimations, samples, delta
  }, null, 2));
  await context.close();
  await video.saveAs(testInfo.outputPath(mobile ? 'mobile-390x844-natural.webm' : 'desktop-natural.webm'));
});

test('Pixel 5 keeps both compact animations running for 19.2s with zero long tasks', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.addInitScript(() => {
    window.__buttonLongTasks = [];
    window.__buttonFlowSamples = [];
    new PerformanceObserver((list) => {
      window.__buttonLongTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
    }).observe({ type: 'longtask', buffered: true });
  });
  await waitForApp(page);
  await page.waitForTimeout(1_000);
  const startedAt = await cleanRestart(page);
  await page.evaluate(() => {
    const node = document.querySelector('.btn-sheen');
    window.__buttonFlowTimer = setInterval(() => {
      window.__buttonFlowSamples.push({
        at: performance.now(),
        animations: node.getAnimations({ subtree: true })
          .filter(({ animationName }) => animationName.startsWith('btn-perimeter-'))
          .map(({ animationName, effect, playState, playbackRate }) => ({
            animationName,
            duration: effect.getTiming().duration,
            playState,
            playbackRate
          }))
      });
    }, 200);
  });
  await page.waitForTimeout(19_200);
  const metrics = await page.evaluate((start) => {
    clearInterval(window.__buttonFlowTimer);
    return {
      viewport: [innerWidth, innerHeight],
      longTasks: window.__buttonLongTasks.filter(({ startTime, duration }) => startTime >= start && duration > 50),
      samples: window.__buttonFlowSamples.filter(({ at }) => at >= start)
    };
  }, startedAt);
  expect(metrics.viewport).toEqual([393, 727]);
  expect(metrics.samples.length).toBeGreaterThanOrEqual(90);
  for (const sample of metrics.samples) {
    expect(sample.animations).toEqual([
      { animationName: 'btn-perimeter-orbit-compact', duration: 9600, playState: 'running', playbackRate: 1 },
      { animationName: 'btn-perimeter-fade-compact', duration: 9600, playState: 'running', playbackRate: 1 }
    ]);
  }
  expect(metrics.longTasks).toEqual([]);
  await writeFile(testInfo.outputPath('pixel5-long-task-metrics.json'), JSON.stringify({
    viewport: metrics.viewport,
    observedMs: 19_200,
    sampleCount: metrics.samples.length,
    thresholdMs: 50,
    longTasks: metrics.longTasks
  }, null, 2));
});
