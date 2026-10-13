import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import {
  motion,
  useInView,
  useScroll,
  useSpring,
  useTransform,
  useVelocity,
  useAnimationFrame,
  useMotionValue,
  useMotionValueEvent,
  type Variants,
} from 'framer-motion';
import { useAuth } from '../api/auth';
import { usePrefersReducedMotion } from '../hooks/useMediaQuery';
import { useCursorGlow } from '../hooks/useCursorGlow';
import { ButtonLink } from '../components/ui/ButtonLink';
import './LandingPage.css';

const GITHUB_URL = 'https://github.com/thisux1/singular';

/* ─── Motion — lente "polish": enter com blur+rise (a mesma linguagem CRT
   da PageTransition do app, só que mais leve). Reduced-motion → só fade. ─── */
const EASE_OUT = [0.16, 1, 0.3, 1] as const;

function useEnterVariants(): {
  container: Variants;
  item: Variants;
  card: Variants;
  wordGroup: Variants;
  word: Variants;
} {
  const reduced = usePrefersReducedMotion();
  const fade: Variants = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.15 } },
  };
  return {
    /* Título: cada palavra sobe com leve rotateX + blur — o reveal por
       palavra dá cadência; a accent entra por último e ancora a linha. */
    wordGroup: {
      hidden: {},
      show: { transition: { staggerChildren: reduced ? 0.02 : 0.1, delayChildren: reduced ? 0 : 0.12 } },
    },
    word: reduced
      ? fade
      : {
          hidden: { opacity: 0, y: '0.55em', rotateX: 40, filter: 'blur(5px)' },
          show: {
            opacity: 1,
            y: 0,
            rotateX: 0,
            filter: 'blur(0px)',
            transition: { duration: 0.7, ease: EASE_OUT },
          },
        },
    container: {
      hidden: {},
      show: { transition: { staggerChildren: reduced ? 0.03 : 0.08 } },
    },
    item: reduced
      ? fade
      : {
          hidden: { opacity: 0, y: 26, filter: 'blur(6px) hue-rotate(50deg)' },
          show: {
            opacity: 1,
            y: 0,
            filter: 'blur(0px) hue-rotate(0deg)',
            transition: { duration: 0.55, ease: EASE_OUT },
          },
        },
    /* Cards: materialização com leve scale — textura diferente dos
       textos (que só sobem), consistente entre step/feature/selfhost. */
    card: reduced
      ? fade
      : {
          hidden: { opacity: 0, y: 18, scale: 0.965, filter: 'blur(5px)' },
          show: {
            opacity: 1,
            y: 0,
            scale: 1,
            filter: 'blur(0px)',
            transition: { duration: 0.6, ease: EASE_OUT },
          },
        },
  };
}

/* ─── Cards com spotlight — li/div chanfrados que ganham a camada
   .card-glow seguindo o cursor (useCursorGlow). O clip do .terminal
   garante que o spotlight não vaza do chanfro. ─── */
function GlowLi({ className, variants, children }: { className: string; variants: Variants; children: ReactNode }) {
  const glow = useCursorGlow<HTMLLIElement>();
  return (
    <motion.li className={className} variants={variants} {...glow}>
      <i className="card-glow" aria-hidden="true" />
      {children}
    </motion.li>
  );
}

function GlowDiv({ className, variants, children }: { className: string; variants: Variants; children: ReactNode }) {
  const glow = useCursorGlow<HTMLDivElement>();
  return (
    <motion.div className={className} variants={variants} {...glow}>
      <i className="card-glow" aria-hidden="true" />
      {children}
    </motion.div>
  );
}

/* ─── Ticker marquee — velocity-driven: a fita acelera e até inverte
   com a velocidade do scroll (assinatura awwwards — motion-recipes).
   x em % da track (conteúdo duplicado, wrap em -50%). ─── */
const TICKER_ITEMS = [
  'upload pdf', 'ocr', 'extração ia', 'classificação', 'revisão',
  'modo quiz', 'revisão de erros', 'banco global', 'dedup', 'xp & streak', 'stats',
];

function Ticker() {
  const reduced = usePrefersReducedMotion();
  const baseX = useMotionValue(0);
  const { scrollY } = useScroll();
  const scrollVelocity = useVelocity(scrollY);
  const smoothVelocity = useSpring(scrollVelocity, { damping: 50, stiffness: 400 });
  const velocityFactor = useTransform(smoothVelocity, [0, 1000], [0, 4], { clamp: false });
  const direction = useRef(1);

  useAnimationFrame((_, delta) => {
    if (reduced) return;
    let moveBy = direction.current * 3 * (delta / 1000); // %/s base
    const vf = velocityFactor.get();
    if (vf < 0) direction.current = -1;
    else if (vf > 0) direction.current = 1;
    moveBy += direction.current * moveBy * vf;
    let x = baseX.get() + moveBy;
    if (x <= -50) x += 50;
    else if (x > 0) x -= 50;
    baseX.set(x);
  });

  const x = useTransform(baseX, (v) => `${v}%`);

  return (
    <div className="landing__ticker" aria-hidden="true">
      <motion.div className="landing__ticker-track" style={{ x }}>
        {[...TICKER_ITEMS, ...TICKER_ITEMS].map((item, i) => (
          <span className="landing__ticker-item" key={i}>
            {item} <span className="landing__ticker-sep">//</span>
          </span>
        ))}
      </motion.div>
    </div>
  );
}

/* ─── Parallax de seção — desliza ±amount px conforme o elemento
   atravessa o viewport (start end → end start). Profundidade leve. ─── */
function ParallaxY({ amount = 22, className, children }: { amount?: number; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });
  const y = useTransform(scrollYProgress, [0, 1], [amount, -amount]);
  return (
    <motion.div ref={ref} className={className} style={reduced ? undefined : { y }}>
      {children}
    </motion.div>
  );
}

/* ─── Progress hairline — scaleX do scroll global sob a topbar. ─── */
function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 140, damping: 28, restDelta: 0.001 });
  return <motion.div className="landing__progress" style={{ scaleX }} aria-hidden="true" />;
}

/* ─── Terminal de extração — a "ilustração" da LP: o produto digitando
   a si mesmo. Linhas aparecem em cadência; loop infinito. ─── */
const LOG_LINES = [
  '> ingest prova_2024.pdf',
  '> ocr — 40 questões detectadas',
  '> classify — Matemática · média',
  '> gabarito sincronizado',
  '> status: pronto p/ simulado',
];

function ExtractionLog() {
  const reduced = usePrefersReducedMotion();
  const [count, setCount] = useState(reduced ? LOG_LINES.length : 0);

  useEffect(() => {
    if (reduced) return;
    const id = window.setInterval(() => {
      setCount((c) => (c >= LOG_LINES.length + 1 ? 0 : c + 1));
    }, 700);
    return () => window.clearInterval(id);
  }, [reduced]);

  const visible = reduced ? LOG_LINES : LOG_LINES.slice(0, Math.min(count, LOG_LINES.length));

  return (
    <div className="landing__hero-log" role="img" aria-label="Demonstração: terminal extraindo questões de uma prova">
      {visible.map((line, i) => (
        <div className="landing__hero-log-line" key={`${i}-${line}`}>{line}</div>
      ))}
      <span className="landing__hero-log-caret" aria-hidden="true">█</span>
    </div>
  );
}

/* ─── Terminal self-host — digita os comandos quando entra em view:
   "o produto falando por si", mesmo motivo do log do hero. ─── */
const SELFHOST_CMDS = [
  `git clone ${GITHUB_URL}.git`,
  'docker compose up',
];

function SelfhostTerminal() {
  const ref = useRef<HTMLPreElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const reduced = usePrefersReducedMotion();
  const full = SELFHOST_CMDS.join('\n');
  const [len, setLen] = useState(reduced ? full.length : 0);

  useEffect(() => {
    if (!inView || reduced) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 2;
      setLen(i);
      if (i >= full.length) window.clearInterval(id);
    }, 22);
    return () => window.clearInterval(id);
  }, [inView, reduced, full]);

  const typed = full.slice(0, len);
  const lines = typed.split('\n');

  return (
    <pre
      ref={ref}
      className="landing__selfhost-terminal term-log"
      aria-label="Comando de instalação"
    >
      <code>
        {lines.map((line, i) => (
          <span key={i}>
            <span className="landing__term-prompt">$ </span>
            {line}
            {'\n'}
          </span>
        ))}
      </code>
      <span className="landing__hero-log-caret" aria-hidden="true">█</span>
    </pre>
  );
}

/* ─── HUD de scroll — leitura de posição em % estilo instrumento. ─── */
function ScrollHud() {
  const { scrollYProgress } = useScroll();
  const [pct, setPct] = useState(0);
  useMotionValueEvent(scrollYProgress, 'change', (v) => setPct(Math.round(v * 100)));
  return (
    <div className="landing__scroll-hud" aria-hidden="true">
      SCROLL <span>{String(pct).padStart(3, '0')}%</span>
    </div>
  );
}

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
  const { container, item, card, wordGroup, word } = useEnterVariants();
  const reduced = usePrefersReducedMotion();

  /* Parallax do hero: conteúdo sobe mais devagar que o scroll e some
     suave — profundidade contra o Gargantua que fica fixo atrás. */
  const heroRef = useRef<HTMLElement>(null);
  const { scrollYProgress: heroP } = useScroll({
    target: heroRef,
    offset: ['start start', 'end start'],
  });
  const heroY = useTransform(heroP, [0, 1], [0, -80]);
  const heroO = useTransform(heroP, [0, 0.9], [1, 0.1]);

  return (
    <div className="landing">
      <ScrollHud />
      {/* ─── Top bar público ─── */}
      <header className="landing__topbar glass glass--bar">
        <ScrollProgress />
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
        <motion.section
          ref={heroRef}
          className="landing__hero page-container"
          aria-labelledby="landing-hero-title"
          variants={container}
          initial="hidden"
          animate="show"
          style={reduced ? undefined : { y: heroY, opacity: heroO }}
        >
          <motion.p className="landing__kicker kicker kicker--accent" variants={item}>
            provas → questões → simulados
          </motion.p>
          <motion.h1 className="landing__hero-title" id="landing-hero-title" variants={wordGroup}>
            {['Sua', 'máquina', 'de'].map((w) => (
              <motion.span className="landing__word" variants={word} key={w}>
                {w}&nbsp;
              </motion.span>
            ))}
            <motion.span className="landing__hero-accent landing__word" variants={word}>
              simulados
            </motion.span>
          </motion.h1>
          <motion.p className="landing__hero-sub" variants={item}>
            Suba o PDF de uma prova. A Singular extrai as questões com IA, você revisa
            e transforma tudo em simulados com estatísticas por disciplina.
          </motion.p>
          <motion.div className="landing__hero-actions" variants={item}>
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
          </motion.div>
          <motion.div variants={item}>
            <ExtractionLog />
          </motion.div>
        </motion.section>

        <Ticker />

        {/* ─── Como funciona ─── */}
        <motion.section
          className="landing__section page-container"
          id="como-funciona"
          aria-labelledby="landing-steps-title"
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
        >
          <motion.header className="landing__section-head" variants={item}>
            <ParallaxY>
              <p className="landing__kicker kicker kicker--accent">pipeline</p>
              <h2 className="landing__section-title" id="landing-steps-title">Como funciona</h2>
            </ParallaxY>
          </motion.header>
          <ol className="landing__steps">
            {STEPS.map((step) => (
              <GlowLi className="terminal terminal--cut-b landing__step" variants={card} key={step.num}>
                <span className="landing__step-num kicker" aria-hidden="true">{step.num}</span>
                <span className="landing__step-icon" aria-hidden="true">{step.icon}</span>
                <h3 className="landing__step-title">{step.title}</h3>
                <p className="landing__step-text">{step.text}</p>
              </GlowLi>
            ))}
          </ol>
        </motion.section>

        {/* ─── Features ─── */}
        <motion.section
          className="landing__section page-container"
          aria-labelledby="landing-features-title"
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
        >
          <motion.header className="landing__section-head" variants={item}>
            <ParallaxY>
              <p className="landing__kicker kicker kicker--accent">sistema</p>
              <h2 className="landing__section-title" id="landing-features-title">
                Feito para estudar de verdade
              </h2>
            </ParallaxY>
          </motion.header>
          <ul className="landing__features">
            {FEATURES.map((feature) => (
              <GlowLi
                className="terminal terminal--cut-b landing__feature"
                key={feature.title}
                variants={card}
              >
                <span className="landing__feature-icon" aria-hidden="true">{feature.icon}</span>
                <h3 className="landing__feature-title">{feature.title}</h3>
                <p className="landing__feature-text">{feature.text}</p>
              </GlowLi>
            ))}
          </ul>
        </motion.section>

        {/* ─── Self-host ─── */}
        <motion.section
          className="landing__section page-container"
          aria-labelledby="landing-selfhost-title"
          variants={container}
          initial="hidden"
          whileInView="show"
          viewport={{ once: true, margin: '-60px' }}
        >
          <GlowDiv className="terminal terminal--cut-b landing__selfhost" variants={card}>
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
            <SelfhostTerminal />
          </GlowDiv>
        </motion.section>
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
