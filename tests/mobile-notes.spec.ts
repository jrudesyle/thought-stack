import { test, expect, Page } from '@playwright/test';


const MOCK_SCRIPT = "/home/rudesyle/projects/thought-stack/tests/mock-vault.js";

test.describe('Mobile notes loading (Pixel 5)', () => {
  test.use({
    viewport: { width: 393, height: 851 },
    userAgent: 'Mozilla/5.0 (Linux; Android 12; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36',
    hasTouch: true,
    isMobile: true,
  });

  async function load(page: Page) {
    await page.addInitScript({ path: MOCK_SCRIPT });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
  }

  test('notes appear and STAY (no vanish regression)', async ({ page }) => {
    await load(page);

    await expect(page.locator('text=Unlock Vault')).not.toBeVisible({ timeout: 5000 });
    await expect(page.locator('.note-list-item')).toHaveCount(2, { timeout: 8000 });

    await page.waitForTimeout(3000);
    await expect(page.locator('.note-list-item')).toHaveCount(2);
    await expect(page.locator('text=Error:')).not.toBeVisible();
  });

  test('tap note opens editor', async ({ page }) => {
    await load(page);
    await expect(page.locator('.note-list-item')).toHaveCount(2, { timeout: 8000 });
    await page.locator('.note-list-item').first().tap();
    await expect(page.locator('.editor-back-btn')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('.editor-panel')).not.toContainText('Select a note', { timeout: 3000 });
  });

  test('trash view no error', async ({ page }) => {
    await load(page);
    await expect(page.locator('.note-list-item')).toHaveCount(2, { timeout: 8000 });
    await page.locator('.sidebar-toggle').tap();
    await page.locator('text=Trash').tap();
    await expect(page.locator('.note-list')).toBeVisible({ timeout: 3000 });
    await expect(page.locator('text=Error:')).not.toBeVisible();
  });

  test('back button returns to list', async ({ page }) => {
    await load(page);
    await expect(page.locator('.note-list-item')).toHaveCount(2, { timeout: 8000 });
    await page.locator('.note-list-item').first().tap();
    await expect(page.locator('.editor-back-btn')).toBeVisible({ timeout: 3000 });
    await page.locator('.editor-back-btn').tap();
    await expect(page.locator('.note-list-item')).toHaveCount(2, { timeout: 3000 });
  });
});
