import { describe, expect, it } from 'vitest';
import { parseGabarito } from '../../src/services/parser/gabarito-parser.js';

function line(text: string) {
  return { text };
}

describe('gabarito-parser', () => {
  it('extrai pares em formatos variados dentro de uma seção única', () => {
    const lines = [
      line('GABARITO PROVA A'),
      line('1-A 2.B 3) C 4 D'),
      line('5-E 6-A'),
      line('10 - B'),
    ];

    const result = parseGabarito(lines);
    expect(result.gabaritoMap[1]).toBe('A');
    expect(result.gabaritoMap[2]).toBe('B');
    expect(result.gabaritoMap[3]).toBe('C');
    expect(result.gabaritoMap[4]).toBe('D');
    expect(result.gabaritoMap[5]).toBe('E');
    expect(result.gabaritoMap[6]).toBe('A');
    expect(result.gabaritoMap[10]).toBe('B');
    expect(result.provaType).toBe('A');
  });

  it('marca questões anuladas via "*" e via texto ANULADA', () => {
    const lines = [
      line('GABARITO PROVA B'),
      line('1-A 2-B 3-* 4-D'),
      line('Questão 7 ANULADA'),
      line('5-C 6-E 8-A 9-B 10-D 11-A 12-C'),
    ];

    const result = parseGabarito(lines);
    expect(result.annulled).toContain(3);
    expect(result.annulled).toContain(7);
    expect(result.gabaritoMap[3]).toBeUndefined();
    expect(result.gabaritoMap[1]).toBe('A');
    expect(result.gabaritoMap[4]).toBe('D');
  });

  it('multi-prova A–D: seleciona a seção do provaType preferido', () => {
    const lines = [
      line('GABARITO 1 – PROVA A'),
      line('1-A 2-A 3-A 4-A 5-A 6-A 7-A 8-A 9-A 10-A'),
      line('GABARITO 2 – PROVA B'),
      line('1-B 2-B 3-B 4-B 5-B 6-B 7-B 8-B 9-B 10-B'),
      line('GABARITO 3 – PROVA C'),
      line('1-C 2-C 3-C 4-C 5-C 6-C 7-C 8-C 9-C 10-C'),
      line('GABARITO 4 – PROVA D'),
      line('1-D 2-D 3-D 4-D 5-D 6-D 7-D 8-D 9-D 10-D'),
    ];

    const resultB = parseGabarito(lines, 'B');
    expect(resultB.provaType).toBe('B');
    expect(resultB.gabaritoMap[1]).toBe('B');
    expect(resultB.gabaritoMap[10]).toBe('B');
    expect(Object.keys(resultB.gabaritoMap)).toHaveLength(10);

    const resultD = parseGabarito(lines, 'd');
    expect(resultD.provaType).toBe('D');
    expect(resultD.gabaritoMap[5]).toBe('D');
  });

  it('sem preferência e com tipos conflitantes, escolhe a seção de maior cobertura', () => {
    const lines = [
      line('GABARITO PROVA A'),
      line('1-A 2-A 3-A'),
      line('GABARITO PROVA B'),
      line('1-B 2-B 3-B 4-B 5-B 6-B 7-B 8-B 9-B 10-B 11-B 12-B'),
    ];

    const result = parseGabarito(lines);
    // Seção B tem 12 pares vs 3 da seção A → maior cobertura vence.
    expect(result.gabaritoMap[12]).toBe('B');
    expect(Object.keys(result.gabaritoMap)).toHaveLength(12);
  });

  it('documento sem headers explícitos é tratado como seção única', () => {
    const lines = [
      line('1-A 2-B 3-C 4-D 5-E'),
      line('6-A 7-B 8-C 9-D 10-E'),
      line('11-A 12-B'),
    ];

    const result = parseGabarito(lines);
    expect(result.provaType).toBeNull();
    expect(Object.keys(result.gabaritoMap)).toHaveLength(12);
    expect(result.gabaritoMap[11]).toBe('A');
  });
});
