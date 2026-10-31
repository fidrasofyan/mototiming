# MotoTiming

A live timing dashboard for MotoGP.

## Run locally

You’ll need [Bun](https://bun.com).

```sh
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000). For a local production run, use `bun run start`.

## Run with Docker Compose

Set the required Compose variables in `.env` at the project root, then build and start the container:

```dotenv
CONTAINER_NAME=mototiming
APP_HOST=127.0.0.1
APP_PORT=3000
```

Then run:

```sh
docker compose up --build
```

`APP_HOST` and `APP_PORT` configure the host address and port; the app listens on port `3000` inside the container.

## Commands

```sh
bun test
bun run type-check
bun run lint
bun run format
```

## Timing data

The browser gets timing data from `/api/live-timing`. Bun fetches MotoGP’s feed server-side because the API doesn’t allow browser requests from this app’s origin. See [MotoGP-API.md](MotoGP-API.md) for the endpoint and response format.
