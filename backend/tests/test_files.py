"""Tests cho backend tệp & chia sẻ — Phan Hoàng Vũ (3123410436).

Dùng TestClient của FastAPI + SQLite in-memory (StaticPool).
Chạy: pytest backend/tests/test_files.py -v
"""

import base64
import hashlib
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.api.accounts import _rate_counts, _rate_lock
from app.database.session import get_session
from app.main import app


@pytest.fixture
def test_setup(tmp_path):
    with _rate_lock:
        _rate_counts.clear()
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    with engine.begin() as conn:
        conn.exec_driver_sql("""CREATE TABLE users (
            id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL, status TEXT NOT NULL, created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL, last_login_at DATETIME)""")
        conn.exec_driver_sql("""CREATE TABLE auth_sessions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash BLOB UNIQUE NOT NULL,
            created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, revoked_at DATETIME)""")
        conn.exec_driver_sql("""CREATE TABLE public_keys (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key_jwk TEXT NOT NULL,
            fingerprint_sha256 BLOB UNIQUE NOT NULL, rsa_bits INTEGER NOT NULL,
            created_at DATETIME NOT NULL, revoked_at DATETIME)""")
        conn.exec_driver_sql("""CREATE TABLE files (
            id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
            storage_key TEXT NOT NULL UNIQUE,
            ciphertext_size INTEGER NOT NULL,
            ciphertext_sha256 BLOB NOT NULL,
            content_iv BLOB NOT NULL, metadata_iv BLOB NOT NULL,
            encrypted_metadata BLOB NOT NULL,
            protocol_version INTEGER NOT NULL DEFAULT 1,
            status TEXT NOT NULL DEFAULT 'ready',
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            deleted_at DATETIME)""")
        conn.exec_driver_sql("""CREATE TABLE file_access (
            file_id TEXT NOT NULL, owner_id TEXT NOT NULL,
            user_id TEXT NOT NULL, key_id TEXT NOT NULL,
            access_type TEXT NOT NULL,
            wrapped_aes_key BLOB NOT NULL,
            created_at DATETIME NOT NULL,
            granted_at DATETIME NOT NULL,
            revoked_at DATETIME,
            PRIMARY KEY (file_id, user_id))""")
        conn.exec_driver_sql("""CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id TEXT, file_id TEXT, target_user_id TEXT,
            action TEXT NOT NULL,
            outcome TEXT NOT NULL DEFAULT 'success',
            request_id TEXT NOT NULL,
            occurred_at DATETIME NOT NULL)""")

    def test_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = test_session

    upload_dir = tmp_path / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    old_storage = os.environ.get("STORAGE_DIR")
    os.environ["STORAGE_DIR"] = str(upload_dir)

    with TestClient(app) as client:
        yield client, engine, upload_dir

    if old_storage is not None:
        os.environ["STORAGE_DIR"] = old_storage
    else:
        os.environ.pop("STORAGE_DIR", None)
    app.dependency_overrides.clear()
    engine.dispose()


def register_user(client, email="user@example.test"):
    resp = client.post("/auth/register", json={
        "full_name": "Test User",
        "email": email,
        "password": "correct horse battery staple",
        "confirm_password": "correct horse battery staple",
    })
    assert resp.status_code == 201, resp.text
    profile = client.get("/me").json()

    # Tạo RSA public key hợp lệ
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key().public_numbers()
    encode = lambda val: base64.urlsafe_b64encode(val.to_bytes((val.bit_length() + 7) // 8, "big")).decode().rstrip("=")
    jwk = {"kty": "RSA", "n": encode(key.n), "e": encode(key.e),
           "alg": "RSA-OAEP-256", "key_ops": ["encrypt", "wrapKey"], "ext": True}
    key_resp = client.post("/me/keys", headers={"X-CSRF-Token": profile["csrf_token"]}, json={"public_key_jwk": jwk})
    assert key_resp.status_code == 201, key_resp.text
    key_info = key_resp.json()

    # Cập nhật profile có current_key
    profile["current_key"] = key_info
    return profile


def make_manifest(file_id: str, owner_key_id: str):
    iv1 = secrets.token_bytes(12)
    iv2 = secrets.token_bytes(12)
    while iv1 == iv2:
        iv2 = secrets.token_bytes(12)
    return {
        "file_id": file_id,
        "protocol_version": 1,
        "content_iv_base64": base64.b64encode(iv1).decode(),
        "metadata_iv_base64": base64.b64encode(iv2).decode(),
        "encrypted_metadata_base64": base64.b64encode(secrets.token_bytes(64)).decode(),
        "owner_key_id": owner_key_id,
        "owner_wrapped_aes_key_base64": base64.b64encode(b"\xAB" * 256).decode(),
    }


SAMPLE_CIPHERTEXT = secrets.token_bytes(64)


# ══════════════════════════════════════════════════════════════════════════════
# TESTS
# ══════════════════════════════════════════════════════════════════════════════

def test_upload_and_download_flow(test_setup):
    client, engine, upload_dir = test_setup
    owner = register_user(client, "alice@test.local")
    csrf = owner["csrf_token"]
    file_id = str(uuid4())
    manifest = make_manifest(file_id, owner["current_key"]["key_id"])

    # 1. Upload file
    upload_resp = client.post(
        "/files",
        files={"ciphertext": (f"{file_id}.bin", SAMPLE_CIPHERTEXT, "application/octet-stream")},
        data={"manifest": json.dumps(manifest)},
        headers={"X-CSRF-Token": csrf},
    )
    assert upload_resp.status_code == 201, upload_resp.text
    assert upload_resp.json()["id"] == file_id

    # 2. Get list files
    list_resp = client.get("/files?page=1&page_size=20")
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) == 1
    assert items[0]["id"] == file_id
    assert items[0]["share_count"] == 0

    # 3. Get envelope
    env_resp = client.get(f"/files/{file_id}/envelope")
    assert env_resp.status_code == 200
    env = env_resp.json()
    assert env["id"] == file_id
    assert len(env["ciphertext_sha256"]) == 64
    assert env["wrapped_aes_key_base64"] == manifest["owner_wrapped_aes_key_base64"]

    # 4. Download content
    dl_resp = client.get(f"/files/{file_id}/content")
    assert dl_resp.status_code == 200
    assert dl_resp.content == SAMPLE_CIPHERTEXT


def test_share_and_revoke_flow(test_setup):
    client, engine, upload_dir = test_setup
    # Đăng ký Alice (owner)
    alice = register_user(client, "alice@test.local")
    file_id = str(uuid4())
    manifest = make_manifest(file_id, alice["current_key"]["key_id"])
    client.post(
        "/files",
        files={"ciphertext": (f"{file_id}.bin", SAMPLE_CIPHERTEXT, "application/octet-stream")},
        data={"manifest": json.dumps(manifest)},
        headers={"X-CSRF-Token": alice["csrf_token"]},
    )

    # Đăng xuất Alice, đăng ký Bob (recipient)
    client.post("/auth/logout", headers={"X-CSRF-Token": alice["csrf_token"]})
    bob = register_user(client, "bob@test.local")

    # Bob chưa được share thì 403
    assert client.get(f"/files/{file_id}/envelope").status_code == 403
    assert client.get(f"/files/{file_id}/content").status_code == 403
    assert client.get("/files/shared-with-me").json()["total"] == 0

    # Đăng nhập lại Alice để share cho Bob
    client.post("/auth/logout", headers={"X-CSRF-Token": bob["csrf_token"]})
    client.post("/auth/login", json={"email": "alice@test.local", "password": "correct horse battery staple"})
    alice_profile = client.get("/me").json()

    # Alice share cho Bob
    share_payload = {
        "recipient_user_id": bob["id"],
        "key_id": bob["current_key"]["key_id"],
        "verified_fingerprint_sha256": bob["current_key"]["fingerprint_sha256"],
        "wrapped_aes_key_base64": base64.b64encode(b"\xBB" * 256).decode(),
    }
    share_resp = client.post(
        f"/files/{file_id}/shares",
        json=share_payload,
        headers={"X-CSRF-Token": alice_profile["csrf_token"]},
    )
    assert share_resp.status_code == 201, share_resp.text

    # Xem danh sách người được share
    shares_list = client.get(f"/files/{file_id}/shares").json()
    assert len(shares_list["items"]) == 1
    assert shares_list["items"][0]["user_id"] == bob["id"]

    # Đăng nhập lại Bob để kiểm tra xem file đã nhận chưa
    client.post("/auth/logout", headers={"X-CSRF-Token": alice_profile["csrf_token"]})
    client.post("/auth/login", json={"email": "bob@test.local", "password": "correct horse battery staple"})
    bob_profile = client.get("/me").json()

    shared_resp = client.get("/files/shared-with-me")
    assert shared_resp.status_code == 200
    assert shared_resp.json()["total"] == 1
    assert shared_resp.json()["items"][0]["id"] == file_id
    assert shared_resp.json()["items"][0]["shared_by"]["id"] == alice["id"]

    # Bob tải được envelope và content
    assert client.get(f"/files/{file_id}/envelope").status_code == 200
    assert client.get(f"/files/{file_id}/content").content == SAMPLE_CIPHERTEXT

    # Đăng nhập lại Alice để thu hồi quyền
    client.post("/auth/logout", headers={"X-CSRF-Token": bob_profile["csrf_token"]})
    client.post("/auth/login", json={"email": "alice@test.local", "password": "correct horse battery staple"})
    alice_profile = client.get("/me").json()

    revoke_resp = client.delete(
        f"/files/{file_id}/shares/{bob['id']}",
        headers={"X-CSRF-Token": alice_profile["csrf_token"]},
    )
    assert revoke_resp.status_code == 204

    # Đăng nhập lại Bob: Bob không còn quyền nữa
    client.post("/auth/logout", headers={"X-CSRF-Token": alice_profile["csrf_token"]})
    client.post("/auth/login", json={"email": "bob@test.local", "password": "correct horse battery staple"})
    assert client.get(f"/files/{file_id}/envelope").status_code == 403
    assert client.get("/files/shared-with-me").json()["total"] == 0


def test_delete_file_flow(test_setup):
    client, engine, upload_dir = test_setup
    user = register_user(client, "carol@test.local")
    file_id = str(uuid4())
    manifest = make_manifest(file_id, user["current_key"]["key_id"])

    client.post(
        "/files",
        files={"ciphertext": (f"{file_id}.bin", SAMPLE_CIPHERTEXT, "application/octet-stream")},
        data={"manifest": json.dumps(manifest)},
        headers={"X-CSRF-Token": user["csrf_token"]},
    )
    assert client.get(f"/files/{file_id}/envelope").status_code == 200

    # Xóa tệp
    del_resp = client.delete(f"/files/{file_id}", headers={"X-CSRF-Token": user["csrf_token"]})
    assert del_resp.status_code == 204

    # Sau khi xóa: envelope 404, list files rỗng
    assert client.get(f"/files/{file_id}/envelope").status_code == 404
    assert client.get("/files").json()["total"] == 0


def login_user(client, email):
    response = client.post("/auth/login", json={
        "email": email, "password": "correct horse battery staple",
    })
    assert response.status_code == 200, response.text
    return client.get("/me").json()


@pytest.fixture
def shared_file(test_setup):
    client, engine, storage = test_setup
    owner = register_user(client, "owner@files.test")
    file_id = str(uuid4())
    response = client.post(
        "/files", headers={"X-CSRF-Token": owner["csrf_token"]},
        files={"ciphertext": ("file.bin", SAMPLE_CIPHERTEXT, "application/octet-stream")},
        data={"manifest": json.dumps(make_manifest(file_id, owner["current_key"]["key_id"]))},
    )
    assert response.status_code == 201, response.text
    recipient = register_user(client, "recipient@files.test")
    owner = login_user(client, "owner@files.test")
    payload = {
        "recipient_user_id": recipient["id"],
        "key_id": recipient["current_key"]["key_id"],
        "verified_fingerprint_sha256": recipient["current_key"]["fingerprint_sha256"],
        "wrapped_aes_key_base64": base64.b64encode(b"\xBB" * 256).decode(),
    }
    response = client.post(f"/files/{file_id}/shares", json=payload,
                           headers={"X-CSRF-Token": owner["csrf_token"]})
    assert response.status_code == 201, response.text
    return client, engine, owner, recipient, file_id, payload


def test_disabled_owner_blocks_shared_list_envelope_and_content(shared_file):
    client, engine, owner, recipient, file_id, _ = shared_file
    login_user(client, "recipient@files.test")
    item = client.get("/files/shared-with-me").json()["items"][0]
    assert item["shared_by"] == {
        "id": owner["id"], "full_name": owner["full_name"], "email": owner["email"],
    }
    with engine.begin() as conn:
        conn.execute(text("UPDATE users SET status='disabled' WHERE id=:id"), {"id": owner["id"]})
    listing = client.get("/files/shared-with-me").json()
    assert listing["items"] == []
    assert listing["total"] == 0
    assert client.get(f"/files/{file_id}/envelope").status_code == 404
    assert client.get(f"/files/{file_id}/content").status_code == 404


@pytest.mark.parametrize("bad_value", [[], None, "text", 123, True, {},
    {"file_id": None}, {"file_id": 123}])
def test_invalid_manifest_shape_returns_422_without_writes(test_setup, bad_value):
    client, engine, storage = test_setup
    owner = register_user(client)
    response = client.post("/files", headers={"X-CSRF-Token": owner["csrf_token"]},
                           files={"ciphertext": ("file.bin", SAMPLE_CIPHERTEXT)},
                           data={"manifest": json.dumps(bad_value)})
    assert response.status_code == 422, response.text
    with engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM files")).scalar_one() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM audit_logs WHERE action='file.upload'")).scalar_one() == 0
    assert list(storage.iterdir()) == []


@pytest.mark.parametrize("field,value", [
    ("owner_key_id", None), ("owner_key_id", 123),
    ("protocol_version", True), ("protocol_version", "1"), ("protocol_version", 1.0),
    ("protocol_version", 2), ("content_iv_base64", None),
    ("metadata_iv_base64", []), ("encrypted_metadata_base64", 123),
    ("owner_wrapped_aes_key_base64", {}),
])
def test_invalid_manifest_field_types_return_422(test_setup, field, value):
    client, _, storage = test_setup
    owner = register_user(client)
    manifest = make_manifest(str(uuid4()), owner["current_key"]["key_id"])
    manifest[field] = value
    response = client.post("/files", headers={"X-CSRF-Token": owner["csrf_token"]},
                           files={"ciphertext": ("file.bin", SAMPLE_CIPHERTEXT)},
                           data={"manifest": json.dumps(manifest)})
    assert response.status_code == 422, response.text
    assert list(storage.iterdir()) == []


def test_revoke_regrant_and_deleted_file_cannot_be_shared(shared_file):
    client, engine, owner, recipient, file_id, payload = shared_file
    headers = {"X-CSRF-Token": owner["csrf_token"]}
    assert client.post(f"/files/{file_id}/shares", json=payload, headers=headers).status_code == 409
    assert client.delete(f"/files/{file_id}/shares/{recipient['id']}", headers=headers).status_code == 204
    assert client.get(f"/files/{file_id}/shares").json()["items"] == []
    assert client.post(f"/files/{file_id}/shares", json=payload, headers=headers).status_code == 201
    assert len(client.get(f"/files/{file_id}/shares").json()["items"]) == 1
    assert client.delete(f"/files/{file_id}", headers=headers).status_code == 204
    assert client.post(f"/files/{file_id}/shares", json=payload, headers=headers).status_code == 404
    login_user(client, "recipient@files.test")
    assert client.get(f"/files/{file_id}/content").status_code == 404
    assert client.get(f"/files/{file_id}/envelope").status_code == 404
