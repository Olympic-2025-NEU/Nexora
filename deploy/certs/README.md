# Local HTTPS with mkcert

Nexora requires HTTPS for local development because:

- Keycloak issues tokens bound to `https://` issuers — `http://` issuers are rejected by OIDC libraries.
- `Secure` cookies (used for CSRF protection) are only sent over HTTPS.
- Gateway OIDC redirect URIs must be HTTPS in production; local parity prevents drift.
- `SameSite=Strict` behaviour differs across browsers when the scheme is mixed.

## Why mkcert?

[mkcert](https://github.com/FiloSottile/mkcert) creates a local CA that your OS and browsers trust.
No self-signed certificate warnings. Works with Chromium, Firefox, curl, and Node.js without flags.

---

## Installation

### Windows

```powershell
# Using winget (recommended)
winget install FiloSottile.mkcert

# Or using Chocolatey
choco install mkcert

# Or using Scoop
scoop install mkcert
```

### macOS

```bash
brew install mkcert
brew install nss   # Required for Firefox trust
```

### Linux (Debian/Ubuntu)

```bash
sudo apt install libnss3-tools  # Required for Firefox/Chromium
# Download binary from https://github.com/FiloSottile/mkcert/releases
# Or via Homebrew on Linux:
brew install mkcert
```

---

## Generate certificates

Run once per machine (installs the local CA into your OS trust store):

```bash
mkcert -install
```

Then generate certs for the Nexora local stack:

```bash
# From this directory (deploy/certs/)
mkcert \
  localhost \
  "*.localhost" \
  keycloak.localhost \
  gateway.localhost \
  nexora.localhost
```

This creates `localhost+5.pem` and `localhost+5-key.pem` in the current directory.

> **Important:** Never commit `.pem` files to Git. They are listed in `.gitignore`.

---

## Usage in Docker Compose

Mount certs into the gateway and Keycloak services:

```yaml
services:
  gateway:
    volumes:
      - ./deploy/certs/localhost+5.pem:/etc/ssl/certs/nexora.crt:ro
      - ./deploy/certs/localhost+5-key.pem:/etc/ssl/private/nexora.key:ro

  keycloak:
    environment:
      KC_HTTPS_CERTIFICATE_FILE: /etc/ssl/certs/nexora.crt
      KC_HTTPS_CERTIFICATE_KEY_FILE: /etc/ssl/private/nexora.key
    volumes:
      - ./deploy/certs/localhost+5.pem:/etc/ssl/certs/nexora.crt:ro
      - ./deploy/certs/localhost+5-key.pem:/etc/ssl/private/nexora.key:ro
```

Set `OIDC_ISSUER_URL=https://keycloak.localhost:8443/realms/nexora` in your `.env` file.

---

## Trusting the CA in Node.js

Node.js uses its own certificate store and does not read the OS store by default.
Export the mkcert root CA and point Node at it:

```bash
# Get the CA location
mkcert -CAROOT
# → /home/you/.local/share/mkcert  (Linux)
# → C:\Users\you\AppData\Local\mkcert  (Windows)
# → /Users/you/Library/Application Support/mkcert  (macOS)

export NODE_EXTRA_CA_CERTS="$(mkcert -CAROOT)/rootCA.pem"
```

Add this to your `.env` or shell profile so `npm run dev` and test runners trust the cert.

---

## Renewing / revoking

mkcert local CA certs are valid for ~2.5 years.
To regenerate: delete the `.pem` files, re-run `mkcert …` above.
To uninstall the CA from the trust store: `mkcert -uninstall`.

---

## Security note

The mkcert local CA private key lives in `$(mkcert -CAROOT)/rootCA-key.pem`.
It is on your local machine only and never leaves it.
Do **not** share or commit `rootCA-key.pem`.
