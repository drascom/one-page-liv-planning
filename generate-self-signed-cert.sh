#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${1:-localhost}"
CERT_DIR="certs"
KEY_PATH="${CERT_DIR}/${DOMAIN}.key"
CRT_PATH="${CERT_DIR}/${DOMAIN}.crt"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required (install via: sudo apt-get install -y openssl)" >&2
  exit 1
fi

mkdir -p "${CERT_DIR}"

echo "Generating self-signed certificate for CN=${DOMAIN}"
openssl req \
  -x509 \
  -nodes \
  -days 365 \
  -newkey rsa:2048 \
  -keyout "${KEY_PATH}" \
  -out "${CRT_PATH}" \
  -subj "/CN=${DOMAIN}" >/dev/null

echo "Created:"
echo "  Key:  ${KEY_PATH}"
echo "  Cert: ${CRT_PATH}"
echo
echo "Start uvicorn with:"
echo "  uv run uvicorn backend.app:app --host 0.0.0.0 --port 8443 \\"
echo "     --ssl-keyfile ${KEY_PATH} --ssl-certfile ${CRT_PATH}"
