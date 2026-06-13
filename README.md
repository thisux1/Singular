<!-- BANNER ANIMADO DA SINGULARIDADE -->
<p align="center">
  <img src="docs/banner.svg" alt="Singular Banner" width="100%" style="border-radius: 8px; border: 1px solid rgba(234, 88, 12, 0.15);" />
</p>

<!-- TECH BADGES MINIMALISTAS E HIGH-TECH -->
<p align="center">
  <img src="https://img.shields.io/badge/React-18.3-black?style=flat-square&logo=react&logoColor=61DAFB&labelColor=050202" alt="React" />
  <img src="https://img.shields.io/badge/CSS3-Vanilla-black?style=flat-square&logo=css3&logoColor=1572B6&labelColor=050202" alt="CSS" />
  <img src="https://img.shields.io/badge/Hono-Node.js-black?style=flat-square&logo=hono&logoColor=E36002&labelColor=050202" alt="Hono" />
  <img src="https://img.shields.io/badge/Drizzle-PostgreSQL-black?style=flat-square&logo=postgresql&logoColor=336791&labelColor=050202" alt="Drizzle" />
  <img src="https://img.shields.io/badge/BullMQ-Redis-black?style=flat-square&logo=redis&logoColor=DC382D&labelColor=050202" alt="BullMQ" />
  <img src="https://img.shields.io/badge/Python-OCR_Engine-black?style=flat-square&logo=python&logoColor=3776AB&labelColor=050202" alt="Python" />
  <img src="https://img.shields.io/badge/Ollama-GLM_OCR-black?style=flat-square&logo=ollama&logoColor=white&labelColor=050202" alt="Ollama" />
</p>

---

## 🌌 Visão Geral

**Singular** é uma plataforma web premium para geração automatizada de quizzes e exames a partir de documentos (PDFs, imagens e exames escaneados). Ele utiliza pipelines de IA de ponta para extração estruturada de conteúdo e apresenta uma experiência visual ultra-imersiva baseada na estética **"A Singularidade"** (Dark mode profundo, linhas elegantes de alta precisão e micro-transições de alto desempenho a 60fps).

---

## 🎬 Demonstração em Órbita

Abaixo está uma demonstração visual do funcionamento do ecossistema e sua interface imersiva em tempo real:

<p align="center">
  <video src="https://github.com/user-attachments/assets/021c2bf6-4fed-4eda-addb-9ddb637e6944" width="100%" controls autoplay loop muted playsinline></video>
</p>

---

## 🛠️ Arquitetura e Fluxo de Dados

Abaixo está o mapeamento visual de como a plataforma processa um documento bruto até renderizá-lo em uma interface interativa:

<p align="center">
  <img src="docs/architecture.svg" alt="Fluxo da Singularidade" width="100%" style="border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.05);" />
</p>

O ecossistema é projetado em uma arquitetura moderna dividida em três camadas principais:

*   **Frontend (React + Vite)**: Interface estruturada com **Vanilla CSS** e um robusto sistema de tokens de design. Foco em UX fluida, interações dinâmicas e zero dependências de utilitários como TailwindCSS.
*   **Backend (Hono + Drizzle + BullMQ)**: API ultrarrápida desenvolvida em Node.js utilizando **Hono**, com persistência em PostgreSQL através do **Drizzle ORM** e processamento de tarefas assíncronas em segundo plano via **BullMQ** (com Redis).
*   **Pipeline (Python OCR)**: Pipeline inteligente em Python para processamento pesado de documentos, suportando OCR híbrido local e em nuvem para estruturação automatizada de exames em JSON pydantic.

---

## 💫 Grade de Recursos (Grid de Funcionalidades)

| Recurso | Decal / Status | Descrição |
| :--- | :--- | :--- |
| **OCR Inteligente** | `[ SYS_READY ]` | Processamento híbrido com Ollama local (modelo `glm-ocr`) ou Google Gemini API. |
| **Estrutura com IA** | `[ IA_COMPILED ]` | Extração de questões e gabaritos em JSON tipado utilizando validação com Pydantic. |
| **Fila Assíncrona** | `[ QUEUED_JOBS ]` | Orquestração robusta de processamento em segundo plano alimentada por Redis e BullMQ. |
| **Card Gravitacional** | `[ Orbit_3D ]` | Card interativo com cálculos de física de órbita do mouse, nebula de partículas e efeitos de glitch em tempo de execução. |
| **Configuração Dinâmica** | `[ ENV_SYNC ]` | Chaveamento instantâneo entre processamento local 100% gratuito ou nuvem pública. |

---

## ⚡ Como Iniciar (Instalação Rápida)

Para manter a interface limpa, os detalhes completos de instalação estão organizados em módulos expansíveis abaixo. Clique em cada seção para visualizar os comandos.

<details>
<summary><b>1. Clonar e Instalar Dependências JS</b></summary>
<br />

Instale as dependências JavaScript do ecossistema e configure o ambiente virtual do Python:

```bash
# Instale as dependências da raiz (gerenciador de processos concomitantes)
npm install

# Instale as dependências de cada sub-projeto
cd backend && npm install && cd ../frontend && npm install && cd ..
```
</details>

<details>
<summary><b>2. Configurar o Ambiente Python (Pipeline de OCR)</b></summary>
<br />

Crie um ambiente virtual em Python na raiz do projeto e instale as bibliotecas necessárias para extração dos documentos:

```bash
# Crie o ambiente virtual (.venv) na raiz do projeto
python3 -m venv .venv

# Ative o ambiente virtual
# No Linux/macOS:
source .venv/bin/activate
# No Windows:
.venv\Scripts\activate

# Instale os requerimentos
pip install -r pipeline/requirements.txt
```

> [!NOTE]
> No Linux, o processador de arquivos PDF (`pdf2image`) depende do utilitário `poppler`. Caso ocorra algum erro ao processar PDFs, instale-o pelo terminal:
> *   **Ubuntu/Debian:** `sudo apt-get install poppler-utils`
> *   **macOS:** `brew install poppler`
</details>

<details>
<summary><b>3. Configurar Variáveis de Ambiente</b></summary>
<br />

Copie o arquivo de exemplo de variáveis de ambiente para a raiz do projeto e configure conforme o seu uso:

```bash
cp .env.example .env
```

Abra o arquivo `.env` gerado e configure o modo do provedor de OCR (`OCR_PROVIDER`):
*   **Modo Local (`local`)**: Utiliza o **Ollama** instalado no seu computador para extração de OCR a custo zero.
*   **Modo API (`api`)**: Utiliza os modelos **Google Gemini** em nuvem (Requer que você insira sua chave `GEMINI_API_KEY`).
</details>

<details>
<summary><b>4. Setup do OCR Local (Opcional - Ollama)</b></summary>
<br />

Se você optar por utilizar o OCR Local gratuito, certifique-se de que o Ollama está rodando e execute o script automatizado para baixar os modelos adequados:

```bash
bash scripts/setup-local-ocr.sh
```
*Este script baixará o modelo otimizado `glm-ocr` de alta performance e configurará o seu ambiente local.*
</details>

### Iniciar Tudo com um Único Comando 🚀

Com o Docker aberto, inicie todo o ecossistema (Banco de dados PostgreSQL, Cache Redis, Migrações do Drizzle, Worker assíncrono BullMQ, Backend API e Frontend React) com um único comando na raiz:

```bash
npm run all
```

Após o carregamento, as aplicações estarão disponíveis em:
*   **Frontend Web**: `http://localhost:5173`
*   **Backend API**: `http://localhost:3001`

---

## 📂 Organização do Repositório

```path
├── backend/          # Servidor HTTP Hono, esquemas Drizzle e workers BullMQ
├── frontend/         # App React com design tokens e UI "Vazio Oculto"
├── pipeline/         # Engine Python OCR para parsing inteligente de exames/documentos
├── scripts/          # Shell scripts utilitários de setup local
├── docs/             # Documentação técnica e design do projeto (Gitignored)
│   ├── banner.svg    # Banner animado da Singularidade
│   └── architecture.svg # Fluxograma do ciclo de vida dos dados
├── docker-compose.yml# Configuração do Redis e PostgreSQL locais
└── .gitignore        # Arquivos protegidos e configs locais ignorados
```

---

## 🌌 Estética Visual: A Singularidade

A interface do Singular implementa conceitos avançados de design com foco em imersão espacial. Em vez de temas escuros genéricos, utilizamos uma paleta HSL balanceada com pretos absolutos, gradientes profundos, bordas neon sutis e animações de física espacial. Todo o design é implementado usando CSS nativo puro para garantir o máximo desempenho de renderização a 60fps.

---

## ⚖️ Licença

Este projeto é de código aberto e está licenciado sob os termos da [Licença MIT](LICENSE). Sinta-se livre para usar, estudar, modificar e distribuir o código de forma responsável.
