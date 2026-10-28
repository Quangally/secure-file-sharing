"""Real MySQL 8.4 schema and transaction tests, enabled by MYSQL_TEST_URL.

The supplied test account must create/drop a disposable database. Each test
uses a unique secure_share_test_* database; no existing database is modified.
"""

import base64
from concurrent.futures import ThreadPoolExecutor, TimeoutError
import json
import os
from pathlib import Path
import re
from threading import Event
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.api.accounts import _rate_counts, _rate_lock
from app.database.session import get_session
from app.main import app
from test_files import SAMPLE_CIPHERTEXT, login_user, make_manifest, register_user

pytestmark = pytest.mark.skipif(not os.getenv("MYSQL_TEST_URL"), reason="MYSQL_TEST_URL not set")


@pytest.fixture
def mysql_file_setup(tmp_path, monkeypatch):
    url = make_url(os.environ["MYSQL_TEST_URL"])
    assert url.drivername == "mysql+pymysql", "Use a dedicated MySQL test server."
    database_name = f"secure_share_test_{uuid4().hex}"
    admin = create_engine(url.set(database=None), hide_parameters=True)
    engine = create_engine(url.set(database=database_name), hide_parameters=True,
                           isolation_level="REPEATABLE READ")

    @event.listens_for(engine, "connect")
    def configure_connection(connection, _):
        with connection.cursor() as cursor:
            cursor.execute("SET SESSION time_zone = '+00:00'")
            cursor.execute("SET SESSION innodb_lock_wait_timeout = 10")

    # Apply the same checked-in schema used by Workbench, including every FK,
    # CHECK and generated-column constraint absent from the SQLite fixture.
    schema = (Path(__file__).resolve().parents[2] / "database/01_schema.sql").read_text()
    schema = "\n".join(line for line in schema.splitlines() if not line.lstrip().startswith("--"))
    schema = schema.replace("secure_share", database_name)
    try:
        with admin.connect() as connection:
            for statement in schema.split(";"):
                if statement.strip():
                    connection.exec_driver_sql(statement)
        with _rate_lock:
            _rate_counts.clear()

        def session_override():
            with Session(engine) as session:
                yield session

        app.dependency_overrides[get_session] = session_override
        monkeypatch.setenv("STORAGE_DIR", str(tmp_path / "uploads"))
        with TestClient(app) as client:
            owner = register_user(client, "owner@mysql.test")
            recipient = register_user(client, "recipient@mysql.test")
            owner = login_user(client, "owner@mysql.test")
            file_id = str(uuid4())
            response = client.post(
                "/files", headers={"X-CSRF-Token": owner["csrf_token"]},
                files={"ciphertext": ("file.bin", SAMPLE_CIPHERTEXT, "application/octet-stream")},
                data={"manifest": json.dumps(make_manifest(file_id, owner["current_key"]["key_id"]))},
            )
            assert response.status_code == 201, response.text
            payload = {
                "recipient_user_id": recipient["id"],
                "key_id": recipient["current_key"]["key_id"],
                "verified_fingerprint_sha256": recipient["current_key"]["fingerprint_sha256"],
                "wrapped_aes_key_base64": base64.b64encode(b"\xBB" * 256).decode(),
            }
            yield client, engine, owner, recipient, file_id, payload
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
        with admin.connect() as connection:
            connection.exec_driver_sql(f"DROP DATABASE IF EXISTS `{database_name}`")
        admin.dispose()


def test_mysql_share_revoke_regrant_and_disabled_owner(mysql_file_setup):
    client, engine, owner, recipient, file_id, payload = mysql_file_setup
    route = f"/files/{file_id}"
    headers = {"X-CSRF-Token": owner["csrf_token"]}
    bad_fingerprint = {**payload, "verified_fingerprint_sha256": "0" * 64}
    assert client.post(f"{route}/shares", json=bad_fingerprint, headers=headers).status_code == 409
    assert client.post(f"{route}/shares", json=payload, headers=headers).status_code == 201
    assert client.get(f"{route}/shares").json()["items"][0]["user_id"] == recipient["id"]
    login_user(client, "recipient@mysql.test")
    assert client.get("/files/shared-with-me").json()["items"][0]["shared_by"]["id"] == owner["id"]
    assert client.get(f"{route}/content").content == SAMPLE_CIPHERTEXT
    assert client.get(f"{route}/envelope").status_code == 200
    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET status='disabled' WHERE id=:id"), {"id": owner["id"]})
    assert client.get("/files/shared-with-me").json()["total"] == 0
    assert client.get("/files/shared-with-me").json()["items"] == []
    assert client.get(f"{route}/envelope").status_code == 404
    assert client.get(f"{route}/content").status_code == 404
    with engine.begin() as connection:
        connection.execute(text("UPDATE users SET status='active' WHERE id=:id"), {"id": owner["id"]})
    owner = login_user(client, "owner@mysql.test")
    headers = {"X-CSRF-Token": owner["csrf_token"]}
    assert client.delete(f"{route}/shares/{recipient['id']}", headers=headers).status_code == 204
    login_user(client, "recipient@mysql.test")
    assert client.get(f"{route}/envelope").status_code == 403
    assert client.get(f"{route}/content").status_code == 403
    owner = login_user(client, "owner@mysql.test")
    headers = {"X-CSRF-Token": owner["csrf_token"]}
    assert client.post(f"{route}/shares", json=payload, headers=headers).status_code == 201
    assert client.delete(route, headers=headers).status_code == 204
    assert client.post(f"{route}/shares", json=payload, headers=headers).status_code == 404


@pytest.mark.parametrize("transition,expected_status", [
    ("delete", 404), ("grant", 409), ("revoke", 201),
    ("key_revoke", 409), ("recipient_disable", 404),
])
def test_mysql_share_waits_for_file_lock_and_reads_committed_state(mysql_file_setup, transition, expected_status):
    client, engine, owner, recipient, file_id, payload = mysql_file_setup
    headers = {"X-CSRF-Token": owner["csrf_token"]}
    if transition == "revoke":
        assert client.post(f"/files/{file_id}/shares", json=payload, headers=headers).status_code == 201

    file_query_started = Event()

    lock_table = {"key_revoke": "public_keys", "recipient_disable": "users"}.get(transition, "files")

    def observe_query(connection, cursor, statement, parameters, context, executemany):
        if re.search(rf"\bFROM\s+{lock_table}\b", statement, re.I):
            file_query_started.set()

    with engine.connect() as first_writer:
        transaction = first_writer.begin()
        if transition == "key_revoke":
            first_writer.execute(text("SELECT id FROM public_keys WHERE id=:id FOR UPDATE"), {"id": payload["key_id"]})
            first_writer.execute(text("UPDATE public_keys SET revoked_at=UTC_TIMESTAMP(6) WHERE id=:id"), {"id": payload["key_id"]})
        elif transition == "recipient_disable":
            first_writer.execute(text("SELECT id FROM users WHERE id=:id FOR UPDATE"), {"id": recipient["id"]})
            first_writer.execute(text("UPDATE users SET status='disabled' WHERE id=:id"), {"id": recipient["id"]})
        else:
            first_writer.execute(text("SELECT id FROM files WHERE id=:id FOR UPDATE"), {"id": file_id})
        if transition == "delete":
            first_writer.execute(text("UPDATE files SET status='deleted', deleted_at=UTC_TIMESTAMP(6) WHERE id=:id"), {"id": file_id})
        elif transition == "grant":
            first_writer.execute(text("""INSERT INTO file_access
                (file_id, owner_id, user_id, key_id, access_type, wrapped_aes_key)
                VALUES (:file_id, :owner_id, :user_id, :key_id, 'share', :wrapped)"""), {
                "file_id": file_id, "owner_id": owner["id"], "user_id": recipient["id"],
                "key_id": payload["key_id"], "wrapped": b"\xBB" * 256,
            })
        elif transition == "revoke":
            first_writer.execute(text("UPDATE file_access SET revoked_at=UTC_TIMESTAMP(6) WHERE file_id=:id AND user_id=:uid"),
                                 {"id": file_id, "uid": recipient["id"]})

        event.listen(engine, "before_cursor_execute", observe_query)
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                pending = pool.submit(client.post, f"/files/{file_id}/shares", json=payload, headers=headers)
                try:
                    assert file_query_started.wait(5), "Second request never reached the file read."
                    with pytest.raises(TimeoutError):
                        pending.result(timeout=0.2)
                finally:
                    transaction.commit()
                response = pending.result(timeout=10)
        finally:
            event.remove(engine, "before_cursor_execute", observe_query)
        assert response.status_code == expected_status, response.text
        with engine.connect() as connection:
            count = connection.execute(text("SELECT COUNT(*) FROM file_access WHERE file_id=:id AND user_id=:uid"),
                                       {"id": file_id, "uid": recipient["id"]}).scalar_one()
        assert count == (1 if transition in {"grant", "revoke"} else 0)
