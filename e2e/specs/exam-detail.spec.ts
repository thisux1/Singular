import { expect, getSeededExam, test } from './base';

test.describe('detalhe da prova', () => {
  test('mostra status Publicado e leva ao setup via Iniciar Simulação', async ({ page }) => {
    const { examId } = getSeededExam();

    await page.goto(`/exam/${examId}`);

    await expect(page.locator('.exam-detail__title')).toHaveText('E2E Prova Sintética');
    // status 'completed' → label "Publicado" (TerminalTab + data grid)
    await expect(page.getByText('Publicado').first()).toBeVisible();
    // massa = 5 questões semeadas
    await expect(page.locator('.exam-detail__data-value').first()).toHaveText('5');

    const startButton = page.getByRole('button', { name: 'Iniciar Simulação' });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    await page.waitForURL(new RegExp(`/quiz/setup/${examId}`));
    await expect(page.locator('.quiz-setup__title')).toHaveText('Configurar Simulação');
  });
});
