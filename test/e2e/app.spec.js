import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('serves the player shell', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#turntable')).toBeAttached();
  await expect(page.locator('#playButton')).toBeAttached();
});

test('mobile loads a real Chinese display font before revealing the player title', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile-chromium');
  await page.goto('./', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => document.fonts.ready);

  const fontState = await page.locator('.header h1').evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      loaded: document.fonts.check('600 24px "Vinyl Serif SC"', element.textContent),
      family: style.fontFamily,
      opacity: Number.parseFloat(style.opacity),
      color: style.color,
      width: rect.width,
      height: rect.height
    };
  });

  expect(fontState.loaded).toBe(true);
  expect(fontState.family).toContain('Vinyl Serif SC');
  expect(fontState.opacity).toBeGreaterThan(0);
  expect(fontState.color).not.toBe('rgba(0, 0, 0, 0)');
  expect(fontState.width).toBeGreaterThan(20);
  expect(fontState.height).toBeGreaterThan(10);
});

test('wechat copy uses the shared toast and rearms its timer', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.addInitScript(() => {
    window.__copiedWechatIds = [];
    window.__promptCalls = [];
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => ({
        writeText: async (value) => {
          window.__copiedWechatIds.push(value);
        }
      })
    });
    window.prompt = (...args) => window.__promptCalls.push(args);
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });

  await page.locator('#contactLink').dispatchEvent('click');
  await expect(page.locator('#copyToast')).toHaveClass(/is-visible/);
  await expect(page.locator('#copyToast')).toHaveText('微信号 Michael_Yuuu 已复制');
  await page.waitForTimeout(2000);
  await page.locator('#contactLink').dispatchEvent('click');
  await page.waitForTimeout(700);
  await expect(page.locator('#copyToast')).toHaveClass(/is-visible/);

  const state = await page.evaluate(() => ({
    copied: window.__copiedWechatIds,
    prompts: window.__promptCalls,
    radius: getComputedStyle(document.querySelector('#copyToast')).borderRadius
  }));
  expect(state.copied).toEqual(['Michael_Yuuu', 'Michael_Yuuu']);
  expect(state.prompts).toEqual([]);
  expect(state.radius).toBe('999px');
});

test('wechat copy failure stays inside the selectable custom toast', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium');
  await page.addInitScript(() => {
    window.__promptCalls = [];
    Object.defineProperty(Navigator.prototype, 'clipboard', {
      configurable: true,
      get: () => ({ writeText: async () => Promise.reject(new Error('clipboard blocked')) })
    });
    document.execCommand = () => false;
    window.prompt = (...args) => window.__promptCalls.push(args);
  });
  await page.goto('./', { waitUntil: 'domcontentloaded' });

  await page.locator('#contactLink').dispatchEvent('click');
  await expect(page.locator('#copyToast')).toHaveClass(/is-visible/);
  await expect(page.locator('#copyToast')).toHaveClass(/is-manual/);
  await expect(page.locator('#copyToast')).toHaveText('请长按复制：Michael_Yuuu');

  const state = await page.locator('#copyToast').evaluate((toast) => ({
    userSelect: getComputedStyle(toast).userSelect,
    pointerEvents: getComputedStyle(toast).pointerEvents,
    ariaHidden: toast.getAttribute('aria-hidden'),
    prompts: window.__promptCalls
  }));
  expect(state).toEqual({
    userSelect: 'text',
    pointerEvents: 'auto',
    ariaHidden: null,
    prompts: []
  });
});
