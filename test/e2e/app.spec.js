import { test, expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('serves the player shell', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('#turntable')).toBeAttached();
  await expect(page.locator('#playButton')).toBeAttached();
});
