// @ts-nocheck
/**
 * question-parser.js
 * State machine that parses reconstructed text lines into structured questions.
 *
 * Input:  lines[] from layout-engine.js
 * Output: { questions, parsingLog }
 *
 * Each question:
 *   { id, text, options: {A,B,C,D,E}, sharedTextId?, requiresPDF, page,
 *     confidenceScore, confidenceDetails }
 *
 * Shared text blocks:
 *   { id, text, questionRange: [first, last] }
 */

import { CESGRANRIO_PATTERNS, CONFIDENCE_WEIGHTS, PARSER_GUARDS } from '../config/parser-config.js';

// ─────────────────────────────────────────────────────────────────────────────
// STATE MACHINE STATES
// ─────────────────────────────────────────────────────────────────────────────
const STATE = {
  SCANNING:       'SCANNING',
  SHARED_TEXT:    'SHARED_TEXT',
  QUESTION_STEM:  'QUESTION_STEM',
  OPTION_A:       'OPTION_A',
  OPTION_B:       'OPTION_B',
  OPTION_C:       'OPTION_C',
  OPTION_D:       'OPTION_D',
  OPTION_E:       'OPTION_E',
};

const OPTION_STATES = [STATE.OPTION_A, STATE.OPTION_B, STATE.OPTION_C, STATE.OPTION_D, STATE.OPTION_E];
const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Array} lines - from layout-engine reconstructLayout()
 * @param {{ hasImages: boolean }[]} pageInfo - from pdf-extractor
 * @returns {{ questions: Array, sharedTexts: Array, parsingLog: Array }}
 */
export function parseQuestions(lines, pageInfo = []) {
  const pagesWithImages = new Set(
    pageInfo.filter(p => p.hasImages).map(p => p.page)
  );

  const questions   = [];
  const sharedTexts = [];
  const parsingLog  = [];

  let state = STATE.SCANNING;

  // Working buffers
  let currentQuestion = null;       // question being built
  let currentSharedText = null;     // shared text being built
  let pendingSharedText = null;     // shared text awaiting range detection
  let pendingSharedRange = null;    // [first, last] detected from "questões X a Y"
  let pendingQuestionNumber = null; // bare number seen on prev line (Cesgranrio format)
  let lastConfirmedQuestionId = null;
  let activeConfirmedBlock = null;
  let forceInstructionForQuestionId = null;

  function log(type, msg, qId = null, auto = true) {
    parsingLog.push({ type, message: msg, questionId: qId, auto, timestamp: Date.now() });
  }

  function countUsefulOptions(options = {}) {
    return OPTION_LETTERS.reduce((acc, letter) => {
      const optionText = (options[letter] || '').trim();
      return acc + (wordCount(optionText) >= 2 ? 1 : 0);
    }, 0);
  }

  function classifyQuestionCandidate(question) {
    const { score, details } = calcConfidence(question);
    const stemWords = wordCount(question.text);
    const usefulOptions = countUsefulOptions(question.options);
    const hasValidStem = stemWords >= PARSER_GUARDS.MIN_STEM_WORDS;
    const hasUsefulOptions = usefulOptions >= PARSER_GUARDS.MIN_USEFUL_OPTIONS;
    const hasMinimumScore = score >= PARSER_GUARDS.MIN_CONFIRMATION_SCORE;

    const confirmed = hasValidStem && hasUsefulOptions && hasMinimumScore;
    return {
      status: confirmed ? 'real_question_confirmed' : 'instruction_block',
      score,
      details,
      stemWords,
      usefulOptions,
      hasValidStem,
      hasUsefulOptions,
      hasMinimumScore,
    };
  }

  function markConfirmedInBlock(question) {
    if (!activeConfirmedBlock) {
      activeConfirmedBlock = {
        startId: question.id,
        endId: question.id,
        startIndex: questions.length - 1,
        count: 1,
        totalScore: question.confidenceScore,
        totalUsefulOptions: countUsefulOptions(question.options),
      };
      return;
    }

    if (question.id === activeConfirmedBlock.endId + 1) {
      activeConfirmedBlock.endId = question.id;
      activeConfirmedBlock.count += 1;
      activeConfirmedBlock.totalScore += question.confidenceScore;
      activeConfirmedBlock.totalUsefulOptions += countUsefulOptions(question.options);
      return;
    }

    activeConfirmedBlock = {
      startId: question.id,
      endId: question.id,
      startIndex: questions.length - 1,
      count: 1,
      totalScore: question.confidenceScore,
      totalUsefulOptions: countUsefulOptions(question.options),
    };
  }

  function isWeakActiveBlock() {
    if (!activeConfirmedBlock) return false;
    if (activeConfirmedBlock.count < PARSER_GUARDS.WEAK_BLOCK_MIN_ITEMS) return false;

    const avgScore = activeConfirmedBlock.totalScore / activeConfirmedBlock.count;
    const avgUsefulOptions = activeConfirmedBlock.totalUsefulOptions / activeConfirmedBlock.count;
    return avgScore <= PARSER_GUARDS.WEAK_BLOCK_MAX_AVG_SCORE
      || avgUsefulOptions <= PARSER_GUARDS.WEAK_BLOCK_MAX_AVG_USEFUL_OPTIONS;
  }

  function rollbackWeakBlockAsInstruction() {
    if (!activeConfirmedBlock) return false;

    const removed = questions.splice(activeConfirmedBlock.startIndex);
    if (removed.length === 0) return false;

    if (currentQuestion && currentQuestion.id >= activeConfirmedBlock.startId && currentQuestion.id <= activeConfirmedBlock.endId + 1) {
      forceInstructionForQuestionId = currentQuestion.id;
    }

    const avgScore = Math.round(activeConfirmedBlock.totalScore / activeConfirmedBlock.count);
    const avgUsefulOptions = Number((activeConfirmedBlock.totalUsefulOptions / activeConfirmedBlock.count).toFixed(1));
    log(
      'info',
      `sequence_reset: reinício numérico em 1 detectado após bloco fraco ${activeConfirmedBlock.startId}-${activeConfirmedBlock.endId} (média_score=${avgScore}, média_opções_úteis=${avgUsefulOptions}); reclassificado como instruction_block`,
      PARSER_GUARDS.SEQUENCE_RESET_TARGET,
    );
    log(
      'info',
      `instruction_block: removidas ${removed.length} entradas provisórias do bloco ${activeConfirmedBlock.startId}-${activeConfirmedBlock.endId}`,
      PARSER_GUARDS.SEQUENCE_RESET_TARGET,
    );

    lastConfirmedQuestionId = questions.length > 0 ? questions[questions.length - 1].id : null;
    activeConfirmedBlock = null;
    return true;
  }

  function evaluateSequenceGate(nextQuestionId) {
    if (lastConfirmedQuestionId === null) {
      return {
        accepted: nextQuestionId <= PARSER_GUARDS.MAX_FIRST_QUESTION_NUMBER,
        reason: 'first_question_gate',
      };
    }

    const diff = nextQuestionId - lastConfirmedQuestionId;
    if (diff > 0 && diff <= PARSER_GUARDS.MAX_FORWARD_JUMP) {
      return { accepted: true, reason: 'forward_sequence' };
    }

    const canResetOnlyAtInitialBlock = activeConfirmedBlock?.startIndex === 0;
    if (
      diff <= 0
      && nextQuestionId === PARSER_GUARDS.SEQUENCE_RESET_TARGET
      && canResetOnlyAtInitialBlock
      && isWeakActiveBlock()
    ) {
      rollbackWeakBlockAsInstruction();
      return { accepted: true, reason: 'sequence_reset' };
    }

    return { accepted: false, reason: 'out_of_sequence' };
  }

  function finalizeQuestion() {
    if (!currentQuestion) return;
    // Clean up accumulated text
    currentQuestion.text = currentQuestion.text.trim();
    Object.keys(currentQuestion.options).forEach(k => {
      currentQuestion.options[k] = currentQuestion.options[k].trim();
    });
    // Attach pending shared text if applicable
    if (pendingSharedText && pendingSharedRange) {
      const [first, last] = pendingSharedRange;
      if (currentQuestion.id >= first && currentQuestion.id <= last) {
        currentQuestion.sharedTextId = pendingSharedText.id;
        if (!pendingSharedText.questionRange) pendingSharedText.questionRange = [first, last];
      }
      // If we passed the range, commit the shared text
      if (currentQuestion.id > last) {
        sharedTexts.push(pendingSharedText);
        pendingSharedText = null;
        pendingSharedRange = null;
      }
    }
    // Flag requiresPDF if question is on a page with images and has short stem
    if (pagesWithImages.has(currentQuestion.page) && wordCount(currentQuestion.text) < 8) {
      currentQuestion.requiresPDF = true;
      log('warning', 'Questão em página com imagem e enunciado curto — pode precisar do PDF', currentQuestion.id);
    }
    const candidate = classifyQuestionCandidate(currentQuestion);
    if (forceInstructionForQuestionId === currentQuestion.id) {
      candidate.status = 'instruction_block';
      forceInstructionForQuestionId = null;
    }
    currentQuestion.confidenceScore = candidate.score;
    currentQuestion.confidenceDetails = candidate.details;

    if (candidate.status === 'real_question_confirmed') {
      questions.push(currentQuestion);
      lastConfirmedQuestionId = currentQuestion.id;
      markConfirmedInBlock(currentQuestion);
      log(
        'info',
        `real_question_confirmed: Q${currentQuestion.id} confirmada (stem=${candidate.stemWords}, opções úteis=${candidate.usefulOptions}, score=${candidate.score})`,
        currentQuestion.id,
      );
    } else {
      log(
        'info',
        `instruction_block: Q${currentQuestion.id} descartada (stem=${candidate.stemWords}, opções úteis=${candidate.usefulOptions}, score=${candidate.score})`,
        currentQuestion.id,
      );
    }

    currentQuestion = null;
  }

  function finalizeSharedText() {
    if (!currentSharedText) return;
    currentSharedText.text = currentSharedText.text.trim();
    pendingSharedText = currentSharedText;
    currentSharedText = null;
  }

  // ── Main loop ────────────────────────────────────────────────────────────
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let text = line.text;
    if (!text) continue;

    // ── Strip RASCUNHO (scratch paper) marker and everything after it ────────
    const scratchIdx = text.search(CESGRANRIO_PATTERNS.SCRATCH_PAPER);
    if (scratchIdx === 0) continue;           // Entire line is scratch paper — skip
    if (scratchIdx > 0) text = text.slice(0, scratchIdx).trimEnd();

    // ── Check for bare question number on its own line (Cesgranrio format) ──
    const aloneMatch = text.match(CESGRANRIO_PATTERNS.QUESTION_NUMBER_ALONE);
    if (aloneMatch) {
      const qId = parseInt(aloneMatch[1], 10);
      const gate = evaluateSequenceGate(qId);
      if (!gate.accepted) {
        // Out-of-sequence bare number — treat as regular text
        if (state === STATE.QUESTION_STEM && currentQuestion) currentQuestion.text += ' ' + text;
        continue;
      }

      pendingQuestionNumber = { id: qId, page: line.page };
      continue;
    }

    // ── If there's a pending bare number, try to start question with this line ─
    if (pendingQuestionNumber !== null) {
      const qId   = pendingQuestionNumber.id;
      const qPage = pendingQuestionNumber.page;
      pendingQuestionNumber = null;

      // Only start if line is not an option marker (that would be weird)
      const isOption = CESGRANRIO_PATTERNS.OPTION_MARKER.test(text);
      if (!isOption) {
        if (state === STATE.SHARED_TEXT) finalizeSharedText();
        else finalizeQuestion();

        currentQuestion = {
          id: qId,
          text: text.trim(),
          options: { A: '', B: '', C: '', D: '', E: '' },
          sharedTextId: null,
          requiresPDF: false,
          page: qPage,
        };
        if (pendingSharedText && pendingSharedRange) {
          const [first, last] = pendingSharedRange;
          if (qId >= first && qId <= last) currentQuestion.sharedTextId = pendingSharedText.id;
          if (qId > last) { sharedTexts.push(pendingSharedText); pendingSharedText = null; pendingSharedRange = null; }
        }
        state = STATE.QUESTION_STEM;
        continue;
      }
    }

    // ── Check for question start: number + separator on same line ─────────
    const qMatch = text.match(CESGRANRIO_PATTERNS.QUESTION_START);
    if (qMatch) {
      const qId = parseInt(qMatch[1], 10);

      const gate = evaluateSequenceGate(qId);
      if (!gate.accepted) {
        // Out-of-sequence — treat as body text, not a question start
        if (state === STATE.QUESTION_STEM && currentQuestion) {
          currentQuestion.text += ' ' + text;
        } else if (state !== STATE.SCANNING) {
          // Append to current option
          const optKey = state.replace('OPTION_', '');
          if (currentQuestion && currentQuestion.options[optKey] !== undefined) {
            currentQuestion.options[optKey] += ' ' + text;
          }
        }
        continue;
      }

      // Finalize whatever was in progress
      if (state === STATE.SHARED_TEXT) finalizeSharedText();
      else finalizeQuestion();

      // Start new question
      currentQuestion = {
        id: qId,
        text: text.slice(qMatch[0].length).trim(), // strip "1. " prefix
        options: { A: '', B: '', C: '', D: '', E: '' },
        sharedTextId: null,
        requiresPDF: false,
        page: line.page,
      };
      // Attach pending shared text if in range
      if (pendingSharedText && pendingSharedRange) {
        const [first, last] = pendingSharedRange;
        if (qId >= first && qId <= last) {
          currentQuestion.sharedTextId = pendingSharedText.id;
        }
        if (qId > last) {
          sharedTexts.push(pendingSharedText);
          pendingSharedText = null;
          pendingSharedRange = null;
        }
      }
      state = STATE.QUESTION_STEM;
      continue;
    }

    // ── Check for option marker ────────────────────────────────────────────
    const optMatch = text.match(CESGRANRIO_PATTERNS.OPTION_MARKER);
    if (optMatch && (state === STATE.QUESTION_STEM || OPTION_STATES.includes(state))) {
      const letter = optMatch[1].toUpperCase();
      const expectedIdx = OPTION_LETTERS.indexOf(letter);

      // Validate sequence (warn if out of order)
      const currentIdx = OPTION_STATES.indexOf(state);
      if (currentIdx >= 0 && expectedIdx !== currentIdx + 1 && expectedIdx !== 0) {
        // Allow A (first option) or next in sequence
        if (expectedIdx !== currentIdx + 1) {
          log('warning', `Alternativa ${letter} fora de sequência esperada`, currentQuestion?.id);
        }
      }

      if (currentQuestion) {
        // Strip the option marker prefix and get the remainder text
        let remainder = text.slice(optMatch[0].length).trim();

        // Detect inline options: "(A) text (B) text (C) text" all on one line
        // Split on any embedded option markers that follow
        const inlineRe = /\s+\(([B-E])\)\s*/g;
        let inlineMatch;
        let splitRemainder = remainder;
        const inlineOptions = [];
        while ((inlineMatch = inlineRe.exec(remainder)) !== null) {
          // Found embedded option marker inside this line
          inlineOptions.push({ letter: inlineMatch[1], start: inlineMatch.index, end: inlineMatch.index + inlineMatch[0].length });
        }
        if (inlineOptions.length > 0) {
          // Split: first part goes to current letter, rest to subsequent letters
          splitRemainder = remainder.slice(0, inlineOptions[0].start).trim();
          let prev = inlineOptions[0];
          for (let io = 0; io < inlineOptions.length; io++) {
            const cur  = inlineOptions[io];
            const next = inlineOptions[io + 1];
            const optText = next
              ? remainder.slice(cur.end, next.start).trim()
              : remainder.slice(cur.end).trim();
            if (currentQuestion) currentQuestion.options[cur.letter] = optText;
            state = STATE[`OPTION_${cur.letter}`] || STATE.OPTION_A;
          }
          // Set state to last inline option
          state = STATE[`OPTION_${inlineOptions[inlineOptions.length - 1].letter}`] || STATE.OPTION_A;
        }

        currentQuestion.options[letter] = splitRemainder;
      }
      state = STATE[`OPTION_${letter}`] || STATE.OPTION_A;
      // If we processed inline splits, state was already set to the last one above
      continue;
    }

    // ── Check for shared text signals ─────────────────────────────────────
    const rangeMatch = text.match(CESGRANRIO_PATTERNS.SHARED_TEXT_RANGE);
    if (rangeMatch && (state === STATE.SCANNING || state === STATE.QUESTION_STEM)) {
      const first = parseInt(rangeMatch[1], 10);
      const last  = parseInt(rangeMatch[2], 10);
      pendingSharedRange = [first, last];
      log('info', `Texto-base detectado para questões ${first}–${last}`, null);

      // If we were in QUESTION_STEM, this might be part of a shared text lead-in
      // Start accumulating shared text (if not already)
      if (!pendingSharedText) {
        if (state === STATE.SCANNING) {
          finalizeSharedText();
          currentSharedText = {
            id: `shared-${first}-${last}`,
            text: text,
            questionRange: [first, last],
          };
          state = STATE.SHARED_TEXT;
        } else {
          // Already in question — this range indicator is part of the stem; just note it
          if (currentQuestion) currentQuestion.text += ' ' + text;
        }
      } else {
        // Range found while accumulating — update range and append text
        pendingSharedRange = [first, last];
        pendingSharedText.questionRange = [first, last];
        pendingSharedText.text += ' ' + text;
      }
      continue;
    }

    const leadMatch = text.match(CESGRANRIO_PATTERNS.SHARED_TEXT_LEAD);
    if (leadMatch && state === STATE.SCANNING) {
      // Start of a potential shared text block
      if (currentSharedText) currentSharedText.text += ' ' + text;
      else {
        currentSharedText = {
          id: `shared-pre-${Date.now()}`,
          text: text,
          questionRange: null,
        };
        state = STATE.SHARED_TEXT;
      }
      continue;
    }

    // ── Default: append to current state buffer ───────────────────────────
    switch (state) {
      case STATE.SCANNING:
        // Stray text before first question — ignore or treat as document header
        break;

      case STATE.SHARED_TEXT:
        if (currentSharedText) {
          currentSharedText.text += ' ' + text;
          // Look for range reference embedded in the shared text
          const embeddedRange = text.match(CESGRANRIO_PATTERNS.SHARED_TEXT_RANGE);
          if (embeddedRange && !pendingSharedRange) {
            pendingSharedRange = [parseInt(embeddedRange[1], 10), parseInt(embeddedRange[2], 10)];
            currentSharedText.questionRange = pendingSharedRange;
            currentSharedText.id = `shared-${pendingSharedRange[0]}-${pendingSharedRange[1]}`;
            log('info', `Range de texto-base detectado no corpo: questões ${pendingSharedRange[0]}–${pendingSharedRange[1]}`);
          }
        }
        break;

      case STATE.QUESTION_STEM:
        if (currentQuestion) currentQuestion.text += ' ' + text;
        break;

      case STATE.OPTION_A:
        if (currentQuestion) currentQuestion.options.A += ' ' + text;
        break;
      case STATE.OPTION_B:
        if (currentQuestion) currentQuestion.options.B += ' ' + text;
        break;
      case STATE.OPTION_C:
        if (currentQuestion) currentQuestion.options.C += ' ' + text;
        break;
      case STATE.OPTION_D:
        if (currentQuestion) currentQuestion.options.D += ' ' + text;
        break;
      case STATE.OPTION_E:
        if (currentQuestion) currentQuestion.options.E += ' ' + text;
        break;
    }
  }

  // Finalize last question/shared text
  if (state === STATE.SHARED_TEXT) finalizeSharedText();
  finalizeQuestion();

  // Commit any remaining pending shared text
  if (pendingSharedText) {
    sharedTexts.push(pendingSharedText);
    pendingSharedText = null;
  }

  // Post-process: validate all questions
  questions.forEach(q => {
    const missingOpts = OPTION_LETTERS.filter(l => !q.options[l]);
    if (missingOpts.length > 0) {
      log('warning', `Alternativas faltando: ${missingOpts.join(', ')}`, q.id);
    }
    if (!q.sharedTextId && q.id <= 10) {
      // Check if any shared text covers this question
      const matching = sharedTexts.find(st =>
        st.questionRange && q.id >= st.questionRange[0] && q.id <= st.questionRange[1]
      );
      if (matching) q.sharedTextId = matching.id;
    }
  });

  log('info', `Parsing concluído: ${questions.length} questões, ${sharedTexts.length} textos-base`);

  return { questions, sharedTexts, parsingLog };
}

// ─────────────────────────────────────────────────────────────────────────────
// CONFIDENCE SCORE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate a 0-100 confidence score for a parsed question.
 * @param {Object} q - question object
 * @returns {{ score: number, details: string[] }}
 */
export function calcConfidence(q) {
  const W = CONFIDENCE_WEIGHTS;
  let score = 0;
  const details = [];

  // Stem quality
  const stemWords = wordCount(q.text);
  if (stemWords >= W.STEM_WORDS_MIN) {
    score += W.STEM_WORDS_SCORE;
  } else {
    details.push(`enunciado curto (${stemWords} palavras)`);
  }

  // Options presence and quality
  let optionsPresent = 0;
  let optionsGood = 0;
  OPTION_LETTERS.forEach(l => {
    if (q.options[l] && q.options[l].trim().length > 0) {
      optionsPresent++;
      score += W.OPTION_PRESENT_SCORE;
      if (wordCount(q.options[l]) >= W.OPTION_WORDS_MIN) optionsGood++;
    } else {
      details.push(`alternativa ${l} vazia`);
    }
  });

  if (optionsGood === 5) {
    score += W.OPTION_WORDS_SCORE;
  } else if (optionsGood < 3) {
    details.push(`alternativas com poucas palavras`);
  }

  // Penalties
  if (q.requiresPDF) {
    score -= W.REQUIRES_PDF_PENALTY;
    details.push('requer PDF (imagem detectada)');
  }

  const lastChar = q.text.slice(-1);
  const hasEndPunctuation = /[.?!:;]/.test(lastChar);
  if (!hasEndPunctuation && stemWords > 5) {
    score -= W.TRUNCATED_PENALTY;
    details.push('enunciado pode estar truncado');
  }

  // Missing option sequence penalty
  const missingCount = 5 - optionsPresent;
  if (missingCount > 0) {
    score -= missingCount * W.MISSING_OPTION_PENALTY;
  }

  return { score: Math.max(0, Math.min(100, score)), details };
}

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function wordCount(str) {
  return (str || '').trim().split(/\s+/).filter(Boolean).length;
}
