# Quizsaber 🌌

Quizsaber é uma plataforma inteligente para geração de quizzes a partir de documentos (PDFs, exames, etc.), utilizando IA para extração de conteúdo e uma estética visual imersiva chamada "Vazio Oculto".

## 🚀 Arquitetura e Tech Stack

O projeto é dividido em três componentes principais:

- **Frontend**: Aplicação React estruturada com Vanilla CSS e design tokens. Foco em UX fluida e animações de alta performance.
- **Backend (API)**: Servidor Node.js utilizando o framework **Hono**, **Drizzle ORM** para persistência em PostgreSQL e **BullMQ** para processamento de filas assíncronas.
- **Pipeline (OCR)**: Script Python especializado em processamento de imagens e documentos via OCR (Optical Character Recognition) para alimentar a base de dados do quiz.

## 🛠️ Como Iniciar

### Pré-requisitos
- Node.js (v18+)
- Docker e Docker Compose (para banco de dados e Redis)
- Python 3.10+ (para o pipeline de OCR)

### Instalação e Execução

1.  Instale as dependências na raiz:
    ```bash
    npm install
    ```
2.  Configure as variáveis de ambiente:
    - Copie `.env.example` para `.env` no backend e frontend.
3.  Inicie a infraestrutura e os serviços via Docker:
    ```bash
    npm run all
    ```
    *Este comando sobe o banco de dados via Docker, executa as migrações e inicia o backend, o worker e o frontend simultaneamente.*

## 📂 Organização do Repositório

- `backend/`: Código fonte do servidor e worker.
- `frontend/`: Aplicação web React.
- `pipeline/`: Scripts Python de processamento de documentos.
- `docs/`: Documentação, planos de execução e referências de design.
- `scripts/`: Utilitários para setup local.

## ⚖️ Licença

Este é um projeto privado e proprietário.
