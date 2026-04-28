// @ts-nocheck
/**
 * layout-engine.js
 * Reconstructs reading-order lines from raw PDF text fragments.
 *
 * This is the most critical module. It handles:
 *  1. Header/footer detection and removal
 *  2. Single vs. double column detection
 *  3. Fragment-to-line grouping by Y proximity
 *  4. Correct reading order for double-column layouts
 *
 * Input:  { fragments, pageInfo } from pdf-extractor.js
 * Output: { lines, debugData }
 *
 * Each line: { text, page, lineY, fontSize, isLeftCol, tokens }
 * debugData: full intermediate state for debug mode in admin
 */

import { LAYOUT_CONFIG } from '../config/parser-config.js';
import type { PdfExtractResult, PdfFragment, PdfPageInfo } from './pdf-extractor.js';

export function reconstructLayout(extractorOutput: PdfExtractResult, configOverride: any = {}) {
  const cfg = { ...LAYOUT_CONFIG, ...configOverride };
  const { fragments, pageInfo } = extractorOutput;

  const debugData = { steps: {} };

  // Step 1: Detect headers/footers
  const { bodyFragments, headerFooterStrings } = filterHeadersFooters(fragments, pageInfo, cfg);
  debugData.steps.headerFooter = { removed: headerFooterStrings, kept: bodyFragments.length };

  // Step 2: Detect column layout (per page)
  const columnLayout = detectColumnLayout(bodyFragments, pageInfo, cfg);
  debugData.steps.columnLayout = columnLayout;

  // Step 3: Group fragments into lines per page
  const rawLines = groupIntoLines(bodyFragments, columnLayout, cfg);
  debugData.steps.rawLines = rawLines;

  // Step 4: Sort lines in reading order
  const orderedLines = sortLinesReadingOrder(rawLines, columnLayout);
  debugData.steps.orderedLines = orderedLines;

  return { lines: orderedLines, debugData };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — HEADER / FOOTER DETECTION
// ─────────────────────────────────────────────────────────────────────────────

function filterHeadersFooters(fragments, pageInfo, cfg) {
  const numPages = pageInfo.length;
  if (numPages < 2) return { bodyFragments: fragments, headerFooterStrings: [] };

  // Collect text strings that appear in header/footer zones across pages
  const pageTexts = {}; // pageNum → Set of strings in header/footer zone
  fragments.forEach(frag => {
    const pi = pageInfo.find(p => p.page === frag.page);
    if (!pi) return;
    const relY = frag.y / pi.pageHeight;
    const inHeaderZone = relY < cfg.HEADER_ZONE_PCT;
    const inFooterZone = relY > (1 - cfg.FOOTER_ZONE_PCT);
    if (inHeaderZone || inFooterZone) {
      if (!pageTexts[frag.page]) pageTexts[frag.page] = new Set();
      pageTexts[frag.page].add(normalizeText(frag.str));
    }
  });

  // Find strings that repeat in ≥REPEAT_THRESHOLD of pages
  const allPageNums = Object.keys(pageTexts).map(Number);
  if (allPageNums.length === 0) return { bodyFragments: fragments, headerFooterStrings: [] };

  // Count occurrences of each unique string across pages
  const stringCount = {};
  allPageNums.forEach(pageNum => {
    pageTexts[pageNum].forEach(str => {
      if (str.length < 2) return; // ignore single chars/numbers like page numbers
      stringCount[str] = (stringCount[str] || 0) + 1;
    });
  });

  const headerFooterStrings = Object.entries(stringCount)
    .filter(([, count]) => count / numPages >= cfg.REPEAT_THRESHOLD)
    .map(([str]) => str);

  // Also always remove: page numbers (pure numbers in header/footer zones)
  // and very short strings in those zones
  const headerFooterSet = new Set(headerFooterStrings);

  const bodyFragments = fragments.filter(frag => {
    const pi = pageInfo.find(p => p.page === frag.page);
    if (!pi) return true;
    const relY = frag.y / pi.pageHeight;
    const inZone = relY < cfg.HEADER_ZONE_PCT || relY > (1 - cfg.FOOTER_ZONE_PCT);
    if (!inZone) return true;

    const norm = normalizeText(frag.str);
    // Remove if it's a known repeating string, a pure number (page num), or very short
    if (headerFooterSet.has(norm)) return false;
    if (/^\d{1,4}$/.test(norm)) return false; // page number
    if (norm.length <= 1) return false;
    return true;
  });

  return { bodyFragments, headerFooterStrings };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — COLUMN LAYOUT DETECTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns per-page column info: { page, isDoubleColumn, splitX, pageWidth }
 *
 * Algorithm: Find the widest low-density gap in the center zone of the page.
 * A valid gap must be ≥ COLUMN_GAP_PCT wide and have ≤ COLUMN_GAP_DENSITY frags/bucket.
 * The search is restricted to the 5–85% zone to avoid false gaps at page margins.
 */
function detectColumnLayout(fragments, pageInfo, cfg) {
  const result = {};

  pageInfo.forEach(pi => {
    const pageFrags = fragments.filter(f => f.page === pi.page);
    if (pageFrags.length < 10) {
      result[pi.page] = { isDoubleColumn: false, splitX: null, pageWidth: pi.pageWidth };
      return;
    }

    // Build X histogram (1% page-width buckets)
    const bucketCount = 100;
    const bucketWidth = pi.pageWidth / bucketCount;
    const histogram = new Array(bucketCount).fill(0);
    pageFrags.forEach(frag => {
      const bucket = Math.min(Math.floor(frag.x / bucketWidth), bucketCount - 1);
      histogram[bucket]++;
    });

    // Search range: COLUMN_CENTER_TOLERANCE to (1-COLUMN_CENTER_TOLERANCE) of page width
    // Restricting to e.g. 30-70% avoids false right-margin "gaps" on sparse pages
    const minBucket   = Math.floor(cfg.COLUMN_CENTER_TOLERANCE * bucketCount);
    const maxBucket   = Math.floor((1 - cfg.COLUMN_CENTER_TOLERANCE) * bucketCount);
    const gapMinWidth = Math.floor(cfg.COLUMN_GAP_PCT * bucketCount);
    const maxInGap    = Math.ceil(cfg.COLUMN_GAP_DENSITY * pageFrags.length);

    let bestGap  = null;
    let gapStart = null;

    for (let i = minBucket; i <= maxBucket; i++) {
      if (histogram[i] <= maxInGap) {
        if (gapStart === null) gapStart = i;
      } else {
        if (gapStart !== null) {
          const gapWidth = i - gapStart;
          if (gapWidth >= gapMinWidth) {
            if (!bestGap || gapWidth > (bestGap.end - bestGap.start)) {
              bestGap = { start: gapStart, end: i - 1 };
            }
          }
          gapStart = null;
        }
      }
    }
    if (gapStart !== null) {
      const gapWidth = maxBucket - gapStart + 1;
      if (gapWidth >= gapMinWidth && (!bestGap || gapWidth > (bestGap.end - bestGap.start))) {
        bestGap = { start: gapStart, end: maxBucket };
      }
    }

    if (bestGap) {
      const splitX = Math.round(((bestGap.start + bestGap.end) / 2) * bucketWidth);
      result[pi.page] = { isDoubleColumn: true, splitX, pageWidth: pi.pageWidth };
    } else {
      result[pi.page] = { isDoubleColumn: false, splitX: null, pageWidth: pi.pageWidth };
    }
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — GROUP FRAGMENTS INTO LINES
// ─────────────────────────────────────────────────────────────────────────────

function groupIntoLines(fragments, columnLayout, cfg) {
  const lines = [];

  // Process page by page
  const pageNums = [...new Set(fragments.map(f => f.page))].sort((a, b) => a - b);

  pageNums.forEach(pageNum => {
    const pageFrags = fragments.filter(f => f.page === pageNum);
    if (pageFrags.length === 0) return;

    const layout = columnLayout[pageNum] || { isDoubleColumn: false, splitX: null };

    if (layout.isDoubleColumn) {
      // Split into two columns and process each independently
      const leftFrags  = pageFrags.filter(f => f.x < layout.splitX);
      const rightFrags = pageFrags.filter(f => f.x >= layout.splitX);
      lines.push(...groupPageFragsIntoLines(leftFrags,  pageNum, cfg, 'left'));
      lines.push(...groupPageFragsIntoLines(rightFrags, pageNum, cfg, 'right'));
    } else {
      lines.push(...groupPageFragsIntoLines(pageFrags, pageNum, cfg, 'single'));
    }
  });

  return lines;
}

/**
 * Group a set of fragments (already filtered to one column) into text lines.
 */
function groupPageFragsIntoLines(frags, pageNum, cfg, column) {
  if (frags.length === 0) return [];

  // Sort by Y (top to bottom), then X within same Y group
  const sorted = [...frags].sort((a, b) => a.y - b.y || a.x - b.x);

  const lines = [];
  let currentGroup = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const frag = sorted[i];
    const prevFrag = currentGroup[currentGroup.length - 1];
    const avgFontSize = currentGroup.reduce((s, f) => s + f.fontSize, 0) / currentGroup.length;
    const yThreshold = Math.max(avgFontSize * cfg.LINE_Y_THRESHOLD, 3);

    if (Math.abs(frag.y - prevFrag.y) <= yThreshold) {
      currentGroup.push(frag);
    } else {
      lines.push(buildLine(currentGroup, pageNum, column, cfg));
      currentGroup = [frag];
    }
  }
  if (currentGroup.length > 0) {
    lines.push(buildLine(currentGroup, pageNum, column, cfg));
  }

  return lines;
}

/**
 * Build a single line object from a group of fragments on the same Y.
 */
function buildLine(group, pageNum, column, cfg) {
  // Sort left-to-right
  const sorted = [...group].sort((a, b) => a.x - b.x);

  // Concatenate strings, adding spaces between fragments when there's a gap
  let text = sorted[0].str;
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.x - (prev.x + prev.width);
    const spaceWidth = (prev.fontSize || 10) * 0.3; // ~0.3em as space threshold
    if (gap > spaceWidth) {
      text += ' ' + curr.str;
    } else {
      text += curr.str;
    }
  }

  const lineY   = sorted[0].y;
  const fontSize = Math.max(...sorted.map(f => f.fontSize));
  const lineX   = sorted[0].x;

  return {
    text: text.trim(),
    page: pageNum,
    lineY,
    lineX,
    fontSize,
    column, // 'left' | 'right' | 'single'
    tokens: sorted, // raw fragments for debug
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 4 — SORT LINES IN READING ORDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort lines so reading order is:
 *  - Single column: top to bottom
 *  - Double column: left column top-to-bottom, then right column top-to-bottom
 *    (within each page; then page order)
 */
function sortLinesReadingOrder(rawLines) {
  // Group by page
  const byPage = {};
  rawLines.forEach(line => {
    if (!byPage[line.page]) byPage[line.page] = [];
    byPage[line.page].push(line);
  });

  const ordered = [];
  const pages = Object.keys(byPage).map(Number).sort((a, b) => a - b);

  pages.forEach(pageNum => {
    const pageLines = byPage[pageNum];
    const hasDoubleCol = pageLines.some(l => l.column === 'left' || l.column === 'right');

    if (hasDoubleCol) {
      // Left column first (sorted by Y), then right column (sorted by Y)
      const left  = pageLines.filter(l => l.column === 'left' ).sort((a, b) => a.lineY - b.lineY);
      const right = pageLines.filter(l => l.column === 'right').sort((a, b) => a.lineY - b.lineY);
      ordered.push(...left, ...right);
    } else {
      ordered.push(...pageLines.sort((a, b) => a.lineY - b.lineY));
    }
  });

  return ordered;
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(str) {
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}
