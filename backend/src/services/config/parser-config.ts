// @ts-nocheck
/**
 * parser-config.js
 * Tuneable thresholds and regex patterns for the PDF parsing pipeline.
 * Adjust these values when testing with new PDFs to calibrate the layout engine.
 */

export const LAYOUT_CONFIG = {
  // Header/Footer detection
  HEADER_ZONE_PCT: 0.08,    // top 8% of page height = header zone
  FOOTER_ZONE_PCT: 0.08,    // bottom 8% of page height = footer zone
  REPEAT_THRESHOLD: 0.70,   // text appearing in ≥70% of pages = header/footer

  // Line reconstruction
  LINE_Y_THRESHOLD: 0.55,   // multiply by fontSize to get Y grouping tolerance
  WORD_GAP_MULTIPLIER: 1.5, // multiply by avg char width to detect word spaces

  // Column detection
  COLUMN_GAP_PCT: 0.05,     // gap zone must be ≥5% of page width (Cesgranrio uses ~6-8% gap)
  COLUMN_GAP_DENSITY: 0.03, // gap zone must have <3% of all fragments per bucket
  COLUMN_CENTER_TOLERANCE: 0.30, // gap must be within 30-70% of page width (avoids right-margin false gaps)
};

export const CONFIDENCE_WEIGHTS = {
  STEM_WORDS_MIN: 10,        // minimum words in stem for full score
  STEM_WORDS_SCORE: 30,      // score for having ≥10 words
  OPTION_PRESENT_SCORE: 15,  // score per option present (A-E) = up to 75
  OPTION_WORDS_MIN: 3,       // minimum words per option for bonus
  OPTION_WORDS_SCORE: 10,    // bonus if all options have ≥3 words
  REQUIRES_PDF_PENALTY: 20,  // penalty if requiresPDF = true
  TRUNCATED_PENALTY: 15,     // penalty if stem seems truncated (no punctuation end)
  MISSING_OPTION_PENALTY: 10,// penalty per missing option in sequence
};

// Guard rails to avoid confirming numbered instruction blocks as questions
export const PARSER_GUARDS = {
  MIN_STEM_WORDS: 5,                    // minimum stem words to confirm a real question
  MIN_USEFUL_OPTIONS: 1,                // minimum non-empty, useful options to confirm
  MIN_CONFIRMATION_SCORE: 45,           // minimum confidence score for confirmation
  MAX_FORWARD_JUMP: 5,                  // max accepted positive jump in question sequence
  MAX_FIRST_QUESTION_NUMBER: 20,        // first detected question number upper bound
  SEQUENCE_RESET_TARGET: 1,             // valid reset target when previous block is weak
  WEAK_BLOCK_MIN_ITEMS: 4,              // min block size to consider reset-based reclassification
  WEAK_BLOCK_MAX_AVG_SCORE: 40,         // weak block threshold for average confidence
  WEAK_BLOCK_MAX_AVG_USEFUL_OPTIONS: 3, // weak block threshold for average useful options
};

// Cesgranrio-specific patterns
export const CESGRANRIO_PATTERNS = {
  // Question number: "1.", "1-", "1)", "01.", "1 –" etc. (number + separator + text on same line)
  QUESTION_START: /^\s*(\d{1,2})\s*[.\-–—)]\s+/,

  // Question number alone on a line (Cesgranrio format: number on its own line, text on next)
  QUESTION_NUMBER_ALONE: /^\s*(\d{1,2})\s*$/,

  // Alternative markers: "(A)", "(B)", "(A) " with optional leading whitespace
  OPTION_MARKER: /^\s*\(([A-E])\)\s*/,

  // Shared text triggers
  SHARED_TEXT_RANGE: /quest[õo]es?\s+(\d{1,2})\s+[ae]\s+(\d{1,2})/i,
  SHARED_TEXT_LEAD: /^(Leia|Com base|Considere|A partir|Segundo|Observe|Analise|O texto|O trecho|O fragmento|Os textos)/i,

  // Gabarito patterns
  GABARITO_PAIR: /(\d{1,2})\s*[-–:.\s]\s*([A-Ea-e*])\b/g,
  GABARITO_ANNULLED: /anulad[ao]/i,
  GABARITO_PROVA_HEADER: /\b(?:gabarito|prova)\b/i,

  // Scratch paper marker — strip this and everything after it
  SCRATCH_PAPER: /\bRASCUNHO\b/i,
};
