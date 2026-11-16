# SPDX-License-Identifier: AGPL-3.0-only
"""Throwaway headless boundary proof, not the Nexora Core Data/File API."""
import json
import os
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

import jwt
import psycopg
from jwt import PyJWKClient
from psycopg.types.json import Jsonb


ISSUER = "http://keycloak:8080/realms/nexora-p00"
JWKS = PyJWKClient(ISSUER + "/protocol/openid-connect/certs", timeout=5)
DB_DSN = (
    "host=core-db dbname=core_spike user=core_spike "
    "password=" + os.environ["P00_CORE_DB_PASSWORD"]
)


def initialize():
    with psycopg.connect(DB_DSN) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS core_spike_record (
                   id uuid PRIMARY KEY,
                   payload jsonb NOT NULL,
                   created_by_sub text NOT NULL,
                   created_at timestamptz NOT NULL DEFAULT now()
               )"""
        )


def authorized(header):
    if not header or not header.startswith("Bearer "):
        return None
    token = header.removeprefix("Bearer ")
    try:
        signing_key = JWKS.get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token, signing_key.key, algorithms=["RS256"], issuer=ISSUER,
            options={"verify_aud": False},
        )
    except jwt.PyJWTError:
        return None
    if claims.get("azp") != "erp-browser" or "erp:user" not in claims.get("scope", "").split():
        return None
    return claims.get("sub")


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, body):
        payload = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/health":
            return self.reply(200, {"status": "ok"})
        actor = authorized(self.headers.get("Authorization"))
        if not actor:
            return self.reply(401, {"code": "UNAUTHORIZED"})
        prefix = "/api/v1/core/records/"
        path = urlsplit(self.path).path
        if not path.startswith(prefix):
            return self.reply(404, {"code": "NOT_FOUND"})
        try:
            record_id = uuid.UUID(path[len(prefix):])
        except ValueError:
            return self.reply(400, {"code": "BAD_ID"})
        with psycopg.connect(DB_DSN) as connection:
            row = connection.execute(
                "SELECT payload, created_by_sub FROM core_spike_record WHERE id = %s", (record_id,)
            ).fetchone()
        if not row:
            return self.reply(404, {"code": "NOT_FOUND"})
        if row[1] != actor:
            return self.reply(403, {"code": "FORBIDDEN"})
        return self.reply(200, {"id": str(record_id), "payload": row[0]})

    def do_POST(self):
        actor = authorized(self.headers.get("Authorization"))
        if not actor:
            return self.reply(401, {"code": "UNAUTHORIZED"})
        if urlsplit(self.path).path != "/api/v1/core/records":
            return self.reply(404, {"code": "NOT_FOUND"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise ValueError("body size")
            body = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            return self.reply(400, {"code": "BAD_BODY"})
        if (
            not isinstance(body, dict) or set(body) != {"schemaVersion", "text"}
            or type(body["schemaVersion"]) is not int or body["schemaVersion"] != 1
            or not isinstance(body["text"], str)
            or not 1 <= len(body["text"]) <= 200
        ):
            return self.reply(422, {"code": "BAD_RECORD"})
        record_id = uuid.uuid4()
        with psycopg.connect(DB_DSN) as connection:
            connection.execute(
                "INSERT INTO core_spike_record (id, payload, created_by_sub) VALUES (%s, %s, %s)",
                (record_id, Jsonb(body), actor),
            )
        return self.reply(201, {"id": str(record_id), "payload": body})


if __name__ == "__main__":
    initialize()
    ThreadingHTTPServer(("0.0.0.0", 8001), Handler).serve_forever()
