import { expect, type Page } from '@playwright/test';

export async function revealMarketplaceFilterLevel(page: Page, level: string) {
  const target = page.locator(`[data-marketplace-filter-row="${level}"]`);
  for (let step = 0; step < 3 && await target.getAttribute('aria-hidden') === 'true'; step++) {
    const visible = page.locator('[data-marketplace-filter-row][data-row-active="true"]');
    const levels = ['groups', 'categories', 'options', 'models'];
    const first = await visible.first().getAttribute('data-marketplace-filter-row');
    const parent = levels.indexOf(level) < levels.indexOf(first!) ? visible.first() : visible.last();
    await parent
      .getByRole('button', { pressed: true }).click();
  }
  await expect(target).not.toHaveAttribute('aria-hidden', 'true');
}
