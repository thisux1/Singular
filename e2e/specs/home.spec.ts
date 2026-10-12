import { expect, test } from './base';

test.describe('home (terminal de provas)', () => {
  test('carrega navbar/wordmark e lista a prova E2E semeada', async ({ page }) => {
    await page.goto('/app');

    // Wordmark + nav
    await expect(page.locator('.navbar__brand')).toContainText('Singular');
    await expect(page.getByRole('link', { name: 'Terminal', exact: true })).toBeVisible();

    // Hero do terminal
    await expect(page.locator('.exam-list__hero-title')).toHaveText('Terminal de Provas');

    // A prova sintética aparece na galeria (título renderizado no card).
    await expect(
      page.locator('.exam-singularity__title', { hasText: 'E2E Prova Sintética' }).first(),
    ).toBeVisible();
  });
});
