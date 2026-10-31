#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$project_dir"

if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker is required to start MotoTiming.' >&2
  exit 127
fi

if [[ ! -r .env ]]; then
  echo 'A readable .env file is required. Copy .env.example to .env and configure it.' >&2
  exit 1
fi

docker compose config --quiet
docker compose up --build --detach
