# Project Guidance

Keep this file current: when project commands, architecture, APIs, or conventions change, update the relevant guidance and remove anything that is no longer accurate.

## Project

This is a Bun-served React and TypeScript dashboard for MotoGP live timing. It uses Tailwind CSS 4 for dashboard styling.

## Commands

- Install dependencies with `bun add -E`.
- Run tests with `bun test`.
- Check types with `bun run type-check`.
- Lint with `bun run lint` and format with `bun run format`.
- Never run `bun run dev` or `bun run start`.

## Application Structure

- `src/server.ts` starts the Bun server and serves the app and same-origin API routes.
- `src/api.ts` contains browser API helpers and server-side MotoGP proxy requests.
- `src/main.tsx` mounts the React app; `src/App.tsx` contains the live timing dashboard, schedule dialog, and feed handling.
- `src/index.html` is the frontend HTML entry point; `src/index.css` contains global styles and Tailwind setup.
- `src/App.test.ts`, `src/api.test.ts`, and `src/schedule.test.ts` contain Bun tests for dashboard, API, and schedule helpers.

## API and Styling

- Browser code must use the helpers in `src/api.ts`, which call the same-origin `/api/live-timing` and `/api/schedule` routes; server-side MotoGP requests also live in `src/api.ts` so clients do not contact MotoGP directly.
- Use `MotoGP-API.md` as the reference for live timing and schedule response shapes.
- Use Tailwind utility classes for component styling. Keep `src/index.css` limited to Tailwind imports and document-wide defaults or styles that utilities cannot express cleanly.
- Keep rider and session data handling tolerant of missing feed fields; the feed can be unavailable or stale.
