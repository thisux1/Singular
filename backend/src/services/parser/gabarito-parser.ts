/**
 * gabarito-parser.js
 * Extracts answer keys from a Cesgranrio gabarito PDF.
 *
 * Input:  lines[] from layout-engine (already reconstructed)
 * Output: { gabaritoMap, annulled, provaType, parsingLog }
 *
 * gabaritoMap: { questionId: letter }  e.g. { 1: "B", 2: "E", ... }
 * annulled:    [questionId, ...]       questions marked as ANULADA
 * provaType:   "A" | "B" | "C" | "D" | null
 */

import { CESGRANRIO_PATTERNS } from '../config/parser-config.js';

interface LayoutLine {
  text: string;
}

interface ParsingLogEntry {
  type: string;
  message: string;
  auto: boolean;
  timestamp: number;
}

interface GabaritoSection {
  provaType: string | null;
  headerText: string;
  lines: LayoutLine[];
}

interface GabaritoParseResult {
  gabaritoMap: Record<number, string>;
  annulled: number[];
  provaType: string | null;
  parsingLog: ParsingLogEntry[];
}

/**
 * @param {Array} lines - from layout-engine
 * @param {string} [preferredProvaType] - "A", "B", etc. to select if multiple
 * @returns {{ gabaritoMap: Object, annulled: Array, provaType: string|null, parsingLog: Array }}
 */
export function parseGabarito(
  lines: LayoutLine[],
  preferredProvaType: string | null = null,
): GabaritoParseResult {
  const parsingLog: ParsingLogEntry[] = [];

  function log(type: string, msg: string) {
    parsingLog.push({ type, message: msg, auto: true, timestamp: Date.now() });
  }

  // Reconstruct full text corpus from lines
  // ── Detect multiple gabaritos in the PDF ─────────────────────────────────
  // Example: "GABARITO 1 – PROVA A", "GABARITO 2 – PROVA B"
  const sections = splitGabaritoSections(lines);
  log('info', `Seções de gabarito encontradas: ${sections.length}`);

  if (sections.length === 0) {
    // No clear section headers — treat whole document as one gabarito
    return parseGabaritoSection(lines, null, parsingLog);
  }

  if (sections.length === 1) {
    log('info', `Seção única selecionada: ${sections[0].headerText || 'sem header'} (prova ${sections[0].provaType || '?'})`);
    const result = parseGabaritoSection(sections[0].lines, sections[0].provaType, parsingLog);
    return result;
  }

  // Multiple sections
  const normalizedPreferredType = normalizeProvaType(preferredProvaType);
  let candidateSections = sections;

  if (normalizedPreferredType) {
    const matching = sections.filter((s) => s.provaType === normalizedPreferredType);
    if (matching.length > 0) {
      log('info', `Filtrando seções para Prova ${normalizedPreferredType} (encontradas: ${matching.length})`);
      candidateSections = matching;
    } else {
      log('warning', `Prova ${normalizedPreferredType} não encontrada. Usando todas as seções.`);
    }
  }

  // Check if there are different non-null provaTypes among candidateSections
  const nonNullTypes = new Set(candidateSections.map((s) => s.provaType).filter(Boolean));

  if (nonNullTypes.size > 1) {
    // Conflicting non-null types (e.g. 'A' and 'B'). We must pick the best single section.
    log('info', `Detectadas seções conflitantes (${Array.from(nonNullTypes).join(', ')}). Selecionando a de maior cobertura.`);
    const targetSection = candidateSections
      .map((section) => ({ section, pairCount: countPairsInLines(section.lines) }))
      .sort((a, b) => b.pairCount - a.pairCount)[0]?.section ?? candidateSections[0];

    log(
      'info',
      `Seção única selecionada: ${targetSection.headerText || 'sem header'} (prova ${targetSection.provaType || '?'})`,
    );
    return parseGabaritoSection(targetSection.lines, targetSection.provaType, parsingLog);
  } else {
    // All candidates have the same type or are null. We can safely merge all their lines!
    log('info', `Mesclando ${candidateSections.length} seções não-conflitantes.`);
    const mergedLines: LayoutLine[] = [];
    candidateSections.forEach((s) => {
      mergedLines.push(...s.lines);
    });
    const finalProvaType = candidateSections[0]?.provaType || null;
    return parseGabaritoSection(mergedLines, finalProvaType, parsingLog);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION SPLITTER
// ─────────────────────────────────────────────────────────────────────────────

function splitGabaritoSections(lines: LayoutLine[]): GabaritoSection[] {
  const sections: GabaritoSection[] = [];
  let current: GabaritoSection | null = null;

  lines.forEach((line) => {
    const normalizedLine = line.text.trim();
    const hasHeaderMarker = CESGRANRIO_PATTERNS.GABARITO_PROVA_HEADER.test(normalizedLine);
    const provaType = extractProvaTypeFromHeader(normalizedLine);
    const isHeaderLine = hasHeaderMarker && (Boolean(provaType) || /\bgabarito\b/i.test(normalizedLine));

    if (isHeaderLine) {
      if (current) sections.push(current);
      current = {
        provaType,
        headerText: normalizedLine,
        lines: [line],
      };
    } else if (current) {
      current.lines.push(line);
    }
  });

  if (current) sections.push(current);
  return sections;
}

// ─────────────────────────────────────────────────────────────────────────────
// SINGLE SECTION PARSER
// ─────────────────────────────────────────────────────────────────────────────

function parseGabaritoSection(
  lines: LayoutLine[],
  provaType: string | null,
  parsingLog: ParsingLogEntry[],
): GabaritoParseResult {
  const gabaritoMap: Record<number, string> = {};
  const annulled: number[] = [];
  const fullText = lines.map((l) => l.text).join('\n');

  function log(type: string, msg: string) {
    parsingLog.push({ type, message: msg, auto: true, timestamp: Date.now() });
  }

  // Strategy 1: Parse common "question + answer" pair formats
  // Supports examples: "1 A", "01-A", "1.A", "1) A", and contiguous "1A".
  const found = new Map<number, string>(); // questionId → letter
  let pairMatches = 0;

  lines.forEach((line) => {
    const pairs = extractAnswerPairsFromText(line.text);
    pairs.forEach((pair) => {
      const qId = pair.questionId;
      const ans = pair.answer;

      if (qId < 1 || qId > 200) return;
      pairMatches += 1;

      if (!found.has(qId)) {
        if (ans === '*') {
          annulled.push(qId);
          found.set(qId, 'ANULADA');
          log('info', `Questão ${qId} anulada`);
        } else {
          found.set(qId, ans);
        }
      }
    });
  });

  log('info', `Pares detectados na seção: ${pairMatches}`);

  // Strategy 2: Check for "ANULADA" text near a question number
  lines.forEach((line) => {
    if (CESGRANRIO_PATTERNS.GABARITO_ANNULLED.test(line.text)) {
      // Try to find nearby question number
      const nearby = line.text.match(/(\d{1,3})/);
      if (nearby) {
        const qId = parseInt(nearby[1], 10);
        if (!annulled.includes(qId)) {
          annulled.push(qId);
          found.set(qId, 'ANULADA');
          log('info', `Questão ${qId} marcada como anulada`);
        }
      }
    }
  });

  // Build final gabaritoMap (exclude annulled from the map)
  found.forEach((ans, qId) => {
    if (ans !== 'ANULADA') {
      gabaritoMap[qId] = ans;
    }
  });

  const count = Object.keys(gabaritoMap).length + annulled.length;
  log('info', `Gabarito e parcial: ${Object.keys(gabaritoMap).length} respostas + ${annulled.length} anuladas (total ${count})`);

  if (count < 10) {
    log('warning', `Poucas respostas encontradas (${count}). O formato do PDF pode ser diferente do esperado.`);
  }

  return { gabaritoMap, annulled, provaType: provaType || null, parsingLog };
}

function normalizeProvaType(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return /^[A-D]$/.test(normalized) ? normalized : null;
}

function extractProvaTypeFromHeader(lineText: string): string | null {
  const provaMatch = lineText.match(/\bprova\s*[:\-]?\s*([A-D])\b/i);
  if (provaMatch) {
    return provaMatch[1].toUpperCase();
  }

  const gabaritoWithProvaMatch = lineText.match(/\bgabarito\b[\s\S]{0,20}?\bprova\s*[:\-]?\s*([A-D])\b/i);
  if (gabaritoWithProvaMatch) {
    return gabaritoWithProvaMatch[1].toUpperCase();
  }

  const gabaritoDirectTypeMatch = lineText.match(/\bgabarito\s*[:\-]?\s*([A-D])\b/i);
  if (gabaritoDirectTypeMatch) {
    return gabaritoDirectTypeMatch[1].toUpperCase();
  }

  return null;
}

function extractAnswerPairsFromText(text: string): Array<{ questionId: number; answer: string }> {
  const pairs: Array<{ questionId: number; answer: string }> = [];
  const patterns = [
    /(?:^|[\s,;])(\d{1,3})\s*[-–:\.]\s*([A-Ea-e\*])(?=$|[\s,;])/g,
    /(?:^|[\s,;])(\d{1,3})\s+([A-Ea-e\*])(?=$|[\s,;])/g,
    /(?:^|[\s,;])(\d{1,3})\)\s*([A-Ea-e\*])(?=$|[\s,;])/g,
    /(?:^|[\s,;])(\d{1,3})([A-Ea-e\*])(?=$|[\s,;])/g,
  ];

  patterns.forEach((regex) => {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(text)) !== null) {
      const questionId = Number.parseInt(match[1], 10);
      if (!Number.isInteger(questionId)) {
        continue;
      }

      pairs.push({
        questionId,
        answer: match[2].toUpperCase(),
      });
    }
  });

  return pairs;
}

function countPairsInLines(lines: LayoutLine[]): number {
  let count = 0;
  lines.forEach((line) => {
    count += extractAnswerPairsFromText(line.text).length;
  });

  return count;
}
