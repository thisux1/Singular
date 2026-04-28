import { Hono } from 'hono';
import { questionsRepository } from '../repositories/questions-repository.js';

export const questionsRoutes = new Hono();

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

questionsRoutes.get('/:id/explanation', async (c) => {
  const questionId = c.req.param('id');

  if (!isUuid(questionId)) {
    return c.json(
      {
        error: {
          code: 'INVALID_ID',
          message: 'ID inválido',
          question_id: questionId,
        },
      },
      400,
    );
  }

  const question = await questionsRepository.getById(questionId);

  if (!question) {
    return c.json(
      {
        error: {
          code: 'QUESTION_NOT_FOUND',
          message: 'Questão não encontrada',
          question_id: questionId,
        },
      },
      404,
    );
  }

  // Se houver "explanation", retornamos, caso contrário uma string dizendo que não há
  const text = question.explanation ?? 'Explicação indisponível para esta questão no momento.';

  return c.json({
    explanation: text,
  });
});
