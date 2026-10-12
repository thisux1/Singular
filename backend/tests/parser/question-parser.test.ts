import { describe, expect, it } from 'vitest';
import { parseQuestions } from '../../src/services/parser/question-parser.js';

interface Line {
  text: string;
  page: number;
}

function line(text: string, page = 1): Line {
  return { text, page };
}

const LONG_STEM =
  'Qual é a capital do Brasil e qual a sua importância histórica para o desenvolvimento do país?';

const OPTION_LINES = [
  '(A) primeira alternativa válida do item',
  '(B) segunda alternativa válida do item',
  '(C) terceira alternativa válida do item',
  '(D) quarta alternativa válida do item',
  '(E) quinta alternativa válida do item',
];

function questionLines(n: number, stem = LONG_STEM): Line[] {
  return [line(`${n}. ${stem}`), ...OPTION_LINES.map((opt) => line(opt))];
}

describe('question-parser (Cesgranrio)', () => {
  it('confirma questão simples com marcador "N." + 5 alternativas', () => {
    const { questions } = parseQuestions(questionLines(1));

    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe(1);
    expect(questions[0].text).toContain('capital do Brasil');
    expect(questions[0].options.A).toContain('primeira alternativa');
    expect(questions[0].options.E).toContain('quinta alternativa');
    expect(questions[0].confidenceScore).toBeGreaterThanOrEqual(45);
  });

  it('aceita formato Cesgranrio com número sozinho na linha', () => {
    const lines = [
      line('1'),
      line('Assinale a alternativa que apresenta a forma correta de concordância verbal.'),
      ...OPTION_LINES.map((opt) => line(opt)),
    ];

    const { questions } = parseQuestions(lines);
    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe(1);
    expect(questions[0].text).toContain('concordância verbal');
  });

  it('sequence gate: primeira questão acima do teto (>20) é rejeitada', () => {
    const { questions } = parseQuestions(questionLines(30));
    expect(questions).toHaveLength(0);
  });

  it('sequence gate: salto maior que MAX_FORWARD_JUMP não vira questão', () => {
    // lastConfirmed só atualiza quando a próxima questão inicia (finalize),
    // então o gate morde a partir da segunda confirmada: Q1, Q2 ok, "9." (diff=8>5) vira texto.
    const lines = [
      ...questionLines(1),
      ...questionLines(2, 'Em que ano foi proclamada a república brasileira e quem liderou o movimento?'),
      ...questionLines(9, 'Qual é o maior planeta do sistema solar e qual o seu diâmetro aproximado?'),
    ];
    const { questions } = parseQuestions(lines);

    expect(questions.map((q) => q.id)).toEqual([1, 2]);
  });

  it('sequence gate: sequência válida 1→2→3 confirma todas', () => {
    const lines = [
      ...questionLines(1),
      ...questionLines(2, 'Em que ano foi proclamada a república brasileira e quem liderou o movimento?'),
      ...questionLines(3, 'Qual é o maior planeta do sistema solar e qual o seu diâmetro aproximado?'),
    ];

    const { questions } = parseQuestions(lines);
    expect(questions.map((q) => q.id)).toEqual([1, 2, 3]);
  });

  it('vincula texto-base compartilhado às questões do range declarado', () => {
    const lines = [
      line('Leia o texto a seguir para responder às questões 1 a 2.'),
      line('O texto discute a economia brasileira do período entreguerras e suas crises.'),
      ...questionLines(1, 'Segundo o texto, qual foi a principal consequência da crise de 1929?'),
      ...questionLines(2, 'De acordo com o texto, qual setor foi mais afetado pela crise?'),
    ];

    const { questions, sharedTexts } = parseQuestions(lines);
    expect(questions).toHaveLength(2);
    expect(sharedTexts.length).toBeGreaterThanOrEqual(1);
    expect(questions[0].sharedTextId).toBeTruthy();
    expect(questions[1].sharedTextId).toBeTruthy();
  });

  it('marca requiresPDF quando a página tem imagem e o enunciado é curto', () => {
    // stem com 5–7 palavras: ≥MIN_STEM_WORDS (confirma) mas <8 (dispara requiresPDF).
    const lines = [
      line('1. Veja a figura acima com atenção.'),
      ...OPTION_LINES.map((opt) => line(opt)),
    ];
    const pageInfo = [{ page: 1, hasImages: true }];

    const { questions } = parseQuestions(lines, pageInfo as never);
    expect(questions).toHaveLength(1);
    expect(questions[0]?.requiresPDF).toBe(true);
  });
});
