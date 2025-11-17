#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
export PATH

apt_packages=(
  python3
  python3-venv
  python3-pip
  curl
  build-essential
  libsqlite3-dev
)

echo "==> Updating apt sources"
sudo apt-get update -y

echo "==> Installing system packages: ${apt_packages[*]}"
sudo apt-get install -y "${apt_packages[@]}"

if ! command -v uv >/dev/null 2>&1; then
  echo "==> Installing uv package manager"
  curl -LsSf https://astral.sh/uv/install.sh | sh
else
  echo "==> uv already installed"
fi

echo "==> Syncing Python dependencies with uv"
cd "$REPO_ROOT"
uv sync

if [ ! -f "$REPO_ROOT/.env" ] && [ -f "$REPO_ROOT/.env.example" ]; then
  echo "==> Creating .env from .env.example (update secrets before production use)"
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
fi

echo "==> Installation complete."
echo "Run the app with: uv run uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000"
