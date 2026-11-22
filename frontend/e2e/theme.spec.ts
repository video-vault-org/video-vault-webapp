import { expect, test } from '@playwright/test';

test('themes persist, follow the system and fit desktop and mobile headers', async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const select = page.getByRole('combobox', { name: 'Design', exact: true });
  await expect(select).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await select.selectOption('dark');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(20, 29, 25)');
  await expect(page.locator('.login-panel')).toHaveCSS('background-color', 'rgb(30, 42, 35)');
  await page.reload();
  await expect(select).toHaveValue('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(select).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`dark-${width}.png`), fullPage: true });
  }
  await select.selectOption('light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('background-color', 'rgb(245, 243, 237)');
  await select.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload();
  await expect(select).toHaveValue('system');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('uses dark surfaces for the authenticated catalog and video dialog', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.getByRole('combobox', { name: 'Design', exact: true }).selectOption('dark');
  await page.getByLabel('Benutzername', { exact: true }).fill('admin');
  await page.getByLabel('Passwort', { exact: true }).fill('VaultTesting123!');
  await page.getByRole('button', { name: 'Anmelden', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ein Sommer am See', exact: true })).toBeVisible();
  await expect(page.locator('.video-card').first()).toHaveCSS('background-color', 'rgb(30, 42, 35)');
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.screenshot({ path: testInfo.outputPath('dark-catalog.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Mehr Details' }).first().click();
  await expect(page.getByRole('dialog')).toHaveCSS('background-color', 'rgb(26, 37, 31)');
  await page.screenshot({ path: testInfo.outputPath('dark-dialog-mobile.png'), fullPage: true });
});
