# Singular 🌌 — Geração Inteligente de Quizzes com IA

Singular é uma plataforma web premium para geração automatizada de quizzes e exames a partir de documentos (PDFs, imagens e exames escaneados). Ele utiliza pipelines de IA de ponta para extração estruturada de conteúdo e apresenta uma experiência visual ultra-imersiva baseada na estética **"A Singularidade"** (Dark mode profundo, linhas elegantes de alta precisão e micro-transições de alta performance).

---

## 🚀 Arquitetura e Tech Stack

O ecossistema é projetado em uma arquitetura moderna dividida em três camadas principais:

*   **Frontend (React + Vite)**: Interface estruturada com **Vanilla CSS** e um robusto sistema de tokens de design. Foco em UX fluida, interações dinâmicas e zero dependências de utilitários como TailwindCSS.
*   **Backend (Hono + Drizzle + BullMQ)**: API ultrarrápida desenvolvida em Node.js utilizando **Hono**, com persistência em PostgreSQL através do **Drizzle ORM** e processamento de tarefas assíncronas em segundo plano via **BullMQ** (com Redis).
*   **Pipeline (Python OCR)**: Pipeline inteligente em Python para processamento pesado de documentos, suportando OCR híbrido local e em nuvem para estruturação automatizada de exames em JSON pydantic.

---

## 🛠️ Como Iniciar (Instalação Simplificada)

Siga os passos abaixo para configurar e rodar o ecossistema completo em poucos minutos.

### 📋 Pré-requisitos
Certifique-se de ter instalado em sua máquina:
1. **Node.js** (v18 ou superior)
2. **Docker e Docker Compose**
3. **Python** (v3.10 ou superior)
4. *Opcional:* **Ollama** (caso queira rodar OCR local 100% gratuito)

---

### 1. Clonar e Instalar Dependências
Instale as dependências JavaScript do ecossistema e configure o ambiente virtual do Python:

```bash
# 1. Instale as dependências da raiz (gerenciador de processos concomitantes)
npm install

# 2. Instale as dependências de cada sub-projeto
cd backend && npm install && cd ../frontend && npm install && cd ..
```

### 2. Configurar o Ambiente Python (Pipeline de OCR)
Crie um ambiente virtual em Python na raiz do projeto e instale as bibliotecas necessárias para extração dos documentos:

```bash
# 1. Crie o ambiente virtual (.venv) na raiz do projeto
python3 -m venv .venv

# 2. Ative o ambiente virtual
# No Linux/macOS:
source .venv/bin/activate
# No Windows:
.venv\Scripts\activate

# 3. Instale os requerimentos
pip install -r pipeline/requirements.txt
```

> [!NOTE]
> No Linux, o processador de arquivos PDF (`pdf2image`) depende do utilitário `poppler`. Caso ocorra algum erro ao processar PDFs, instale-o pelo terminal:
> *   **Ubuntu/Debian:** `sudo apt-get install poppler-utils`
> *   **macOS:** `brew install poppler`

---

### 3. Variáveis de Ambiente
Copie o arquivo de exemplo de variáveis de ambiente para a raiz do projeto e configure conforme o seu uso:

```bash
cp .env.example .env
```

Abra o arquivo `.env` gerado e configure o modo do provedor de OCR (`OCR_PROVIDER`):
*   **Modo Local (`local`)**: Utiliza o **Ollama** instalado no seu computador para extração de OCR a custo $0.
*   **Modo API (`api`)**: Utiliza os modelos **Google Gemini** em nuvem (Requer que você insira sua chave `GEMINI_API_KEY`).

---

### 4. Setup do OCR Local (Opcional - Ollama)
Se você optar por utilizar o OCR Local gratuito, certifique-se de que o Ollama está rodando e execute o script automatizado para baixar os modelos adequados:

```bash
bash scripts/setup-local-ocr.sh
```
*Este script baixará o modelo otimizado `glm-ocr` de alta performance e configurará o seu ambiente local.*

---

### 5. Iniciar Tudo com um Único Comando 🚀
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
├── docker-compose.yml# Configuração do Redis e PostgreSQL locais
└── .gitignore        # Arquivos protegidos e configs locais ignorados
```

---

## ⚖️ Licença

Este projeto é de código aberto e está licenciado sob os termos da [Licença MIT](LICENSE). Sinta-se livre para usar, estudar, modificar e distribuir o código de forma responsável.

---

## 🌌 Estética Visual: A Singularidade
A interface do Singular implementa conceitos avançados de design com foco em imersão espacial. Em vez de temas escuros genéricos, utilizamos uma paleta HSL balanceada com pretos absolutos, gradientes profundos, bordas neon sutis e animações de física espacial. Todo o design é implementado usando CSS nativo puro para garantir o máximo desempenho de renderização a 60fps.
