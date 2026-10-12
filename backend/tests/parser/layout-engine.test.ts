import { describe, expect, it } from 'vitest';
import { reconstructLayout } from '../../src/services/parser/layout-engine.js';
import type { PdfExtractResult, PdfFragment, PdfPageInfo } from '../../src/services/parser/pdf-extractor.js';

const PAGE_W = 1000;
const PAGE_H = 1400;

function frag(str: string, x: number, y: number, page = 1): PdfFragment {
  return {
    str,
    x,
    y,
    width: str.length * 5,
    height: 12,
    fontSize: 12,
    page,
    pageWidth: PAGE_W,
    pageHeight: PAGE_H,
  };
}

function pageInfo(page: number, fragmentCount: number): PdfPageInfo {
  return {
    page,
    pageWidth: PAGE_W,
    pageHeight: PAGE_H,
    hasImages: false,
    fragmentCount,
  };
}

function buildExtract(fragments: PdfFragment[], pages: PdfPageInfo[]): PdfExtractResult {
  return {
    fragments,
    pageInfo: pages,
    metadata: { title: '', author: '', creator: '', numPages: pages.length },
  };
}

describe('layout-engine', () => {
  it('detecta 2 colunas e ordena leitura: coluna esquerda inteira antes da direita', () => {
    const fragments: PdfFragment[] = [];

    // Coluna esquerda: x ∈ [50..420] — buckets 5–42
    for (let i = 0; i < 8; i += 1) {
      fragments.push(frag(`L${i + 1} texto da coluna esquerda`, 50, 200 + i * 40));
    }
    // Coluna direita: x ∈ [620..960] — buckets 62–96 (gap central 43–62 ≈ 20%)
    for (let i = 0; i < 8; i += 1) {
      fragments.push(frag(`R${i + 1} texto da coluna direita`, 620, 200 + i * 40));
    }

    const { lines, debugData } = reconstructLayout(
      buildExtract(fragments, [pageInfo(1, fragments.length)]),
    );

    const layout = (debugData.steps as Record<string, any>).columnLayout[1];
    expect(layout.isDoubleColumn).toBe(true);
    expect(layout.splitX).toBeGreaterThan(400);
    expect(layout.splitX).toBeLessThan(650);

    const texts = lines.map((l: { text: string }) => l.text);
    // Toda a coluna esquerda vem antes de qualquer linha da direita.
    expect(texts.slice(0, 8).every((t: string) => t.startsWith('L'))).toBe(true);
    expect(texts.slice(8).every((t: string) => t.startsWith('R'))).toBe(true);
    // Ordem vertical preservada dentro de cada coluna.
    expect(texts[0]).toContain('L1');
    expect(texts[7]).toContain('L8');
  });

  it('página de coluna única (sem gap central ≥5%) não é dividida', () => {
    const fragments: PdfFragment[] = [];

    // O detector exige um gap de ≥5 buckets com ≤3% dos frags/bucket na zona
    // 30–70% da página. Distribuímos clusters densos a cada ~3.5 buckets até
    // o fim da zona de busca (bucket 70) para que nenhum run esparso ≥5 exista.
    for (let row = 0; row < 12; row += 1) {
      const y = 200 + row * 40;
      for (let col = 0; col < 14; col += 1) {
        const x = 250 + col * 35; // buckets 25–70, clusters a cada ~3.5 buckets
        fragments.push(frag(`r${row}c${col} palavra texto`, x, y));
      }
    }

    const { lines, debugData } = reconstructLayout(
      buildExtract(fragments, [pageInfo(1, fragments.length)]),
    );

    const layout = (debugData.steps as Record<string, any>).columnLayout[1];
    expect(layout.isDoubleColumn).toBe(false);
    expect(lines).toHaveLength(12);
    expect(lines[0].text).toContain('r0c0');
    expect(lines[11].text).toContain('r11c13');
  });

  it('remove header repetido em múltiplas páginas', () => {
    const fragments: PdfFragment[] = [];
    const pages = [pageInfo(1, 0), pageInfo(2, 0)];

    for (const page of [1, 2]) {
      // Header zone: y < 8% de 1400 = 112
      fragments.push(frag('CONCURSO PÚBLICO FEDERAL', 50, 20, page));
      // Body
      for (let i = 0; i < 6; i += 1) {
        fragments.push(frag(`conteúdo página ${page} linha ${i + 1}`, 50, 200 + i * 40, page));
      }
    }

    const { lines, debugData } = reconstructLayout(buildExtract(fragments, pages));

    const removed = (debugData.steps as Record<string, any>).headerFooter.removed;
    expect(removed).toContain('concurso público federal');
    expect(lines.some((l: { text: string }) => /concurso público/i.test(l.text))).toBe(false);
    expect(lines).toHaveLength(12);
  });
});
