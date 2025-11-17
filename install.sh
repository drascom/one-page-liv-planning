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
UV_BIN="$(command -v uv)"

if [ ! -f "$REPO_ROOT/.env" ] && [ -f "$REPO_ROOT/.env.example" ]; then
  echo "==> Creating .env from .env.example (update secrets before production use)"
  cp "$REPO_ROOT/.env.example" "$REPO_ROOT/.env"
fi

if command -v systemctl >/dev/null 2>&1; then
  SERVICE_NAME="one-page-crm"
  SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
  SERVICE_USER="$(id -un)"
  echo "==> Installing systemd service (${SERVICE_FILE})"
  sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Liv CRM FastAPI service
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_ROOT
Environment=PATH=$HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=$UV_BIN run uvicorn backend.app:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*"
Restart=on-failure
User=$SERVICE_USER

[Install]
WantedBy=multi-user.target
EOF
  echo "==> Enabling & starting ${SERVICE_NAME}.service"
  sudo systemctl daemon-reload
  sudo systemctl enable --now "${SERVICE_NAME}.service"
else
  echo "==> systemd not detected; skipping service installation"
fi

echo "==> Installation complete."
echo "Service status: sudo systemctl status ${SERVICE_NAME:-one-page-crm}.service"
echo "Manual run (optional): uv run uvicorn backend.app:app --reload --host 0.0.0.0 --port 8000"
