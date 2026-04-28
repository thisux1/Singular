// @ts-nocheck
/**
 * cargo-templates.js
 * Question-to-subject mapping templates per cargo (job role).
 * Cesgranrio has a fixed subject distribution per cargo/exam type.
 *
 * Each subject entry:
 *   name        — display name
 *   icon        — emoji icon
 *   area        — "Conhecimentos Básicos" | "Conhecimentos Específicos"
 *   range       — [firstQuestion, lastQuestion] (inclusive, 1-indexed)
 *   pointsEach  — points per correct answer
 *   color       — chart color
 *   hasSharedText — hint for parser: does this subject typically have shared reading texts?
 */

export const CARGO_TEMPLATES = {

  "agente-tecnologia": {
    label: "Agente de Tecnologia",
    banca: "Cesgranrio",
    totalQuestions: 70,
    subjects: [
      { name: "Língua Portuguesa",             icon: "📝", area: "Conhecimentos Básicos",     color: "#4f83cc", range: [1,  10], pointsEach: 1.5, hasSharedText: true  },
      { name: "Língua Inglesa",                icon: "🌐", area: "Conhecimentos Básicos",     color: "#5c9e6e", range: [11, 15], pointsEach: 1.0, hasSharedText: true  },
      { name: "Matemática",                    icon: "➕", area: "Conhecimentos Básicos",     color: "#e07b39", range: [16, 20], pointsEach: 1.5, hasSharedText: false },
      { name: "Atualidades do Mercado Fin.",   icon: "📈", area: "Conhecimentos Básicos",     color: "#9b59b6", range: [21, 25], pointsEach: 1.0, hasSharedText: false },
      { name: "Probabilidade e Estatística",   icon: "📊", area: "Conhecimentos Específicos", color: "#e74c3c", range: [26, 30], pointsEach: 1.5, hasSharedText: false },
      { name: "Conhecimentos Bancários",       icon: "🏦", area: "Conhecimentos Específicos", color: "#f39c12", range: [31, 40], pointsEach: 1.5, hasSharedText: false },
      { name: "Tecnologia da Informação",      icon: "💻", area: "Conhecimentos Específicos", color: "#1abc9c", range: [41, 70], pointsEach: 1.5, hasSharedText: false },
    ]
  },

  "agente-comercial": {
    label: "Agente Comercial",
    banca: "Cesgranrio",
    totalQuestions: 70,
    subjects: [
      { name: "Língua Portuguesa",             icon: "📝", area: "Conhecimentos Básicos",     color: "#4f83cc", range: [1,  10], pointsEach: 1.5, hasSharedText: true  },
      { name: "Língua Inglesa",                icon: "🌐", area: "Conhecimentos Básicos",     color: "#5c9e6e", range: [11, 15], pointsEach: 1.0, hasSharedText: true  },
      { name: "Matemática",                    icon: "➕", area: "Conhecimentos Básicos",     color: "#e07b39", range: [16, 20], pointsEach: 1.5, hasSharedText: false },
      { name: "Atualidades do Mercado Fin.",   icon: "📈", area: "Conhecimentos Básicos",     color: "#9b59b6", range: [21, 25], pointsEach: 1.0, hasSharedText: false },
      { name: "Matemática Financeira",         icon: "🔢", area: "Conhecimentos Específicos", color: "#e74c3c", range: [26, 30], pointsEach: 1.5, hasSharedText: false },
      { name: "Conhecimentos Bancários",       icon: "🏦", area: "Conhecimentos Específicos", color: "#f39c12", range: [31, 40], pointsEach: 1.5, hasSharedText: false },
      { name: "Conhecimentos de Informática",  icon: "💻", area: "Conhecimentos Específicos", color: "#1abc9c", range: [41, 55], pointsEach: 1.5, hasSharedText: false },
      { name: "Vendas e Negociação",           icon: "🤝", area: "Conhecimentos Específicos", color: "#e91e63", range: [56, 70], pointsEach: 1.5, hasSharedText: false },
    ]
  },

  "escriturario": {
    label: "Escriturário",
    banca: "Cesgranrio",
    totalQuestions: 70,
    subjects: [
      { name: "Língua Portuguesa",             icon: "📝", area: "Conhecimentos Básicos",     color: "#4f83cc", range: [1,  10], pointsEach: 1.5, hasSharedText: true  },
      { name: "Língua Inglesa",                icon: "🌐", area: "Conhecimentos Básicos",     color: "#5c9e6e", range: [11, 15], pointsEach: 1.0, hasSharedText: true  },
      { name: "Matemática",                    icon: "➕", area: "Conhecimentos Básicos",     color: "#e07b39", range: [16, 20], pointsEach: 1.5, hasSharedText: false },
      { name: "Atualidades do Mercado Fin.",   icon: "📈", area: "Conhecimentos Básicos",     color: "#9b59b6", range: [21, 25], pointsEach: 1.0, hasSharedText: false },
      { name: "Matemática Financeira",         icon: "🔢", area: "Conhecimentos Específicos", color: "#e74c3c", range: [26, 30], pointsEach: 1.5, hasSharedText: false },
      { name: "Conhecimentos Bancários",       icon: "🏦", area: "Conhecimentos Específicos", color: "#f39c12", range: [31, 45], pointsEach: 1.5, hasSharedText: false },
      { name: "Vendas e Negociação",           icon: "🤝", area: "Conhecimentos Específicos", color: "#e91e63", range: [46, 60], pointsEach: 1.5, hasSharedText: false },
      { name: "Conhecimentos de Informática",  icon: "💻", area: "Conhecimentos Específicos", color: "#1abc9c", range: [61, 70], pointsEach: 1.5, hasSharedText: false },
    ]
  },

  "escriturario-agente-comercial": {
    label: "Escriturário – Agente Comercial e Administrativo",
    banca: "Cesgranrio",
    totalQuestions: 70,
    subjects: [
      { name: "Língua Portuguesa",             icon: "📝", area: "Conhecimentos Básicos",     color: "#4f83cc", range: [1,  10], pointsEach: 1.5, hasSharedText: true  },
      { name: "Língua Inglesa",                icon: "🌐", area: "Conhecimentos Básicos",     color: "#5c9e6e", range: [11, 15], pointsEach: 1.0, hasSharedText: true  },
      { name: "Matemática",                    icon: "➕", area: "Conhecimentos Básicos",     color: "#e07b39", range: [16, 20], pointsEach: 1.5, hasSharedText: false },
      { name: "Atualidades do Mercado Fin.",   icon: "📈", area: "Conhecimentos Básicos",     color: "#9b59b6", range: [21, 25], pointsEach: 1.0, hasSharedText: false },
      { name: "Conhecimentos Bancários",       icon: "🏦", area: "Conhecimentos Específicos", color: "#f39c12", range: [26, 45], pointsEach: 1.5, hasSharedText: false },
      { name: "Atualidades",                   icon: "🌍", area: "Conhecimentos Específicos", color: "#8e44ad", range: [46, 50], pointsEach: 1.0, hasSharedText: false },
      { name: "Matemática Financeira",         icon: "🔢", area: "Conhecimentos Específicos", color: "#e74c3c", range: [51, 55], pointsEach: 1.5, hasSharedText: false },
      { name: "Vendas e Negociação",           icon: "🤝", area: "Conhecimentos Específicos", color: "#e91e63", range: [56, 70], pointsEach: 1.5, hasSharedText: false },
    ]
  },

};

interface CargoTemplateCatalogItem {
  id: string;
  label: string;
  banca: string;
  totalQuestions: number;
}

export function isValidCargoTemplateId(id: string): boolean {
  return typeof id === 'string' && id in CARGO_TEMPLATES;
}

export function listCargoTemplateCatalog(): CargoTemplateCatalogItem[] {
  return Object.entries(CARGO_TEMPLATES).map(([id, template]) => ({
    id,
    label: template.label,
    banca: template.banca,
    totalQuestions: template.totalQuestions,
  }));
}

export function inferSubjectByCargoTemplate(
  cargoTemplateId: string,
  questionOrder: number,
): string | undefined {
  if (!isValidCargoTemplateId(cargoTemplateId) || !Number.isInteger(questionOrder) || questionOrder <= 0) {
    return undefined;
  }

  const subject = getSubjectForQuestion(cargoTemplateId, questionOrder);
  if (!subject) {
    return undefined;
  }

  return subject.name;
}

/**
 * Get subject for a given question ID within an exam template.
 * @param {string} cargoId - template key
 * @param {number} questionId - 1-indexed question number
 * @param {Object} [overrides] - per-question overrides: { 15: "Matemática", ... }
 * @returns {Object|null} subject object or null
 */
export function getSubjectForQuestion(cargoId, questionId, overrides = {}) {
  if (overrides[questionId]) {
    const template = CARGO_TEMPLATES[cargoId];
    if (!template) return null;
    return template.subjects.find(s => s.name === overrides[questionId]) || null;
  }
  const template = CARGO_TEMPLATES[cargoId];
  if (!template) return null;
  return template.subjects.find(s => questionId >= s.range[0] && questionId <= s.range[1]) || null;
}

/**
 * Build subjects array from template, merging with real question list.
 * @param {string} cargoId
 * @param {Array} questions - [{id, text, options, ...}]
 * @param {Object} [overrides]
 * @returns {Array} subjects with .questions array of IDs
 */
export function buildSubjectsFromTemplate(cargoId, questions, overrides = {}) {
  const template = CARGO_TEMPLATES[cargoId];
  if (!template) return [];
  return template.subjects.map(subj => ({
    ...subj,
    questions: questions
      .filter(q => {
        const s = getSubjectForQuestion(cargoId, q.id, overrides);
        return s && s.name === subj.name;
      })
      .map(q => q.id)
  }));
}
