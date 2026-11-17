# SPDX-License-Identifier: AGPL-3.0-only
"""Generate disposable credentials and config under ignored generated/."""
from pathlib import Path
from secrets import token_urlsafe
from string import Template


ROOT = Path(__file__).resolve().parent
OUT = ROOT / "generated"
if (OUT / ".env").exists():
    raise SystemExit("generated/.env already exists; reuse it for this spike run")
OUT.mkdir(exist_ok=True)

values = {
    "P00_GATEWAY_SECRET": token_urlsafe(32),
    "P00_SENDER_A_SECRET": token_urlsafe(32),
    "P00_SENDER_C_SECRET": token_urlsafe(32),
    "P00_USER_PASSWORD": token_urlsafe(24),
    "P00_KC_ADMIN_USERNAME": "p00-admin",
    "P00_KC_ADMIN_PASSWORD": token_urlsafe(24),
    "P00_FLOWABLE_ADMIN_USER_ID": "p00-flowable-admin",
    "P00_FLOWABLE_ADMIN_PASSWORD": token_urlsafe(24),
    "P00_FLOWABLE_DB_PASSWORD": token_urlsafe(24),
    "P00_CORE_DB_PASSWORD": token_urlsafe(24),
    "P00_S3_ACCESS_KEY": "p00" + token_urlsafe(12),
    "P00_S3_SECRET_KEY": token_urlsafe(32),
    "P00_S3_BUCKET": "p00-private",
}

for name in ("realm", "apisix"):
    template = (ROOT / f"{name}.template.{'json' if name == 'realm' else 'yaml'}").read_text(encoding="utf-8")
    rendered = Template(template).substitute(values)
    (OUT / f"{name}.{'json' if name == 'realm' else 'yaml'}").write_text(rendered, encoding="utf-8")
(OUT / ".env").write_text("".join(f"{k}={v}\n" for k, v in values.items()), encoding="utf-8")
print("Created ignored generated/ configuration with throwaway credentials")
