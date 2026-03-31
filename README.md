# Smart Navigation Assistant (React + Node)

## Structure
- `client/` - React (Vite) frontend
- `server/` - Node.js + Express backend (Gemini proxy)

## Setup
1. Frontend env
   - copy `client/.env.example` -> `client/.env`
   - set `VITE_GOOGLE_MAPS_KEY`
   - set `VITE_GOOGLE_CLIENT_ID` (optional for now)

2. Backend env
   - copy `server/.env.example` -> `server/.env`
   - set `GEMINI_KEY`

## Run
Open 2 terminals from project root:

Terminal 1:
```bash
npm run dev:server
```

Terminal 2:
```bash
npm run dev:client
```

Then open:
- `http://localhost:5173`

Backend health:
- `http://localhost:8787/api/health`
