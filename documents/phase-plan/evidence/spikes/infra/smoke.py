# SPDX-License-Identifier: AGPL-3.0-only
"""Disposable APISIX/Keycloak/SeaweedFS/Flowable component spike."""
import base64
import hashlib
import html
import json
import secrets
import subprocess
import time
import urllib.parse
import uuid
from html.parser import HTMLParser
from pathlib import Path

import boto3
import requests
from botocore.client import Config
from botocore.exceptions import ClientError
from requests.auth import HTTPBasicAuth


ROOT = Path(__file__).resolve().parent
ENV_FILE = ROOT / "generated" / ".env"
env = dict(line.strip().split("=", 1) for line in ENV_FILE.read_text(encoding="utf-8").splitlines() if line.strip())
assert env["P00_S3_BUCKET"] == "p00-private", "refuse non-spike bucket"
KC = "http://127.0.0.1:18080/realms/nexora-p00/protocol/openid-connect"
KC_HOST = {"Host": "keycloak:8080"}
GATEWAY = "http://127.0.0.1:19080"
S3_ENDPOINT = "http://127.0.0.1:18333"
FLOWABLE = "http://127.0.0.1:18082/flowable-rest/service"
FLOWABLE_AUTH = HTTPBasicAuth(env["P00_FLOWABLE_ADMIN_USER_ID"], env["P00_FLOWABLE_ADMIN_PASSWORD"])
COMPOSE = ["docker", "compose", "--env-file", str(ENV_FILE), "-f", str(ROOT / "compose.yaml")]


def wait_for(label, check, attempts=90):
    for _ in range(attempts):
        try:
            if check():
                return
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"{label} did not become ready")


def b64url(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def claims(token):
    part = token.split(".")[1]
    return json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))


def localize(url):
    parsed = urllib.parse.urlparse(url)
    return urllib.parse.urlunparse(parsed._replace(netloc="127.0.0.1:18080"))


class LoginForm(HTMLParser):
    def __init__(self):
        super().__init__()
        self.action = None
        self.fields = {}

    def handle_starttag(self, tag, attrs):
        data = dict(attrs)
        if tag == "form" and data.get("id") == "kc-form-login":
            self.action = html.unescape(data.get("action", ""))
        if tag == "input" and data.get("name") and data.get("value") is not None:
            self.fields[data["name"]] = data["value"]


def browser_token(wrong_verifier=False):
    session = requests.Session()
    verifier = b64url(secrets.token_bytes(48))
    challenge = b64url(hashlib.sha256(verifier.encode()).digest())
    redirect = "http://127.0.0.1:19090/callback"
    params = {
        "client_id": "erp-browser", "response_type": "code", "redirect_uri": redirect,
        "scope": "openid", "state": "p00-state", "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    page = session.get(KC + "/auth", params=params, headers=KC_HOST, timeout=20)
    form = LoginForm()
    form.feed(page.text)
    assert page.status_code == 200 and form.action, (page.status_code, "login form")
    # Local synthetic HTTP only. Production must keep Secure cookies and use HTTPS.
    for cookie in session.cookies:
        cookie.secure = False
    posted = session.post(
        localize(form.action),
        data={**form.fields, "username": "p00-user", "password": env["P00_USER_PASSWORD"]},
        headers=KC_HOST, allow_redirects=False, timeout=20,
    )
    location = posted.headers.get("Location", "")
    assert posted.status_code == 302 and location.startswith(redirect), (posted.status_code, urllib.parse.urlparse(location).path)
    code = urllib.parse.parse_qs(urllib.parse.urlparse(location).query)["code"][0]
    result = session.post(
        KC + "/token", headers=KC_HOST, timeout=20,
        data={
            "grant_type": "authorization_code", "client_id": "erp-browser", "code": code,
            "redirect_uri": redirect, "code_verifier": "wrong-verifier" if wrong_verifier else verifier,
        },
    )
    return result.status_code, result.json().get("access_token"), result.json().get("error")


def service_token(client_id, secret):
    result = requests.post(
        KC + "/token", headers=KC_HOST, timeout=20,
        data={"grant_type": "client_credentials", "client_id": client_id, "client_secret": secret},
    )
    assert result.status_code == 200, (client_id, result.status_code)
    return result.json()["access_token"]


def gateway_status(path, token=None, method="GET"):
    headers = {"Authorization": "Bearer " + token} if token else {}
    return requests.request(method, GATEWAY + path, headers=headers, timeout=10).status_code


def s3_client():
    return boto3.client(
        "s3", endpoint_url=S3_ENDPOINT,
        aws_access_key_id=env["P00_S3_ACCESS_KEY"],
        aws_secret_access_key=env["P00_S3_SECRET_KEY"],
        config=Config(signature_version="s3v4", s3={"addressing_style": "path"}),
    )


def restart(service):
    subprocess.run(COMPOSE + ["restart", service], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)


def test_gateway():
    wait_for("Keycloak", lambda: requests.get(KC.replace("/protocol/openid-connect", "/.well-known/openid-configuration"), timeout=3).status_code == 200)
    wait_for("APISIX", lambda: gateway_status("/api/v1/public/ping") == 200)
    valid, user, error = browser_token()
    assert valid == 200 and user and not error
    invalid, wrong, error = browser_token(True)
    assert invalid == 400 and not wrong and error == "invalid_grant"
    sender_a = service_token("sender-a", env["P00_SENDER_A_SECRET"])
    sender_c = service_token("sender-c", env["P00_SENDER_C_SECRET"])
    assert "erp:user" in claims(user).get("scope", "").split()
    assert "federation:write" in claims(sender_a).get("scope", "").split()
    checks = {
        "public_anonymous": gateway_status("/api/v1/public/ping"),
        "private_anonymous": gateway_status("/api/v1/private/ping"),
        "private_user": gateway_status("/api/v1/private/ping", user),
        "private_sender_a": gateway_status("/api/v1/private/ping", sender_a),
        "private_sender_c": gateway_status("/api/v1/private/ping", sender_c),
        "federation_sender_a": gateway_status("/api/v1/federation/events", sender_a, "POST"),
        "federation_sender_c": gateway_status("/api/v1/federation/events", sender_c, "POST"),
        "federation_user": gateway_status("/api/v1/federation/events", user, "POST"),
        "unknown_route": gateway_status("/api/v1/unknown"),
    }
    expected = {
        "public_anonymous": 200, "private_anonymous": 401, "private_user": 200,
        "private_sender_a": 403, "private_sender_c": 403,
        "federation_sender_a": 202, "federation_sender_c": 403,
        "federation_user": 403, "unknown_route": 404,
    }
    assert checks == expected, checks
    return {"pkce_valid": valid, "pkce_wrong_verifier": invalid, **checks}


def test_core_boundary():
    valid, user, error = browser_token()
    assert valid == 200 and user and not error
    sender_a = service_token("sender-a", env["P00_SENDER_A_SECRET"])
    base = GATEWAY + "/api/v1/core/records"
    record = {"schemaVersion": 1, "text": "headless boundary proof"}
    wait_for("core spike", lambda: requests.get(base, headers={"Authorization": "Bearer " + user}, timeout=5).status_code == 404)
    anonymous = requests.post(base, json=record, timeout=10).status_code
    sender = requests.post(base, headers={"Authorization": "Bearer " + sender_a}, json=record, timeout=10).status_code
    invalid = requests.post(base, headers={"Authorization": "Bearer " + user}, json={"schemaVersion": 1, "text": ""}, timeout=10).status_code
    assert (anonymous, sender, invalid) == (401, 403, 422)
    created = requests.post(base, headers={"Authorization": "Bearer " + user}, json=record, timeout=10)
    assert created.status_code == 201 and created.json()["payload"] == record
    record_id = created.json()["id"]
    direct = subprocess.run(
        COMPOSE + ["exec", "-T", "core", "python", "-c",
                   "import urllib.request,urllib.error;\n"
                   "try: urllib.request.urlopen('http://127.0.0.1:8001/api/v1/core/records/'+'" + record_id + "')\n"
                   "except urllib.error.HTTPError as error: print(error.code)"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    )
    assert direct.stdout.strip() == "401", direct.stdout
    restart("core")
    headers = {"Authorization": "Bearer " + user}
    wait_for("core record after restart", lambda: requests.get(base + "/" + record_id, headers=headers, timeout=5).status_code == 200)
    subprocess.run(COMPOSE + ["stop", "upstream"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    try:
        headless = requests.get(base + "/" + record_id, headers=headers, timeout=10)
        identity = requests.get(KC.replace("/protocol/openid-connect", "/.well-known/openid-configuration"), timeout=10)
        workflow = flowable_get("/repository/process-definitions")
        assert headless.status_code == identity.status_code == workflow.status_code == 200
        assert headless.json()["payload"] == record
    finally:
        subprocess.run(COMPOSE + ["start", "upstream"], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
    wait_for("upstream restored", lambda: gateway_status("/api/v1/public/ping") == 200)
    return {
        "anonymous": anonymous, "service_token": sender, "invalid_payload": invalid,
        "created": created.status_code, "direct_anonymous": 401,
        "restart": "record persisted", "upstream_stopped": "core+identity+workflow alive",
    }


def test_s3():
    s3 = s3_client()
    wait_for("SeaweedFS S3", lambda: s3.list_buckets()["ResponseMetadata"]["HTTPStatusCode"] == 200)
    bucket = env["P00_S3_BUCKET"]
    try:
        s3.create_bucket(Bucket=bucket)
    except ClientError as error:
        if error.response["Error"]["Code"] != "BucketAlreadyOwnedByYou":
            raise
    key = "spike/" + uuid.uuid4().hex + ".txt"
    payload = b"Nexora P00 private object proof"
    expected_hash = hashlib.sha256(payload).hexdigest()
    s3.put_object(Bucket=bucket, Key=key, Body=payload)
    assert s3.get_object(Bucket=bucket, Key=key)["Body"].read() == payload
    unsigned = requests.get(f"{S3_ENDPOINT}/{bucket}/{key}", timeout=10).status_code
    url = s3.generate_presigned_url("get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=60)
    signed = requests.get(url, timeout=10)
    assert unsigned == 403 and signed.status_code == 200 and signed.content == payload
    restart("seaweed")
    wait_for("SeaweedFS restart", lambda: s3.head_object(Bucket=bucket, Key=key)["ResponseMetadata"]["HTTPStatusCode"] == 200)
    backup = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    s3.delete_object(Bucket=bucket, Key=key)
    try:
        s3.head_object(Bucket=bucket, Key=key)
        raise AssertionError("delete did not remove scratch object")
    except ClientError as error:
        assert error.response["ResponseMetadata"]["HTTPStatusCode"] == 404
    s3.put_object(Bucket=bucket, Key=key, Body=backup)
    restored = s3.get_object(Bucket=bucket, Key=key)["Body"].read()
    assert hashlib.sha256(restored).hexdigest() == expected_hash
    s3.delete_object(Bucket=bucket, Key=key)
    return {"unsigned": unsigned, "presigned": signed.status_code, "restart": "persisted", "logical_restore_sha256": expected_hash}


def flowable_get(path, **params):
    return requests.get(FLOWABLE + path, auth=FLOWABLE_AUTH, params=params, timeout=15)


def test_flowable():
    wait_for("Flowable REST", lambda: flowable_get("/repository/process-definitions").status_code == 200)
    anonymous = requests.get(FLOWABLE + "/repository/process-definitions", timeout=15).status_code
    default_admin = requests.get(FLOWABLE + "/repository/process-definitions", auth=HTTPBasicAuth("rest-admin", "test"), timeout=15).status_code
    assert anonymous == default_admin == 401
    definitions = flowable_get("/repository/process-definitions").json().get("data", [])
    found = [d for d in definitions if d.get("key") == "goods-issue-approval"]
    if not found:
        with (ROOT / "goods-issue-approval.bpmn20.xml").open("rb") as source:
            deployed = requests.post(
                FLOWABLE + "/repository/deployments", auth=FLOWABLE_AUTH,
                files={"file": ("goods-issue-approval.bpmn20.xml", source, "application/xml")}, timeout=30,
            )
        assert deployed.status_code in (200, 201), (deployed.status_code, deployed.text[:300])
        found = [d for d in flowable_get("/repository/process-definitions").json().get("data", []) if d.get("key") == "goods-issue-approval"]
    assert found
    instances = []
    for decision in (True, False):
        started = requests.post(
            FLOWABLE + "/runtime/process-instances", auth=FLOWABLE_AUTH, timeout=15,
            json={"processDefinitionKey": "goods-issue-approval", "businessKey": "p00-" + uuid.uuid4().hex},
        )
        assert started.status_code in (200, 201), (started.status_code, started.text[:300])
        process_id = started.json()["id"]
        tasks = flowable_get("/runtime/tasks", processInstanceId=process_id)
        assert tasks.status_code == 200 and len(tasks.json()["data"]) == 1
        instances.append((decision, process_id, tasks.json()["data"][0]["id"]))
    restart("flowable")
    wait_for("Flowable restart", lambda: len(flowable_get("/runtime/tasks", processInstanceId=instances[0][1]).json().get("data", [])) == 1)
    ends = {}
    for decision, process_id, task_id in instances:
        done = requests.post(
            FLOWABLE + "/runtime/tasks/" + task_id, auth=FLOWABLE_AUTH, timeout=15,
            json={"action": "complete", "variables": [{"name": "approved", "value": decision, "type": "boolean"}]},
        )
        assert done.status_code in (200, 204), (done.status_code, done.text[:300])
        history = flowable_get("/history/historic-activity-instances", processInstanceId=process_id)
        assert history.status_code == 200
        end_events = [row.get("activityId") for row in history.json().get("data", []) if row.get("activityType") == "endEvent"]
        expected = "approvedEnd" if decision else "rejectedEnd"
        assert end_events == [expected], end_events
        ends[str(decision).lower()] = end_events[0]
    return {"anonymous": anonymous, "default_admin": default_admin, "version": max(int(d["version"]) for d in found), "restart": "tasks persisted", "ends": ends}


if __name__ == "__main__":
    print(json.dumps({"result": "PASS", "gateway": test_gateway(), "core": test_core_boundary(), "s3": test_s3(), "flowable": test_flowable()}, ensure_ascii=False))
