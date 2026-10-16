"""Account endpoints and reusable authentication dependencies for file routes."""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from threading import Lock
from typing import Annotated
from uuid import uuid4

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database.session import get_session

router = APIRouter()
COOKIE_NAME = "secure_share_session"
SESSION_DAYS = 7
password_hasher = PasswordHasher()
_dummy_hash = password_hasher.hash(secrets.token_urlsafe(32))
EMAIL_RE = re.compile(r"^[^\s@\x00-\x1f]+@[^\s@\x00-\x1f]+\.[^\s@\x00-\x1f]+$")
_rate_lock = Lock()
_rate_counts = {}


def utc_now():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def normalize_email(value: str):
    email = value.strip().lower()
    if len(email) > 254 or not email.isascii() or not EMAIL_RE.fullmatch(email):
        raise ValueError("Email không hợp lệ.")
    return email


class RegisterBody(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)
    email: str
    password: str = Field(min_length=8, max_length=1024)
    confirm_password: str

    @field_validator("full_name")
    @classmethod
    def name_valid(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Tên không được để trống.")
        return value

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        return normalize_email(value)


class LoginBody(BaseModel):
    email: str
    password: str = Field(max_length=1024)

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        return normalize_email(value)


class ProfileBody(BaseModel):
    full_name: str = Field(min_length=1, max_length=100)

    @field_validator("full_name")
    @classmethod
    def name_valid(cls, value):
        value = value.strip()
        if not value:
            raise ValueError("Tên không được để trống.")
        return value


class PasswordBody(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=1024)


class KeyBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    public_key_jwk: dict


def check_origin(request: Request):
    """Reject browser mutations from origins other than this host or configured UI hosts."""
    origin = request.headers.get("origin")
    if origin:
        allowed = {str(request.base_url).rstrip("/")}
        allowed.update(item.strip() for item in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(","))
        if origin not in allowed:
            raise HTTPException(403, "Nguồn yêu cầu không được phép.")
    elif request.headers.get("sec-fetch-site") == "cross-site":
        raise HTTPException(403, "Nguồn yêu cầu không được phép.")


def rate_limit(key: str, limit: int, seconds: int):
    """Small single-process guard; deployment proxy should enforce a shared limit."""
    now = time.monotonic()
    with _rate_lock:
        if len(_rate_counts) > 10000:
            _rate_counts.clear()
        start, count = _rate_counts.get(key, (now, 0))
        if now - start >= seconds:
            start, count = now, 0
        if count >= limit:
            raise HTTPException(429, "Quá nhiều yêu cầu. Vui lòng thử lại sau.")
        _rate_counts[key] = (start, count + 1)


def token_bytes(request: Request):
    raw = request.cookies.get(COOKIE_NAME, "")
    try:
        if len(raw) != 43:
            return None
        value = base64.urlsafe_b64decode(raw + "=")
        return value if len(value) == 32 and base64.urlsafe_b64encode(value).decode().rstrip("=") == raw else None
    except (ValueError, TypeError):
        return None


def csrf_for(token: bytes):
    return base64.urlsafe_b64encode(hashlib.sha256(b"secure-share-csrf-v1:" + token).digest()).decode().rstrip("=")


def current_user(request: Request, db: Annotated[Session, Depends(get_session)]):
    token = token_bytes(request)
    if token is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chưa đăng nhập hoặc phiên đã hết hạn.")
    row = db.execute(text("""
        SELECT u.id, u.full_name, u.email, u.password_hash, u.status, s.id AS session_id
        FROM auth_sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = :token_hash AND s.revoked_at IS NULL
          AND s.expires_at > :now AND u.status = 'active'
    """), {"token_hash": hashlib.sha256(token).digest(), "now": utc_now()}).mappings().first()
    if row is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Chưa đăng nhập hoặc phiên đã hết hạn.")
    return dict(row)


def require_csrf(request: Request, user: Annotated[dict, Depends(current_user)]):
    check_origin(request)
    token = token_bytes(request)
    supplied = request.headers.get("x-csrf-token", "")
    if token is None or not hmac.compare_digest(supplied, csrf_for(token)):
        raise HTTPException(403, "CSRF token không hợp lệ.")
    return user


CurrentUser = Annotated[dict, Depends(current_user)]
MutatingUser = Annotated[dict, Depends(require_csrf)]
DB = Annotated[Session, Depends(get_session)]


def issue_session(db: Session, response: Response, user_id: str):
    token = secrets.token_bytes(32)
    encoded = base64.urlsafe_b64encode(token).decode().rstrip("=")
    now = utc_now()
    db.execute(text("""
        INSERT INTO auth_sessions (id, user_id, token_hash, created_at, expires_at)
        VALUES (:id, :user_id, :token_hash, :created_at, :expires_at)
    """), {"id": str(uuid4()), "user_id": user_id,
           "token_hash": hashlib.sha256(token).digest(), "created_at": now,
           "expires_at": now + timedelta(days=SESSION_DAYS)})
    response.set_cookie(COOKIE_NAME, encoded, max_age=SESSION_DAYS * 86400,
                        httponly=True, secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
                        samesite="lax", path="/")


def active_key(db: Session, user_id: str):
    row = db.execute(text("""
        SELECT id, public_key_jwk, fingerprint_sha256 FROM public_keys
        WHERE user_id = :user_id AND revoked_at IS NULL
    """), {"user_id": user_id}).mappings().first()
    if row is None:
        return None
    jwk = row["public_key_jwk"]
    if isinstance(jwk, str):
        jwk = json.loads(jwk)
    return {"key_id": row["id"], "public_key_jwk": jwk,
            "fingerprint_sha256": bytes(row["fingerprint_sha256"]).hex()}


def public_profile(db: Session, user: dict, csrf_token: str | None = None):
    result = {"id": user["id"], "full_name": user["full_name"],
              "email": user["email"], "current_key": active_key(db, user["id"])}
    if csrf_token is not None:
        result["csrf_token"] = csrf_token
    return result


@router.post("/auth/register", status_code=201)
def register(body: RegisterBody, request: Request, response: Response, db: DB):
    check_origin(request)
    client_ip = request.client.host if request.client else "unknown"
    rate_limit(f"register-ip:{client_ip}", 10, 3600)
    if body.password != body.confirm_password:
        raise HTTPException(422, "Mật khẩu xác nhận không khớp.")
    user_id = str(uuid4())
    now = utc_now()
    try:
        with db.begin():
            db.execute(text("""
                INSERT INTO users (id, full_name, email, password_hash, status, created_at, updated_at)
                VALUES (:id, :full_name, :email, :password_hash, 'active', :now, :now)
            """), {"id": user_id, "full_name": body.full_name, "email": body.email,
                   "password_hash": password_hasher.hash(body.password), "now": now})
            issue_session(db, response, user_id)
    except IntegrityError as exc:
        raise HTTPException(409, "Email đã được sử dụng.") from exc
    return {"status": "ok"}


@router.post("/auth/login")
def login(body: LoginBody, request: Request, response: Response, db: DB):
    check_origin(request)
    client_ip = request.client.host if request.client else "unknown"
    rate_limit(f"login-ip:{client_ip}", 30, 60)
    rate_limit(f"login-email:{client_ip}:{body.email}", 10, 60)
    row = db.execute(text("SELECT id, password_hash, status FROM users WHERE email = :email"),
                     {"email": body.email}).mappings().first()
    stored_hash = row["password_hash"] if row else _dummy_hash
    try:
        valid = password_hasher.verify(stored_hash, body.password)
    except (VerificationError, InvalidHashError):
        valid = False
    if not row or row["status"] != "active" or not valid:
        raise HTTPException(401, "Email hoặc mật khẩu không đúng.")
    now = utc_now()
    db.execute(text("UPDATE users SET last_login_at = :now WHERE id = :id"),
               {"now": now, "id": row["id"]})
    issue_session(db, response, row["id"])
    db.commit()
    return {"status": "ok"}


@router.post("/auth/logout", status_code=204)
def logout(response: Response, user: MutatingUser, db: DB):
    db.execute(text("UPDATE auth_sessions SET revoked_at = :now WHERE id = :id AND revoked_at IS NULL"),
               {"now": utc_now(), "id": user["session_id"]})
    db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


@router.get("/me")
def me(request: Request, user: CurrentUser, db: DB):
    return public_profile(db, user, csrf_for(token_bytes(request)))


@router.patch("/me")
def update_me(body: ProfileBody, user: MutatingUser, db: DB):
    db.execute(text("UPDATE users SET full_name = :name, updated_at = :now WHERE id = :id"),
               {"name": body.full_name, "now": utc_now(), "id": user["id"]})
    db.commit()
    user["full_name"] = body.full_name
    return public_profile(db, user)


@router.post("/me/password", status_code=204)
def change_password(body: PasswordBody, user: MutatingUser, db: DB):
    try:
        valid = password_hasher.verify(user["password_hash"], body.current_password)
    except (VerificationError, InvalidHashError):
        valid = False
    if not valid:
        raise HTTPException(403, "Mật khẩu hiện tại không đúng.")
    if body.new_password == body.current_password:
        raise HTTPException(422, "Mật khẩu mới phải khác mật khẩu hiện tại.")
    now = utc_now()
    db.execute(text("UPDATE users SET password_hash = :hash, updated_at = :now WHERE id = :id"),
               {"hash": password_hasher.hash(body.new_password), "now": now, "id": user["id"]})
    db.execute(text("UPDATE auth_sessions SET revoked_at = :now WHERE user_id = :id AND revoked_at IS NULL AND id <> :session_id"),
               {"now": now, "id": user["id"], "session_id": user["session_id"]})
    db.commit()


@router.get("/users/lookup")
def lookup_user(email: str, user: CurrentUser, db: DB):
    rate_limit(f"lookup:{user['id']}", 30, 60)
    try:
        normalized = normalize_email(email)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    row = db.execute(text("SELECT id, full_name, email FROM users WHERE email = :email AND status = 'active'"),
                     {"email": normalized}).mappings().first()
    if row is None or row["id"] == user["id"]:
        raise HTTPException(404, "Không tìm thấy người nhận.")
    return public_profile(db, dict(row))


def validate_public_jwk(jwk: dict):
    if set(jwk) - {"kty", "n", "e", "alg", "key_ops", "ext"}:
        raise HTTPException(422, "Public JWK chứa trường không được phép.")
    if jwk.get("kty") != "RSA" or jwk.get("alg") not in (None, "RSA-OAEP-256"):
        raise HTTPException(422, "Yêu cầu RSA-OAEP-256 public key.")
    if jwk.get("key_ops") not in (["encrypt", "wrapKey"], ["wrapKey", "encrypt"], ["wrapKey"]):
        raise HTTPException(422, "Public key cần quyền wrapKey để bọc khóa AES.")
    if jwk.get("ext") is not True:
        raise HTTPException(422, "Public key phải cho phép export.")
    try:
        n, e = jwk["n"], jwk["e"]
        if (not isinstance(n, str) or not isinstance(e, str) or len(n) > 512 or len(e) > 12
                or not re.fullmatch(r"[A-Za-z0-9_-]+", n) or not re.fullmatch(r"[A-Za-z0-9_-]+", e)):
            raise ValueError()
        modulus = int.from_bytes(base64.urlsafe_b64decode(n + "=" * (-len(n) % 4)), "big")
        exponent = int.from_bytes(base64.urlsafe_b64decode(e + "=" * (-len(e) % 4)), "big")
        key = rsa.RSAPublicNumbers(exponent, modulus).public_key()
        if key.key_size != 2048 or exponent != 65537:
            raise ValueError()
        der = key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(422, "Public JWK phải là RSA 2048-bit, e=65537 hợp lệ.") from exc
    return der


@router.post("/me/keys", status_code=201)
def register_key(body: KeyBody, user: MutatingUser, db: DB):
    der = validate_public_jwk(body.public_key_jwk)
    fingerprint = hashlib.sha256(der).digest()
    if active_key(db, user["id"]) is not None:
        raise HTTPException(409, "Tài khoản đã có public key hiện tại.")
    key_id = str(uuid4())
    try:
        db.execute(text("""
            INSERT INTO public_keys (id, user_id, public_key_jwk, fingerprint_sha256, rsa_bits, created_at)
            VALUES (:id, :user_id, :jwk, :fingerprint, 2048, :now)
        """), {"id": key_id, "user_id": user["id"],
               "jwk": json.dumps(body.public_key_jwk, separators=(",", ":")),
               "fingerprint": fingerprint, "now": utc_now()})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(409, "Public key đã tồn tại hoặc đã thay đổi.") from exc
    return {"key_id": key_id, "public_key_jwk": body.public_key_jwk,
            "fingerprint_sha256": fingerprint.hex()}
