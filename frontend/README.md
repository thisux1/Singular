# frontend · singular web app

React 19.2 SPA (Vite 8 + TypeScript) that turns processed exams into playable
quizzes inside an interactive Three.js "singularity" scene.

- `@react-three/fiber` 9 + `drei` render the black-hole backdrop and exam
  cards (`src/components/three/`, `src/components/effects/`)
- `zustand` holds quiz/session state; `@tanstack/react-query` syncs jobs and
  data with the API (`src/api/`)
- `react-router` 7 routes: exam list, exam detail, review, quiz player,
  results (`src/pages/`)
- Vanilla CSS with design tokens (`src/index.css`, `src/styles/`); no utility
  framework. API base: `VITE_API_URL`, defaults to `http://localhost:3001/api`.

Run it with the rest of the stack from the repo root:

```bash
npm run all        # postgres + redis + api + workers + this app on :5173
```

or standalone here: `npm install && npm run dev`.
