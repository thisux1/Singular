import { expect, getSeededExam, test } from './base';

test.describe('fluxo de simulação', () => {
  test('setup → player → finalizar → resultado', async ({ page }) => {
    const { examId } = getSeededExam();

    // ---- Setup ----
    await page.goto(`/app/quiz/setup/${examId}`);
    await expect(page.locator('.quiz-setup__title')).toHaveText('Configurar Simulação');

    // Modo "Prova Completa" (radiogroup de mode-cards)
    await page.getByRole('radio', { name: /Prova Completa/ }).click();
    await page.getByRole('button', { name: 'Iniciar Simulação' }).click();

    // ---- Player ----
    await page.waitForURL(new RegExp(`/app/quiz/${examId}\\?session=`));
    await expect(page.locator('.quiz-player__question')).toBeVisible();
    await expect(page.locator('.quiz-dots__dot')).toHaveCount(5);
    await expect(page.locator('.quiz-player__meta-label')).toContainText('Fragmento 1 de 5');

    // Alternativa A da questão 1 (seed: gabarito A → feedback de acerto)
    await page.locator('.quiz-option').first().click();
    await expect(page.locator('.quiz-player__feedback')).toBeVisible();
    await expect(page.locator('.quiz-player__feedback')).toContainText('Vetor Confirmado');
    await expect(page.locator('.quiz-option').first()).toHaveClass(/quiz-option--correct/);

    // Dot do fragmento 1 marca acerto após navegar
    await page.getByRole('button', { name: /Próxima/ }).click();
    await expect(page.locator('.quiz-player__meta-label')).toContainText('Fragmento 2 de 5');
    await expect(page.locator('.quiz-dots__dot').first()).toHaveClass(/quiz-dots__dot--correct/);

    // ---- Finalizar (há pendentes → modal de confirmação) ----
    await page.getByRole('button', { name: 'Colapsar Simulação' }).click();
    const confirm = page.getByRole('button', { name: 'Finalizar mesmo assim' });
    try {
      await confirm.waitFor({ state: 'visible', timeout: 5_000 });
      await confirm.click();
    } catch {
      // sem pendentes → finish direto, sem modal
    }

    // ---- Resultado ----
    await page.waitForURL(/\/app\/quiz\/[0-9a-f-]+\/result/);
    await expect(page.locator('.quiz-result__title')).toHaveText('Diagnóstico da Simulação');
    await expect(page.locator('.quiz-result__score-value')).toContainText('%');
    await expect(page.locator('.quiz-result__score-summary')).toContainText('Taxa de Sucesso');

    // Charts (recharts dentro de .dashboard-charts) + revisão de vetores
    await expect(page.locator('.dashboard-charts')).toBeVisible();
    await expect(page.locator('.recharts-responsive-container').first()).toBeVisible();
    await expect(page.locator('.quiz-result__answer-card').first()).toBeVisible();
    await expect(page.locator('.quiz-result__answer-card').first()).toContainText('E2E-Q1');
  });
});
