# NSM Dispatch

Crew scheduling + map for North Shore Masonry — visualizes tomorrow's scheduled tasks across all 27 crews, flags drive-time inefficiencies, and lets Zac/Les reassign tasks between crews with one click. Writes overrides back to JobTread via PAVE API.

## Stack
- **Frontend**: React + Vite + Tailwind + Leaflet
- **Backend**: Netlify Functions (serverless)
- **DB**: Supabase (`wkrtbjvbjebhbcjwurhb`, `dispatch_*` tables)
- **Source of truth**: JobTread PAVE API

## Pages
Single-page app: date picker → map + task list → optimizer modal.

## Sync cadence
`sync-jobtread` runs every 15 min via scheduled function, pulling scheduled tasks for the next 14 days and upserting to `dispatch_tasks`.

## Dev
```bash
npm install
cp .env.example .env  # fill in anon key
npm run dev
```

## Deploy
Auto-deploys from `main` via Netlify. See `/mnt/skills/user/closers-club-deploy/SKILL.md`.
