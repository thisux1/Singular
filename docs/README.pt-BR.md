<div align="center">
  <a href="#root"><img src="./banner.svg?v=2" alt="Singular" width="100%"/></a>
</div>

> 🇺🇸 [English version](../README.md)

<table width="100%">
  <tr>
    <td width="50%" valign="top">
      <pre lang="bash"><code>$ singular / briefing
----------------------------------------------
• entrada  : provas escaneadas · pdf / imagens
• saída    : quizzes jogáveis, JSON tipado
• ocr      : glm-ocr | qwen2.5vl:3b | gemini
• schema   : instructor + pydantic (strict)
• classific: tags por cargo, gemini-2.5-flash
• fastpath : PDF com texto pula OCR (≥ 0.9)</code></pre>
    </td>
    <td width="50%" valign="top">
      <pre lang="python"><code>class Stack:
    frontend = ["react 19.2", "vite 8",
                "three+r3f", "zustand",
                "react-query", "framer-motion"]
    backend  = ["hono 4.6", "bullmq 5.58",
                "drizzle+pg", "pdfjs-dist"]
    pipeline = ["pymupdf", "pdf2image", "ollama",
                "genai", "instructor", "pydantic 2"]
    infra    = "postgres16 + redis7 + ollama"</code></pre>
    </td>
  </tr>
</table>

### ❯ badges

<p align="left">
  <img src="https://img.shields.io/badge/React-19.2-black?style=flat-square&logo=react&logoColor=61DAFB&labelColor=050202" alt="React 19" />
  <img src="https://img.shields.io/badge/Vite-8-black?style=flat-square&logo=vite&logoColor=646CFF&labelColor=050202" alt="Vite 8" />
  <img src="https://img.shields.io/badge/Three.js-R3F-black?style=flat-square&logo=threedotjs&logoColor=white&labelColor=050202" alt="Three.js + R3F" />
  <img src="https://img.shields.io/badge/Hono-4.6-black?style=flat-square&logo=hono&logoColor=E36002&labelColor=050202" alt="Hono" />
  <img src="https://img.shields.io/badge/BullMQ-5.58-black?style=flat-square&logo=redis&logoColor=DC382D&labelColor=050202" alt="BullMQ" />
  <img src="https://img.shields.io/badge/Drizzle-PostgreSQL-black?style=flat-square&logo=postgresql&logoColor=336791&labelColor=050202" alt="Drizzle" />
  <img src="https://img.shields.io/badge/Python-OCR_Pipeline-black?style=flat-square&logo=python&logoColor=3776AB&labelColor=050202" alt="Python" />
  <img src="https://img.shields.io/badge/Ollama-glm--ocr-black?style=flat-square&logo=ollama&logoColor=8B5CF6&labelColor=050202" alt="Ollama" />
  <img src="https://img.shields.io/badge/License-MIT-black?style=flat-square&logo=opensourceinitiative&logoColor=22C55E&labelColor=050202" alt="MIT" />
</p>

---

### ❯ o_que_faz

O Singular ingere provas e documentos escaneados (PDF ou imagem) e os
transforma em quizzes jogáveis. O upload chega numa API Hono, um job BullMQ
roda sobre Redis e uma pipeline Python extrai o conteúdo: o PyMuPDF puxa a
camada de texto quando o PDF tem uma, o `pdf2image` rasteriza o restante e um
VLM faz o OCR (Ollama `glm-ocr` / `qwen2.5vl:3b` localmente, ou Gemini via
API). Instructor + Pydantic convertem o texto bruto em JSON tipado de
questões, o Drizzle persiste no PostgreSQL e o frontend React + Three.js
renderiza o resultado dentro de uma cena de "singularidade". Um segundo
worker classifica cada questão extraída por concurso e cargo.

---

### ❯ demo

<p align="center">
  <video src="https://github.com/user-attachments/assets/021c2bf6-4fed-4eda-addb-9ddb637e6944" width="100%" controls autoplay loop muted playsinline></video>
</p>

---

### ❯ pipeline

<div align="center">
  <img src="./architecture.svg?v=2" alt="Fluxo de dados do Singular" width="100%"/>
</div>

O trajeto de um documento pelo sistema:

1. **Upload:** o cliente envia o arquivo (PDF ou imagem) pela interface web.
2. **Fila:** a API Hono armazena o arquivo, grava os metadados iniciais no
   PostgreSQL via Drizzle e enfileira um job de processamento no Redis.
3. **Consumo:** o worker `process-exam.ts` consome o job pelo BullMQ e chama
   a pipeline Python via IPC (JSON entra no stdin, JSON sai no stdout).
4. **Extração:** PDFs com camada de texto passam direto pelo PyMuPDF e podem
   pular o OCR quando o fast path atinge `FASTPATH_MIN_CONFIDENCE`. Caso
   contrário, as páginas viram imagens (`pdf2image`) e vão para o provedor
   configurado: Ollama local (`glm-ocr`, fallback `qwen2.5vl:3b`) ou Gemini
   no modo `api`.
5. **Estruturação:** o texto extraído vai para um modelo da família Gemini
   via `instructor`, que devolve questões, enunciados e alternativas num
   payload JSON validado por Pydantic.
6. **Persistência:** o worker grava as questões e alternativas no banco; o
   `process-classification.ts` as etiqueta por concurso/cargo.
7. **Consumo:** o frontend detecta o job concluído via React Query e o quiz
   fica jogável.

---

### ❯ modulos

| Módulo | Stack | Papel |
| :--- | :--- | :--- |
| Frontend | React 19.2, Vite 8, Three.js 0.183 (R3F 9 + drei), Zustand, React Query, Framer Motion | SPA com cena 3D de singularidade; CSS vanilla com design tokens, sem framework utilitário |
| API | Hono 4.6, Node.js, TypeScript | API REST: uploads (`routes/exams.ts`), questões, sessões de quiz |
| Workers | BullMQ 5.58, Redis (ioredis) | Jobs assíncronos: `process-exam` (pipeline OCR) e `process-classification` |
| Pipeline de extração | Python 3.10+: instructor, Pydantic 2, PyMuPDF, pdf2image, typer | OCR e estruturação tipada de documentos brutos em JSON de questões |
| Banco | PostgreSQL 16, Drizzle ORM 0.39 | Persistência relacional, migrações via Drizzle Kit |
| Provedores de OCR | Ollama (glm-ocr / qwen2.5vl:3b) ou Google Gemini | OCR local a custo zero ou API em nuvem, comutado por `OCR_PROVIDER` |

---

### ❯ rodar

Pré-requisitos: Node.js 18+, Docker + Compose, Python 3.10+.

**1. Dependências JS**

```bash
npm install
cd backend && npm install && cd ../frontend && npm install && cd ..
```

**2. Ambiente Python (pipeline OCR)**

```bash
python3 -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r pipeline/requirements.txt
```

> No Linux, o `pdf2image` depende do pacote de sistema `poppler`:
> Ubuntu/Debian `sudo apt-get install poppler-utils`, macOS `brew install poppler`.

**3. Variáveis de ambiente**

```bash
cp .env.example .env
```

Defina `OCR_PROVIDER`: `local` usa o Ollama a custo zero; `api` usa o Gemini
e exige `GEMINI_API_KEY`. O modelo de classificação padrão é o
`gemini-2.5-flash` (parâmetros `CLASSIFICATION_*` no `.env.example`).

**4. Modelos de OCR local (opcional)**

```bash
bash scripts/setup-local-ocr.sh
```

Baixa o `glm-ocr` e o fallback `qwen2.5vl:3b` no Ollama. Também dá para
subir o Ollama em Docker com `docker compose --profile local-ocr up`.

**5. Subir tudo de uma vez**

```bash
npm run all
```

Sobe postgres + redis pelo compose, roda as migrações do Drizzle e inicia
api + workers + frontend via `concurrently`.

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`

---

### ❯ mapa_do_repo

<pre lang="text"><code>backend/           API Hono, schema Drizzle, workers BullMQ
  └── src/jobs/    process-exam.ts · process-classification.ts · queue.ts
frontend/          SPA React 19 · canvas de singularidade em three/ · páginas de quiz
pipeline/          engine OCR em Python · main.py, ocr_provider.py, requirements.txt
scripts/           utilitários de setup local (setup-local-ocr.sh, ...)
docs/              banner.svg · architecture.svg · plans, prototypes, qa
docker-compose.yml postgres:16 · redis:7 · ollama (profile: local-ocr)</code></pre>

---

### ❯ design

A interface implementa a linguagem "Singularity UI": superfícies em preto de
vácuo (`#09090B`, `#111115`), flare laranja do disco de acreção
(`#E36002`/`#F97316`) e acento violeta de processamento (`#8B5CF6`). Todo o
layout usa CSS vanilla com design tokens; o 3D e as animações rodam via
React Three Fiber e Framer Motion, sem framework utilitário no bundle.

---

Distribuído sob a [Licença MIT](../LICENSE).
