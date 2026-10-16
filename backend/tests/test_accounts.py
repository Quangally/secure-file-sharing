import base64
import hashlib

import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database.session import get_session
from app.main import app


@pytest.fixture
def client():
    engine = create_engine("sqlite+pysqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    with engine.begin() as connection:
        connection.exec_driver_sql("""CREATE TABLE users (
            id TEXT PRIMARY KEY, full_name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL, status TEXT NOT NULL, created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL, last_login_at DATETIME)""")
        connection.exec_driver_sql("""CREATE TABLE auth_sessions (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, token_hash BLOB UNIQUE NOT NULL,
            created_at DATETIME NOT NULL, expires_at DATETIME NOT NULL, revoked_at DATETIME)""")
        connection.exec_driver_sql("""CREATE TABLE public_keys (
            id TEXT PRIMARY KEY, user_id TEXT NOT NULL, public_key_jwk TEXT NOT NULL,
            fingerprint_sha256 BLOB UNIQUE NOT NULL, rsa_bits INTEGER NOT NULL,
            created_at DATETIME NOT NULL, revoked_at DATETIME)""")

    def test_session():
        with Session(engine) as session:
            yield session

    app.dependency_overrides[get_session] = test_session
    with TestClient(app) as test_client:
        yield test_client, engine
    app.dependency_overrides.clear()
    engine.dispose()


def register(client, email="user@example.test"):
    response = client.post("/auth/register", json={
        "full_name": " Test User ", "email": email.upper(),
        "password": "correct horse battery staple", "confirm_password": "correct horse battery staple",
    })
    assert response.status_code == 201, response.text
    assert response.cookies.get("secure_share_session")
    assert "httponly" in response.headers["set-cookie"].lower()
    return client.get("/me").json()


def test_register_login_profile_csrf_logout(client):
    http, engine = client
    assert http.get("/me").status_code == 401
    profile = register(http)
    assert profile["full_name"] == "Test User"
    assert profile["email"] == "user@example.test"
    assert profile["current_key"] is None
    assert len(profile["csrf_token"]) == 43
    cookie = http.cookies.get("secure_share_session")
    with engine.connect() as connection:
        row = connection.execute(text("SELECT password_hash FROM users")).scalar_one()
        stored_token = connection.execute(text("SELECT token_hash FROM auth_sessions")).scalar_one()
    assert row.startswith("$argon2id$")
    assert bytes(stored_token) == hashlib.sha256(base64.urlsafe_b64decode(cookie + "=")).digest()
    assert http.patch("/me", json={"full_name": "New Name"}).status_code == 403
    assert http.patch("/me", headers={"X-CSRF-Token": profile["csrf_token"]}, json={"full_name": "New Name"}).json()["full_name"] == "New Name"
    assert http.post("/auth/logout", headers={"X-CSRF-Token": profile["csrf_token"]}).status_code == 204
    assert http.get("/me").status_code == 401
    assert http.post("/auth/login", json={"email": "USER@example.test", "password": "correct horse battery staple"}).status_code == 200
    assert http.get("/me").json()["full_name"] == "New Name"


def test_duplicate_password_and_origin(client):
    http, _ = client
    profile = register(http)
    assert http.post("/auth/register", json={
        "full_name": "Other", "email": "USER@example.test", "password": "password123", "confirm_password": "password123",
    }).status_code == 409
    assert http.post("/auth/login", headers={"Origin": "https://evil.example"}, json={
        "email": "user@example.test", "password": "correct horse battery staple",
    }).status_code == 403
    assert http.post("/me/password", headers={"X-CSRF-Token": profile["csrf_token"]}, json={
        "current_password": "wrong", "new_password": "new-password-123",
    }).status_code == 403
    assert http.post("/me/password", headers={"X-CSRF-Token": profile["csrf_token"]}, json={
        "current_password": "correct horse battery staple", "new_password": "new-password-123",
    }).status_code == 204
    assert http.post("/auth/login", json={"email": "user@example.test", "password": "correct horse battery staple"}).status_code == 401
    assert http.post("/auth/login", json={"email": "user@example.test", "password": "new-password-123"}).status_code == 200


def test_lookup_and_key_registration(client):
    http, _ = client
    register(http, "alice@example.test")
    register(http, "bob@example.test")
    assert http.get("/users/lookup?email=alice@example.test").status_code == 200
    assert http.get("/users/lookup?email=bob@example.test").status_code == 404
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key().public_numbers()
    encode = lambda value: base64.urlsafe_b64encode(value.to_bytes((value.bit_length() + 7) // 8, "big")).decode().rstrip("=")
    jwk = {"kty": "RSA", "n": encode(key.n), "e": encode(key.e),
           "alg": "RSA-OAEP-256", "key_ops": ["encrypt", "wrapKey"], "ext": True}
    csrf = http.get("/me").json()["csrf_token"]
    assert http.post("/me/keys", headers={"X-CSRF-Token": csrf}, json={"public_key_jwk": {**jwk, "d": "secret"}}).status_code == 422
    added = http.post("/me/keys", headers={"X-CSRF-Token": csrf}, json={"public_key_jwk": jwk})
    assert added.status_code == 201, added.text
    assert len(added.json()["fingerprint_sha256"]) == 64
    assert http.get("/me").json()["current_key"]["key_id"] == added.json()["key_id"]
    assert http.post("/me/keys", headers={"X-CSRF-Token": csrf}, json={"public_key_jwk": jwk}).status_code == 409


def test_expired_session_and_disabled_user(client):
    http, engine = client
    profile = register(http)
    with engine.begin() as connection:
        connection.execute(text("UPDATE auth_sessions SET expires_at = '2000-01-01 00:00:00'"))
    assert http.get("/me").status_code == 401
    assert http.patch("/me", headers={"X-CSRF-Token": profile["csrf_token"]}, json={"full_name": "No"}).status_code == 401
    with engine.begin() as connection:
        connection.execute(text("UPDATE auth_sessions SET expires_at = '2999-01-01 00:00:00'"))
        connection.execute(text("UPDATE users SET status = 'disabled'"))
    assert http.get("/me").status_code == 401
    assert http.post("/auth/login", json={"email": "user@example.test", "password": "correct horse battery staple"}).status_code == 401
