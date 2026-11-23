#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
# gen-local-certs.sh — Generate mkcert TLS certificates for local Nexora stack.
#
# Requires: mkcert (https://github.com/FiloSottile/mkcert)
#   macOS:  brew install mkcert
#   Linux:  see deploy/certs/README.md
#
# Output: deploy/certs/local.pem and deploy/certs/local-key.pem
# These files are gitignored. Run once per machine.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="$SCRIPT_DIR/../certs"

echo "==> Checking mkcert installation..."
if ! command -v mkcert &>/dev/null; then
  echo "ERROR: mkcert not found. Install via:"
  echo "  macOS:  brew install mkcert"
  echo "  Linux:  see deploy/certs/README.md"
  exit 1
fi

echo "==> Installing local CA (requires sudo on Linux)..."
mkcert -install

echo "==> Generating certificates in $CERTS_DIR ..."
cd "$CERTS_DIR"
mkcert \
  -cert-file local.pem \
  -key-file local-key.pem \
  localhost \
  "*.localhost" \
  127.0.0.1 \
  ::1

echo ""
echo "SUCCESS: Certificates generated:"
echo "  $CERTS_DIR/local.pem"
echo "  $CERTS_DIR/local-key.pem"
echo ""
echo "Mount these in docker-compose via:"
echo "  volumes:"
echo "    - ./certs/local.pem:/usr/local/apisix/conf/certs/local.pem:ro"
echo "    - ./certs/local-key.pem:/usr/local/apisix/conf/certs/local-key.pem:ro"
echo ""
echo "Set in .env:"
echo "  PUBLIC_BASE_URL=https://127.0.0.1:\${GATEWAY_HTTPS_PORT:-19443}"
echo ""
echo "NODE_EXTRA_CA_CERTS (for Node.js to trust local CA):"
echo "  export NODE_EXTRA_CA_CERTS=\"\$(mkcert -CAROOT)/rootCA.pem\""
