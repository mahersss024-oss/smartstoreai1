import { expect, test } from '@playwright/test';

const labels = {
  profile: '\u0627\u0644\u0645\u0644\u0641 \u0627\u0644\u0634\u062e\u0635\u064a',
  save: '\u062d\u0641\u0638 \u0627\u0644\u062a\u063a\u064a\u064a\u0631\u0627\u062a',
  cancelEdit: '\u0625\u0644\u063a\u0627\u0621 \u0627\u0644\u062a\u0639\u062f\u064a\u0644',
  edit: '\u062a\u0639\u062f\u064a\u0644',
  remove: '\u062d\u0630\u0641',
  deleteAccount: '\u062d\u0630\u0641 \u0627\u0644\u062d\u0633\u0627\u0628',
  confirmDelete: '\u062a\u0623\u0643\u064a\u062f \u062d\u0630\u0641 \u0627\u0644\u062d\u0633\u0627\u0628',
  cancel: '\u0625\u0644\u063a\u0627\u0621',
};

test.beforeEach(async ({ page, baseURL }) => {
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(new URL(baseURL!).hostname);
  await page.addInitScript(() => sessionStorage.setItem('smartstore_welcome_seen', '1'));
});

for (const status of [401, 503, 200]) {
  test(`account deletion requires acknowledgment and confirmation, cancellation writes nothing, response ${status}`, async ({ page }) => {
    let deletes = 0;
    // All destructive requests are intercepted, including the success branch.
    await page.route('**/api/account/profile', route => {
      expect(route.request().method()).toBe('DELETE');
      deletes++;
      return route.fulfill({ status, json: { message: 'Deletion fixture unavailable' } });
    });
    await page.goto('/delete-account');
    const remove = page.getByRole('button', { name: labels.deleteAccount, exact: true });
    await expect(remove).toBeDisabled();
    await page.getByRole('checkbox').check();
    await remove.click();
    const dialog = page.getByRole('dialog', { name: labels.confirmDelete });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: labels.cancel, exact: true }).click();
    await expect(dialog).not.toBeVisible();
    expect(deletes).toBe(0);
    await remove.click();
    await dialog.getByRole('button', { name: labels.confirmDelete, exact: true }).click();
    await expect.poll(() => deletes).toBe(1);
    await expect(dialog).not.toBeVisible();
    if (status === 200) {
      await expect(page).toHaveURL(/\/$/);
    } else {
      await expect(page).toHaveURL(/\/delete-account$/);
      if (status === 503) {
        await expect(page.getByText('تعذر إكمال الإجراء الآن. راجع البيانات وحاول مجددًا.', { exact: true })).toBeVisible();
        await expect(page.getByText('Deletion fixture unavailable', { exact: true })).toHaveCount(0);
      }
      else await expect(page.getByText(/\u0633\u062c\u0644 \u0627\u0644\u062f\u062e\u0648\u0644 \u0625\u0644\u0649 \u062d\u0633\u0627\u0628\u0643 \u0623\u0648\u0644/)).toBeVisible();
      await expect(remove).toBeEnabled();
    }
  });
}
