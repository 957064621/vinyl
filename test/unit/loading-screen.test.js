import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { createLoadingScreen } from '../../src/ui/loading-screen.js';

const createFixture = () => new JSDOM(`
  <div class="loading-screen" id="loadingScreen" data-state="loading" aria-live="polite">
    <div class="loading-intake">
      <div class="loading-intake-head">
        <span>LIGHT ARCHIVE / INTAKE</span>
        <output id="loadingProgress">00 / 05</output>
      </div>
      <div class="loading-contact-sheet" id="loadingContactSheet">
        <figure class="loading-frame" data-loading-slot="archive-01"><figcaption>AR-01</figcaption></figure>
      </div>
      <p class="loading-copy" id="loadingCopy">影像读取中</p>
      <button class="loading-retry" id="loadingRetry" type="button" hidden>重新载入</button>
    </div>
  </div>
`);

const transitionEnd = (window, propertyName, { bubbles = false } = {}) => {
  const event = new window.Event('transitionend', { bubbles });
  Object.defineProperty(event, 'propertyName', { value: propertyName });
  return event;
};

test('ready progress mounts the exact decoded image in its archive slot', () => {
  const dom = createFixture();
  const view = createLoadingScreen(dom.window.document);
  const decodedImage = dom.window.document.createElement('img');
  const result = {
    id: 'archive-01',
    alt: '加载封面图1',
    src: 'decoded.webp',
    image: decodedImage
  };

  view.setProgress({
    id: result.id,
    status: 'ready',
    completed: 1,
    total: 5,
    result
  });

  const slot = dom.window.document.querySelector('[data-loading-slot="archive-01"]');
  assert.strictEqual(slot.firstElementChild, decodedImage);
  assert.equal(decodedImage.alt, '加载封面图1');
  assert.equal(decodedImage.className, 'loading-image');
  assert.equal(decodedImage.dataset.assetId, 'archive-01');
  assert.equal(dom.window.document.getElementById('loadingProgress').textContent, '01 / 05');
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '已归档 1 / 5');
});

test('showError exposes a retry that resets the view and invokes its callback once', () => {
  const dom = createFixture();
  const view = createLoadingScreen(dom.window.document);
  const root = dom.window.document.getElementById('loadingScreen');
  const retry = dom.window.document.getElementById('loadingRetry');
  let retryCalls = 0;

  view.showError({
    failures: [{ id: 'archive-01' }],
    message: 'Critical images failed'
  }, () => {
    retryCalls += 1;
  });

  assert.equal(root.dataset.state, 'error');
  assert.equal(retry.hidden, false);
  assert.equal(dom.window.document.getElementById('loadingCopy').textContent, '影像读取失败：archive-01');

  retry.click();
  retry.click();

  assert.equal(retryCalls, 1);
  assert.equal(root.dataset.state, 'loading');
  assert.equal(retry.hidden, true);
});

test('compact exit ignores bubbled child transitions and removes on the root opacity transition', async () => {
  const dom = createFixture();
  const view = createLoadingScreen(dom.window.document);
  const root = dom.window.document.getElementById('loadingScreen');
  const child = root.querySelector('.loading-intake');
  const exiting = view.exit('compact');

  child.dispatchEvent(transitionEnd(dom.window, 'opacity', { bubbles: true }));
  await Promise.resolve();
  assert.equal(root.isConnected, true);

  root.dispatchEvent(transitionEnd(dom.window, 'transform'));
  await Promise.resolve();
  assert.equal(root.isConnected, true);

  root.dispatchEvent(transitionEnd(dom.window, 'opacity'));
  await exiting;
  assert.equal(root.isConnected, false);
});
