# E2E — Playwright

Specs de fluxo feliz contra a stack **real** (sem mocks): home/lista,
detalhe da prova e simulação completa (setup → player → resultado).

## Pré-requisitos

- Postgres + Redis no ar (`docker compose up -d`) — containers `singular-db`/`singular-redis`.
- API rodando (`npm run dev --prefix backend`, default :3001).
- Frontend rodando (`npm run dev --prefix frontend`, default :5190).
- Browsers: `npx playwright install chromium` (uma vez).

## Rodar

```bash
npm run e2e            # specs contra http://localhost:5190 (default)
npm run e2e:seed       # só o seed (imprime o examId)
npm run test:all       # backend vitest + pipeline pytest + e2e
```

O `globalSetup` roda `e2e/seed.mjs` automaticamente: cria a prova
**"E2E Prova Sintética"** (status `completed`, 5 questões — 1 anulada,
1 com imagem) e grava `e2e/.e2e-state.json` com o `examId`. O seed é
idempotente (apaga pelo título-marker antes de inserir; cascade limpa
questões/sessões antigas).

## Variáveis

| Var | Default | Uso |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:5190` | baseURL dos specs |
| `E2E_WEB_COMMAND` | `npm run dev` do frontend | comando do webServer quando a porta está livre |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/quizsaber` | banco do seed |

## Stack isolada (recomendado p/ não depender do dev do usuário)

```bash
# terminal 1 — API dedicada na :3005 (CORS liberado p/ o vite de teste)
cd backend && PORT=3005 CORS_ORIGINS=http://localhost:5401 npx tsx src/index.ts

# terminal 2 — vite dedicado na :5401 apontando para a API :3005
cd frontend && VITE_API_URL=http://localhost:3005/api VITE_AUTH_DISABLED=true npx vite --port 5401 --strictPort

# terminal 3 — specs
E2E_BASE_URL=http://localhost:5401 npm run e2e
```

## CI

`.github/workflows/ci.yml` → job `e2e`: sobe Postgres/Redis em services,
migra o banco (`singular`), builda backend+frontend, sobe a API em :3001 e
deixa o `webServer` do Playwright subir `vite preview` em :5190
(`E2E_WEB_COMMAND`). Workers **não** sobem — o seed injeta questões
direto no banco, nenhum spec passa pelo pipeline de OCR.
Report HTML em `e2e/playwright-report/` (artifact em falha).
