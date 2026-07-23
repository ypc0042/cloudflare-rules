import { expect, test } from '@playwright/test';

test('admin login, session persistence, SPA refresh, and logout', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login$/);
  await page.getByPlaceholder('使用后台密码登录').fill('wrong-password');
  await page.getByRole('button', { name: '进入后台' }).click();
  await expect(page.getByText('密码不正确。')).toBeVisible();
  await page.getByPlaceholder('使用后台密码登录').fill('e2e-password');
  await page.getByRole('button', { name: '进入后台' }).click();
  await expect(page).toHaveURL(/\/admin\?view=dashboard$/);
  consoleErrors.length = 0;
  await page.reload();
  await expect(page.getByText('规则控制台').first()).toBeVisible();
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('button', { name: /退出登录/ }).click();
  await page.getByRole('button', { name: '确认退出' }).click();
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(consoleErrors).toEqual([]);
});

test('unknown API is not served by the SPA fallback', async ({ request }) => {
  const response = await request.get('/api/does-not-exist');
  expect(response.status()).toBe(404);
  expect(await response.text()).not.toContain('<html');
});
