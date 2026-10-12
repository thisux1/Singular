import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../api/auth';
import { ButtonLink } from '../components/ui/ButtonLink';
import './LandingPage.css';

const GITHUB_URL = 'https://github.com/thisux1/singular';

type Step = { num: string; title: string; text: string; icon: ReactNode };

const ICON_PROPS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

const STEPS: Step[] = [
  {
    num: '01',
    title: 'Upload do PDF',
    text: 'Envie a prova e o gabarito em PDF. O processamento roda em segundo plano.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="12" y1="18" x2="12" y2="11" />
        <polyline points="9 14 12 11 15 14" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'Extração por IA',
    text: 'O parser reconstrói enunciados, alternativas, imagens e o gabarito oficial.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
        <path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Revisão',
    text: 'Inspecione cada questão extraída, ajuste o que precisar e publique a prova.',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="11" cy="11" r="7" />
        <line x1="21" y1="21" x2="16.5" y2="16.5" />
        <polyline points="8 11 10.2 13.2 14.5 9" />
      </svg>
    ),
  },
  {
    num: '04',
    title: 'Simulado + stats',
    text: 'Responda com feedback imediato e receba diagnóstico, XP e precisão por disciplina.',
    icon: (
      <svg {...ICON_PROPS}>
        <polyline points="3 17 9 11 13 15 21 7" />
        <polyline points="15 7 21 7 21 13" />
      </svg>
    ),
  },
];

type Feature = { title: string; text: string; icon: ReactNode };

const FEATURES: Feature[] = [
  {
    title: 'Banco de questões',
    text: 'Todas as questões extraídas, filtráveis por disciplina, assunto, banca e ano.',
    icon: (
      <svg {...ICON_PROPS}>
        <ellipse cx="12" cy="5" rx="8" ry="3" />
        <path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5" />
        <path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
      </svg>
    ),
  },
  {
    title: '4+1 modos',
    text: 'Prova completa, por disciplinas, aleatório, revisão de erros — e simulado montado do banco.',
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="3" y="3" width="8" height="8" rx="1" />
        <rect x="13" y="3" width="8" height="8" rx="1" />
        <rect x="3" y="13" width="8" height="8" rx="1" />
        <rect x="13" y="13" width="8" height="8" rx="1" />
      </svg>
    ),
  },
  {
    title: 'Revisão de erros',
    text: 'Refaça só o que errou — o modo wrong monta a sessão com seus próprios tropeços.',
    icon: (
      <svg {...ICON_PROPS}>
        <polyline points="1 4 1 10 7 10" />
        <path d="M3.5 15a9 9 0 1 0 2.1-9.4L1 10" />
      </svg>
    ),
  },
  {
    title: 'AI explain',
    text: 'Explicação sob demanda para cada questão, direto na tela de resultado.',
    icon: (
      <svg {...ICON_PROPS}>
        <path d="M9 18h6" />
        <path d="M10 21h4" />
        <path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z" />
      </svg>
    ),
  },
  {
    title: 'Stats & XP',
    text: 'Nível, streak diário, badges e precisão por disciplina — progresso mensurável.',
    icon: (
      <svg {...ICON_PROPS}>
        <circle cx="12" cy="8" r="5" />
        <polyline points="8.5 12.5 7 22 12 19 17 22 15.5 12.5" />
      </svg>
    ),
  },
  {
    title: 'Dedup global',
    text: 'Prova já processada por outra pessoa? A extração é reaproveitada — resposta instantânea.',
    icon: (
      <svg {...ICON_PROPS}>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
      </svg>
    ),
  },
];

export function LandingPage() {
  const { isAuthenticated, authDisabled } = useAuth();
  const canEnter = isAuthenticated || authDisabled;

  return (
    <div className="landing">
      {/* ─── Top bar público ─── */}
      <header className="landing__topbar glass glass--bar">
        <div className="landing__topbar-inner page-container">
          <Link className="landing__wordmark" to="/" aria-label="Singular — página inicial">
            <span className="landing__wordmark-icon" aria-hidden="true">⌘</span>
            Singular
          </Link>
          <nav className="landing__topnav" aria-label="Navegação de entrada">
            {canEnter ? (
              <ButtonLink className="landing__cta" to="/app">
                Abrir o app
              </ButtonLink>
            ) : (
              <>
                <ButtonLink className="landing__cta" variant="ghost" to="/login">
                  Entrar
                </ButtonLink>
                <ButtonLink className="landing__cta" to="/signup">
                  Criar conta
                </ButtonLink>
              </>
            )}
          </nav>
        </div>
      </header>

      <main>
        {/* ─── Hero ─── */}
        <section className="landing__hero page-container" aria-labelledby="landing-hero-title">
          <p className="landing__kicker kicker kicker--accent">provas → questões → simulados</p>
          <h1 className="landing__hero-title" id="landing-hero-title">
            Sua máquina de <span className="landing__hero-accent">simulados</span>
          </h1>
          <p className="landing__hero-sub">
            Suba o PDF de uma prova. A Singular extrai as questões com IA, você revisa
            e transforma tudo em simulados com estatísticas por disciplina.
          </p>
          <div className="landing__hero-actions">
            {canEnter ? (
              <ButtonLink className="landing__cta landing__cta--lg" to="/app">
                Abrir o app
              </ButtonLink>
            ) : (
              <ButtonLink className="landing__cta landing__cta--lg" to="/signup">
                Criar conta grátis
              </ButtonLink>
            )}
            <ButtonLink className="landing__cta landing__cta--lg" variant="ghost" href="#como-funciona">
              Como funciona
            </ButtonLink>
          </div>
        </section>

        {/* ─── Como funciona ─── */}
        <section
          className="landing__section page-container"
          id="como-funciona"
          aria-labelledby="landing-steps-title"
        >
          <header className="landing__section-head">
            <p className="landing__kicker kicker kicker--accent">pipeline</p>
            <h2 className="landing__section-title" id="landing-steps-title">Como funciona</h2>
          </header>
          <ol className="landing__steps">
            {STEPS.map((step) => (
              <li className="terminal terminal--cut-b landing__step" key={step.num}>
                <span className="landing__step-num kicker" aria-hidden="true">{step.num}</span>
                <span className="landing__step-icon" aria-hidden="true">{step.icon}</span>
                <h3 className="landing__step-title">{step.title}</h3>
                <p className="landing__step-text">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        {/* ─── Features ─── */}
        <section className="landing__section page-container" aria-labelledby="landing-features-title">
          <header className="landing__section-head">
            <p className="landing__kicker kicker kicker--accent">sistema</p>
            <h2 className="landing__section-title" id="landing-features-title">
              Feito para estudar de verdade
            </h2>
          </header>
          <ul className="landing__features">
            {FEATURES.map((feature) => (
              <li className="terminal terminal--cut-b landing__feature" key={feature.title}>
                <span className="landing__feature-icon" aria-hidden="true">{feature.icon}</span>
                <h3 className="landing__feature-title">{feature.title}</h3>
                <p className="landing__feature-text">{feature.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* ─── Self-host ─── */}
        <section className="landing__section page-container" aria-labelledby="landing-selfhost-title">
          <div className="terminal terminal--cut-b landing__selfhost">
            <div className="landing__selfhost-flare" aria-hidden="true" />
            <div className="landing__selfhost-copy">
              <p className="landing__kicker kicker kicker--accent">open-source</p>
              <h2 className="landing__section-title" id="landing-selfhost-title">
                Self-host com um comando
              </h2>
              <p className="landing__selfhost-text">
                Código aberto, dados na sua máquina. Suba o stack completo — API,
                worker e frontend — com Docker.
              </p>
              <ButtonLink
                className="landing__cta"
                variant="ghost"
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub ↗
              </ButtonLink>
            </div>
            <pre className="landing__selfhost-terminal term-log" aria-label="Comando de instalação">
              <code>
                <span className="landing__term-prompt">$ </span>
                git clone {GITHUB_URL}.git{'\n'}
                <span className="landing__term-prompt">$ </span>
                docker compose up
              </code>
            </pre>
          </div>
        </section>
      </main>

      {/* ─── Footer ─── */}
      <footer className="landing__footer">
        <div className="landing__footer-inner page-container">
          <span className="landing__footer-mark">Singular</span>
          <span className="landing__footer-note kicker">estude na borda do horizonte de eventos</span>
        </div>
      </footer>
    </div>
  );
}
