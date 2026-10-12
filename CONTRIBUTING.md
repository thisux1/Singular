# Contributing — Singular

## Setup

```bash
npm install && npm install --prefix backend && npm install --prefix frontend
cp .env.example .env          # dev local: AUTH_DISABLED=true já funciona sem Google
docker compose up -d          # postgres + redis
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
npm run all                   # migrate + api :3001 + workers + frontend :5173
```

## Verificação antes de PR

```bash
npm run build --prefix backend    # tsc
npm test --prefix backend         # vitest (parsers, repos, quiz)
.venv/bin/python -m pytest pipeline/tests
npm run lint --prefix frontend && npm run build --prefix frontend
npm run e2e                       # playwright (requer stack rodando)
```

## Convenções

- **Docs de produto** em `docs/product/` são a fonte de verdade (PRD, TRD, APP-FLOW, DESIGN-BRIEF, BACKEND-SCHEMA, IMPLEMENTATION-PLAN). Mudança de comportamento → atualize o spec.
- Backend: rotas em `routes/`, acesso a dados só via `repositories/`, jobs em `jobs/`. Sem `@ts-nocheck` novo.
- Frontend: vanilla CSS com tokens (`styles/tokens.css`) — sem utility framework (decisão registrada). Componentes novos seguem o padrão `components/<dominio>/Nome.tsx + Nome.css`.
- Pipeline: contrato stdio JSON documentado em `docs/product/BACKEND-SCHEMA.md` §3 — mudanças no contrato exigem atualização do TS.
- Commits: mensagem descrevendo o *porquê*. Sem secrets no repo (`.env` é gitignored).
- Journal: etapas aprovadas ganham linha em `docs/plans/journal.md` (ver AGENTS.md do repo).
