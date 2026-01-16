import { test, expect } from '@playwright/test';

test('counter increments', async ({ page }) => {
  await page.goto('/');
  const count = page.locator('#countBtn');
  await expect(count).toBeVisible();
  await expect(count).toHaveText('count is 0');

  await count.click();

  await expect(count).toHaveText('count is 1');
});
