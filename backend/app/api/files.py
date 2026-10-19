"""Backend tệp và chia sẻ — Phan Hoàng Vũ (3123410436).

Endpoints:
  POST   /files                          Upload ciphertext + manifest + owner envelope
  GET    /files                          Danh sách tệp của tôi (phân trang)
  GET    /files/shared-with-me           Tệp được chia sẻ với tôi
  GET    /files/{id}/envelope            Metadata + wrapped AES key của user hiện tại
  GET    /files/{id}/content             Stream ciphertext bytes
  DELETE /files/{id}                     Xóa mềm tệp
  POST   /files/{id}/shares             Cấp quyền chia sẻ
  GET    /files/{id}/shares             Danh sách người nhận hiện tại
  DELETE /files/{id}/shares/{user_id}   Thu hồi quyền

Quy tắc bảo mật:
- owner_id luôn lấy từ session, không tin client khai báo.
- Chỉ file status='ready' mới được list / download / share.
- storage_key ngẫu nhiên, không chứa tên gốc hay path từ client.
- Ghi audit_logs cùng transaction với thay đổi dữ liệu.
- Không giải mã payload ở backend (mã hóa đầu cuối).
"""

import base64
import hashlib
import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.accounts import CurrentUser, DB, MutatingUser
from app.database.session import get_session

router = APIRouter()

# ── Hằng số ───────────────────────────────────────────────────────────────────

MAX_CIPHERTEXT_BYTES = 25 * 1024 * 1024 + 16      # 25 MiB plaintext + 16-byte GCM tag
MAX_METADATA_BYTES   = 4096
MIN_CIPHERTEXT_BYTES = 16
WRAPPED_AES_KEY_LEN  = 256                         # RSA-OAEP(2048) → 256 byte
IV_LEN               = 12
PROTOCOL_VERSION     = 1
PAGE_SIZE_MAX        = 100

UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
)


def _storage_dir() -> Path:
    path = Path(os.getenv("STORAGE_DIR", "uploads")).resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def validate_uuid(value: str, label: str = "id") -> str:
    if not UUID_RE.fullmatch(value.lower()):
        raise HTTPException(422, f"{label} không đúng định dạng UUID.")
    return value.lower()


def decode_b64(value: str, label: str) -> bytes:
    """Giải mã base64 tiêu chuẩn (không phải urlsafe), padding tự động."""
    try:
        padded = value + "=" * (-len(value) % 4)
        return base64.b64decode(padded, validate=True)
    except Exception as exc:
        raise HTTPException(422, f"{label} phải là chuỗi Base64 hợp lệ.") from exc


def log_audit(
    db: Session,
    *,
    actor_id: str,
    action: str,
    file_id: str | None = None,
    target_user_id: str | None = None,
    outcome: str = "success",
    request_id: str,
) -> None:
    db.execute(
        text("""
            INSERT INTO audit_logs
                (actor_id, file_id, target_user_id, action, outcome, request_id, occurred_at)
            VALUES
                (:actor_id, :file_id, :target_user_id, :action, :outcome, :request_id, :occurred_at)
        """),
        {
            "actor_id":      actor_id,
            "file_id":       file_id,
            "target_user_id": target_user_id,
            "action":        action,
            "outcome":       outcome,
            "request_id":    request_id,
            "occurred_at":   utc_now(),
        },
    )


# ── Schema request / response ─────────────────────────────────────────────────

class ShareBody(BaseModel):
    recipient_user_id: str
    key_id: str
    verified_fingerprint_sha256: str = Field(min_length=64, max_length=64)
    wrapped_aes_key_base64: str

    @field_validator("recipient_user_id", "key_id")
    @classmethod
    def check_uuid(cls, v: str) -> str:
        if not UUID_RE.fullmatch(v.lower()):
            raise ValueError("Phải là UUID hợp lệ.")
        return v.lower()

    @field_validator("verified_fingerprint_sha256")
    @classmethod
    def check_fingerprint(cls, v: str) -> str:
        if not re.fullmatch(r"[0-9a-f]{64}", v.lower()):
            raise ValueError("Fingerprint phải là 64 ký tự hex thường.")
        return v.lower()


# ── Helper lấy envelope của một user trên một file ───────────────────────────

def _get_envelope_row(db: Session, file_id: str, user_id: str):
    """Trả row file_access chưa bị revoke, hoặc None."""
    return db.execute(
        text("""
            SELECT fa.key_id, fa.wrapped_aes_key, fa.access_type,
                   fa.granted_at, fa.revoked_at
            FROM file_access fa
            WHERE fa.file_id = :file_id
              AND fa.user_id = :user_id
              AND fa.revoked_at IS NULL
        """),
        {"file_id": file_id, "user_id": user_id},
    ).mappings().first()


def _file_item(row, envelope_row) -> dict:
    """Chuyển row files + row file_access thành dict trả về cho frontend."""
    iv_content  = base64.b64encode(bytes(row["content_iv"])).decode()
    iv_meta     = base64.b64encode(bytes(row["metadata_iv"])).decode()
    enc_meta    = base64.b64encode(bytes(row["encrypted_metadata"])).decode()
    wrapped_key = base64.b64encode(bytes(envelope_row["wrapped_aes_key"])).decode()

    created_at = row["created_at"]
    updated_at = row["updated_at"]
    item: dict = {
        "id":                        row["id"],
        "key_id":                    envelope_row["key_id"],
        "content_iv_base64":         iv_content,
        "metadata_iv_base64":        iv_meta,
        "encrypted_metadata_base64": enc_meta,
        "wrapped_aes_key_base64":    wrapped_key,
        "protocol_version":          row["protocol_version"],
        "ciphertext_size":           row["ciphertext_size"],
        "created_at":                created_at.isoformat() + "Z"
            if isinstance(created_at, datetime) else str(created_at) + "Z",
        "updated_at":                updated_at.isoformat() + "Z"
            if isinstance(updated_at, datetime) else str(updated_at) + "Z",
    }
    return item


# ══════════════════════════════════════════════════════════════════════════════
# POST /files — Upload
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/files", status_code=201)
async def upload_file(
    request:    Request,
    user:       MutatingUser,
    db:         DB,
    ciphertext: UploadFile = None,
    manifest:   str        = Form(...),
):
    """Nhận multipart: field 'ciphertext' (binary) + field 'manifest' (JSON string).

    Manifest JSON phải có:
      file_id, protocol_version, content_iv_base64, metadata_iv_base64,
      encrypted_metadata_base64, owner_key_id, owner_wrapped_aes_key_base64
    """
    request_id = str(uuid4())

    # --- Parse manifest ---
    try:
        m = json.loads(manifest)
    except json.JSONDecodeError as exc:
        raise HTTPException(422, "Manifest phải là JSON hợp lệ.") from exc

    file_id          = validate_uuid(m.get("file_id", ""), "file_id")
    protocol_version = m.get("protocol_version")
    if protocol_version != PROTOCOL_VERSION:
        raise HTTPException(422, f"Chỉ hỗ trợ protocol_version={PROTOCOL_VERSION}.")

    content_iv_b64  = m.get("content_iv_base64",  "")
    metadata_iv_b64 = m.get("metadata_iv_base64", "")
    enc_meta_b64    = m.get("encrypted_metadata_base64", "")
    owner_key_id    = validate_uuid(m.get("owner_key_id", ""), "owner_key_id")
    owner_wrapped_b64 = m.get("owner_wrapped_aes_key_base64", "")

    content_iv  = decode_b64(content_iv_b64,  "content_iv_base64")
    metadata_iv = decode_b64(metadata_iv_b64, "metadata_iv_base64")
    enc_meta    = decode_b64(enc_meta_b64,    "encrypted_metadata_base64")
    owner_wrapped = decode_b64(owner_wrapped_b64, "owner_wrapped_aes_key_base64")

    if len(content_iv) != IV_LEN:
        raise HTTPException(422, "content_iv phải đúng 12 byte.")
    if len(metadata_iv) != IV_LEN:
        raise HTTPException(422, "metadata_iv phải đúng 12 byte.")
    if content_iv == metadata_iv:
        raise HTTPException(422, "content_iv và metadata_iv phải khác nhau.")
    if len(enc_meta) < 16 or len(enc_meta) > MAX_METADATA_BYTES:
        raise HTTPException(422, "encrypted_metadata nằm ngoài giới hạn cho phép.")
    if len(owner_wrapped) != WRAPPED_AES_KEY_LEN:
        raise HTTPException(
            422,
            f"owner_wrapped_aes_key phải đúng {WRAPPED_AES_KEY_LEN} byte "
            f"(nhận {len(owner_wrapped)} byte).",
        )

    # --- Kiểm tra owner_key_id thuộc user hiện tại và chưa bị revoke ---
    key_row = db.execute(
        text("""
            SELECT id FROM public_keys
            WHERE id = :key_id AND user_id = :user_id AND revoked_at IS NULL
        """),
        {"key_id": owner_key_id, "user_id": user["id"]},
    ).mappings().first()
    if key_row is None:
        raise HTTPException(409, "owner_key_id không hợp lệ hoặc đã bị thu hồi.")

    # --- Kiểm tra file_id chưa tồn tại ---
    exists = db.execute(
        text("SELECT id FROM files WHERE id = :id"),
        {"id": file_id},
    ).mappings().first()
    if exists is not None:
        raise HTTPException(409, "file_id đã tồn tại. Vui lòng dùng UUID mới.")

    # --- Đọc ciphertext ---
    if ciphertext is None:
        raise HTTPException(422, "Thiếu field 'ciphertext' trong multipart.")

    data = await ciphertext.read(MAX_CIPHERTEXT_BYTES + 1)
    if len(data) > MAX_CIPHERTEXT_BYTES:
        raise HTTPException(413, "Ciphertext vượt quá giới hạn 25 MiB + 16 byte tag.")
    if len(data) < MIN_CIPHERTEXT_BYTES:
        raise HTTPException(422, f"Ciphertext phải ít nhất {MIN_CIPHERTEXT_BYTES} byte.")

    ciphertext_hash = hashlib.sha256(data).digest()
    storage_key     = f"{uuid4().hex}_{secrets.token_hex(8)}.bin"
    now             = utc_now()

    # --- Lưu vào storage trước, rồi mới ghi DB ---
    storage_path = _storage_dir() / storage_key
    try:
        storage_path.write_bytes(data)
    except OSError as exc:
        raise HTTPException(500, "Không thể ghi file lên storage.") from exc

    try:
        db.execute(
            text("""
                INSERT INTO files
                    (id, owner_id, storage_key, ciphertext_size, ciphertext_sha256,
                     content_iv, metadata_iv, encrypted_metadata,
                     protocol_version, status, created_at, updated_at)
                VALUES
                    (:id, :owner_id, :storage_key, :size, :sha256,
                     :content_iv, :metadata_iv, :enc_meta,
                     :proto, 'ready', :now, :now)
            """),
            {
                "id":         file_id,
                "owner_id":   user["id"],
                "storage_key": storage_key,
                "size":       len(data),
                "sha256":     ciphertext_hash,
                "content_iv": content_iv,
                "metadata_iv": metadata_iv,
                "enc_meta":   enc_meta,
                "proto":      PROTOCOL_VERSION,
                "now":        now,
            },
        )
        db.execute(
            text("""
                INSERT INTO file_access
                    (file_id, owner_id, user_id, key_id, access_type,
                     wrapped_aes_key, created_at, granted_at)
                VALUES
                    (:file_id, :owner_id, :owner_id, :key_id, 'owner',
                     :wrapped, :now, :now)
            """),
            {
                "file_id":  file_id,
                "owner_id": user["id"],
                "key_id":   owner_key_id,
                "wrapped":  owner_wrapped,
                "now":      now,
            },
        )
        log_audit(
            db,
            actor_id=user["id"],
            action="file.upload",
            file_id=file_id,
            request_id=request_id,
        )
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # Xóa file đã ghi xuống storage nếu DB thất bại
        storage_path.unlink(missing_ok=True)
        raise HTTPException(409, "Không thể lưu tệp do vi phạm ràng buộc dữ liệu.") from exc
    except Exception:
        db.rollback()
        storage_path.unlink(missing_ok=True)
        raise

    return {"id": file_id}


# ══════════════════════════════════════════════════════════════════════════════
# GET /files — Danh sách tệp của tôi
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/files")
def list_files(
    user:      CurrentUser,
    db:        DB,
    page:      int = 1,
    page_size: int = 20,
):
    if page < 1:
        raise HTTPException(422, "page phải >= 1.")
    if not 1 <= page_size <= PAGE_SIZE_MAX:
        raise HTTPException(422, f"page_size phải từ 1 đến {PAGE_SIZE_MAX}.")

    offset = (page - 1) * page_size
    owner  = user["id"]

    total_row = db.execute(
        text("""
            SELECT COUNT(*) AS cnt
            FROM files
            WHERE owner_id = :owner AND status = 'ready'
        """),
        {"owner": owner},
    ).mappings().first()
    total = int(total_row["cnt"]) if total_row else 0

    rows = db.execute(
        text("""
            SELECT f.id, f.content_iv, f.metadata_iv, f.encrypted_metadata,
                   f.protocol_version, f.ciphertext_size,
                   f.created_at, f.updated_at,
                   fa.key_id, fa.wrapped_aes_key,
                   (
                       SELECT COUNT(*)
                       FROM file_access fa2
                       WHERE fa2.file_id = f.id
                         AND fa2.access_type = 'share'
                         AND fa2.revoked_at IS NULL
                         AND EXISTS (
                             SELECT 1 FROM users u
                             WHERE u.id = fa2.user_id AND u.status = 'active'
                         )
                   ) AS share_count
            FROM files f
            JOIN file_access fa
              ON fa.file_id = f.id
             AND fa.user_id = :owner
             AND fa.revoked_at IS NULL
            WHERE f.owner_id = :owner
              AND f.status   = 'ready'
            ORDER BY f.updated_at DESC, f.id ASC
            LIMIT :limit OFFSET :offset
        """),
        {"owner": owner, "limit": page_size, "offset": offset},
    ).mappings().all()

    items = []
    for row in rows:
        item = _file_item(row, row)
        item["share_count"] = int(row["share_count"])
        items.append(item)

    return {"items": items, "page": page, "page_size": page_size, "total": total}


# ══════════════════════════════════════════════════════════════════════════════
# GET /files/shared-with-me — Tệp được chia sẻ với tôi
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/files/shared-with-me")
def shared_with_me(
    user:      CurrentUser,
    db:        DB,
    page:      int = 1,
    page_size: int = 20,
):
    if page < 1:
        raise HTTPException(422, "page phải >= 1.")
    if not 1 <= page_size <= PAGE_SIZE_MAX:
        raise HTTPException(422, f"page_size phải từ 1 đến {PAGE_SIZE_MAX}.")

    offset    = (page - 1) * page_size
    recipient = user["id"]

    total_row = db.execute(
        text("""
            SELECT COUNT(*) AS cnt
            FROM files f
            JOIN file_access fa ON fa.file_id = f.id
            WHERE fa.user_id     = :recipient
              AND fa.access_type = 'share'
              AND fa.revoked_at  IS NULL
              AND f.status       = 'ready'
        """),
        {"recipient": recipient},
    ).mappings().first()
    total = int(total_row["cnt"]) if total_row else 0

    rows = db.execute(
        text("""
            SELECT f.id, f.content_iv, f.metadata_iv, f.encrypted_metadata,
                   f.protocol_version, f.ciphertext_size,
                   f.created_at, f.updated_at,
                   fa.key_id, fa.wrapped_aes_key, fa.granted_at,
                   u.full_name AS shared_by_name,
                   u.email     AS shared_by_email,
                   f.owner_id  AS shared_by_id
            FROM files f
            JOIN file_access fa ON fa.file_id = f.id
            JOIN users u        ON u.id = f.owner_id
            WHERE fa.user_id     = :recipient
              AND fa.access_type = 'share'
              AND fa.revoked_at  IS NULL
              AND f.status       = 'ready'
            ORDER BY fa.granted_at DESC, f.id ASC
            LIMIT :limit OFFSET :offset
        """),
        {"recipient": recipient, "limit": page_size, "offset": offset},
    ).mappings().all()

    items = []
    for row in rows:
        item = _file_item(row, row)
        granted = row["granted_at"]
        item["shared_at"]  = (granted.isoformat() + "Z"
                               if isinstance(granted, datetime) else str(granted) + "Z")
        item["shared_by"]  = {
            "id":        row["shared_by_id"],
            "full_name": row["shared_by_name"],
            "email":     row["shared_by_email"],
        }
        items.append(item)

    return {"items": items, "page": page, "page_size": page_size, "total": total}


# ══════════════════════════════════════════════════════════════════════════════
# GET /files/{id}/envelope — Metadata + wrapped AES key
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/files/{file_id}/envelope")
def get_envelope(file_id: str, user: CurrentUser, db: DB):
    file_id = validate_uuid(file_id, "file_id")

    file_row = db.execute(
        text("""
            SELECT id, content_iv, metadata_iv, encrypted_metadata,
                   protocol_version, ciphertext_size, ciphertext_sha256,
                   created_at, updated_at, status
            FROM files
            WHERE id = :id
        """),
        {"id": file_id},
    ).mappings().first()

    if file_row is None or file_row["status"] != "ready":
        raise HTTPException(404, "Tệp không tồn tại hoặc đã bị xóa.")

    envelope = _get_envelope_row(db, file_id, user["id"])
    if envelope is None:
        raise HTTPException(403, "Bạn không có quyền truy cập tệp này.")

    item = _file_item(file_row, envelope)
    item["ciphertext_sha256"] = bytes(file_row["ciphertext_sha256"]).hex()
    return item


# ══════════════════════════════════════════════════════════════════════════════
# GET /files/{id}/content — Stream ciphertext
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/files/{file_id}/content")
def get_content(
    file_id:    str,
    user:       CurrentUser,
    db:         DB,
    request:    Request,
):
    file_id = validate_uuid(file_id, "file_id")
    request_id = str(uuid4())

    file_row = db.execute(
        text("""
            SELECT id, storage_key, ciphertext_size, status, owner_id
            FROM files
            WHERE id = :id
        """),
        {"id": file_id},
    ).mappings().first()

    if file_row is None or file_row["status"] != "ready":
        raise HTTPException(404, "Tệp không tồn tại hoặc đã bị xóa.")

    envelope = _get_envelope_row(db, file_id, user["id"])
    if envelope is None:
        raise HTTPException(403, "Bạn không có quyền tải tệp này.")

    storage_path = _storage_dir() / file_row["storage_key"]
    if not storage_path.exists():
        raise HTTPException(500, "File bị thiếu trên storage. Liên hệ quản trị viên.")

    log_audit(
        db,
        actor_id=user["id"],
        action="file.download",
        file_id=file_id,
        request_id=request_id,
    )
    db.commit()

    def _iter_file(path: Path, chunk: int = 65536):
        with open(path, "rb") as f:
            while True:
                buf = f.read(chunk)
                if not buf:
                    break
                yield buf

    return StreamingResponse(
        _iter_file(storage_path),
        media_type="application/octet-stream",
        headers={
            "Content-Length":      str(file_row["ciphertext_size"]),
            "Content-Disposition": f'attachment; filename="{file_id}.bin"',
            "Cache-Control":       "no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /files/{id} — Xóa mềm tệp
# ══════════════════════════════════════════════════════════════════════════════

@router.delete("/files/{file_id}", status_code=204)
def delete_file(file_id: str, user: MutatingUser, db: DB):
    file_id    = validate_uuid(file_id, "file_id")
    request_id = str(uuid4())
    now        = utc_now()

    file_row = db.execute(
        text("""
            SELECT id, owner_id, status
            FROM files
            WHERE id = :id
        """),
        {"id": file_id},
    ).mappings().first()

    if file_row is None:
        raise HTTPException(404, "Tệp không tồn tại.")
    if file_row["owner_id"] != user["id"]:
        raise HTTPException(403, "Chỉ chủ tệp mới có thể xóa.")
    if file_row["status"] == "deleted":
        raise HTTPException(404, "Tệp đã bị xóa trước đó.")

    db.execute(
        text("""
            UPDATE files
            SET status = 'deleted', deleted_at = :now, updated_at = :now
            WHERE id = :id
        """),
        {"id": file_id, "now": now},
    )
    log_audit(
        db,
        actor_id=user["id"],
        action="file.delete",
        file_id=file_id,
        request_id=request_id,
    )
    db.commit()

    return Response(status_code=204)


# ══════════════════════════════════════════════════════════════════════════════
# POST /files/{id}/shares — Cấp quyền chia sẻ
# ══════════════════════════════════════════════════════════════════════════════

@router.post("/files/{file_id}/shares", status_code=201)
def share_file(file_id: str, body: ShareBody, user: MutatingUser, db: DB):
    file_id    = validate_uuid(file_id, "file_id")
    request_id = str(uuid4())
    now        = utc_now()

    wrapped_bytes = decode_b64(body.wrapped_aes_key_base64, "wrapped_aes_key_base64")
    if len(wrapped_bytes) != WRAPPED_AES_KEY_LEN:
        raise HTTPException(
            422,
            f"wrapped_aes_key phải đúng {WRAPPED_AES_KEY_LEN} byte "
            f"(nhận {len(wrapped_bytes)} byte).",
        )

    # Khóa dòng file và xác nhận quyền owner
    file_row = db.execute(
        text("""
            SELECT id, owner_id, status
            FROM files
            WHERE id = :id
        """),
        {"id": file_id},
    ).mappings().first()

    if file_row is None or file_row["status"] != "ready":
        raise HTTPException(404, "Tệp không tồn tại hoặc đã bị xóa.")
    if file_row["owner_id"] != user["id"]:
        raise HTTPException(403, "Chỉ chủ tệp mới có thể chia sẻ.")
    if body.recipient_user_id == user["id"]:
        raise HTTPException(422, "Không thể chia sẻ tệp với chính mình.")

    # Kiểm tra người nhận tồn tại và còn active
    recipient = db.execute(
        text("""
            SELECT id FROM users
            WHERE id = :uid AND status = 'active'
        """),
        {"uid": body.recipient_user_id},
    ).mappings().first()
    if recipient is None:
        raise HTTPException(404, "Người nhận không tồn tại hoặc tài khoản bị vô hiệu hóa.")

    # Khóa và xác minh key_id thuộc recipient, còn active, fingerprint khớp
    key_row = db.execute(
        text("""
            SELECT id, fingerprint_sha256
            FROM public_keys
            WHERE id = :key_id AND user_id = :uid AND revoked_at IS NULL
        """),
        {"key_id": body.key_id, "uid": body.recipient_user_id},
    ).mappings().first()
    if key_row is None:
        raise HTTPException(
            409,
            "Khóa của người nhận không hợp lệ, đã bị thu hồi hoặc thay đổi "
            "kể từ khi tra cứu. Hãy tra cứu lại trước khi chia sẻ.",
        )

    stored_fp = bytes(key_row["fingerprint_sha256"]).hex()
    if stored_fp != body.verified_fingerprint_sha256:
        raise HTTPException(
            409,
            "Fingerprint của khóa người nhận không khớp. "
            "Khóa có thể đã thay đổi. Hãy tra cứu lại.",
        )

    # Ghi hoặc cập nhật row chia sẻ (cấp lại sau khi đã revoke)
    existing = db.execute(
        text("""
            SELECT file_id, user_id, revoked_at
            FROM file_access
            WHERE file_id = :file_id AND user_id = :uid
        """),
        {"file_id": file_id, "uid": body.recipient_user_id},
    ).mappings().first()

    if existing is not None and existing["revoked_at"] is None:
        raise HTTPException(409, "Người dùng đã được chia sẻ tệp này rồi.")

    if existing is not None:
        # Cấp lại quyền đã bị thu hồi
        db.execute(
            text("""
                UPDATE file_access
                SET key_id = :key_id, wrapped_aes_key = :wrapped,
                    granted_at = :now, revoked_at = NULL
                WHERE file_id = :file_id AND user_id = :uid
            """),
            {
                "key_id":  body.key_id,
                "wrapped": wrapped_bytes,
                "now":     now,
                "file_id": file_id,
                "uid":     body.recipient_user_id,
            },
        )
    else:
        db.execute(
            text("""
                INSERT INTO file_access
                    (file_id, owner_id, user_id, key_id, access_type,
                     wrapped_aes_key, created_at, granted_at)
                VALUES
                    (:file_id, :owner_id, :uid, :key_id, 'share',
                     :wrapped, :now, :now)
            """),
            {
                "file_id":  file_id,
                "owner_id": user["id"],
                "uid":      body.recipient_user_id,
                "key_id":   body.key_id,
                "wrapped":  wrapped_bytes,
                "now":      now,
            },
        )

    log_audit(
        db,
        actor_id=user["id"],
        action="file.share",
        file_id=file_id,
        target_user_id=body.recipient_user_id,
        request_id=request_id,
    )
    db.commit()

    return {"status": "ok"}


# ══════════════════════════════════════════════════════════════════════════════
# GET /files/{id}/shares — Danh sách người được chia sẻ
# ══════════════════════════════════════════════════════════════════════════════

@router.get("/files/{file_id}/shares")
def list_shares(file_id: str, user: CurrentUser, db: DB):
    file_id = validate_uuid(file_id, "file_id")

    file_row = db.execute(
        text("""
            SELECT id, owner_id, status
            FROM files
            WHERE id = :id
        """),
        {"id": file_id},
    ).mappings().first()

    if file_row is None or file_row["status"] != "ready":
        raise HTTPException(404, "Tệp không tồn tại hoặc đã bị xóa.")
    if file_row["owner_id"] != user["id"]:
        raise HTTPException(403, "Chỉ chủ tệp mới có thể xem danh sách chia sẻ.")

    rows = db.execute(
        text("""
            SELECT fa.user_id, fa.key_id, fa.granted_at,
                   u.full_name, u.email
            FROM file_access fa
            JOIN users u ON u.id = fa.user_id
            WHERE fa.file_id     = :file_id
              AND fa.access_type = 'share'
              AND fa.revoked_at  IS NULL
              AND u.status       = 'active'
            ORDER BY fa.granted_at DESC
        """),
        {"file_id": file_id},
    ).mappings().all()

    recipients = []
    for r in rows:
        granted = r["granted_at"]
        recipients.append({
            "user_id":    r["user_id"],
            "full_name":  r["full_name"],
            "email":      r["email"],
            "key_id":     r["key_id"],
            "granted_at": (granted.isoformat() + "Z"
                           if isinstance(granted, datetime) else str(granted) + "Z"),
        })

    return {"file_id": file_id, "recipients": recipients}


# ══════════════════════════════════════════════════════════════════════════════
# DELETE /files/{id}/shares/{user_id} — Thu hồi quyền
# ══════════════════════════════════════════════════════════════════════════════

@router.delete("/files/{file_id}/shares/{target_user_id}", status_code=204)
def revoke_share(
    file_id:        str,
    target_user_id: str,
    user:           MutatingUser,
    db:             DB,
):
    file_id        = validate_uuid(file_id, "file_id")
    target_user_id = validate_uuid(target_user_id, "target_user_id")
    request_id     = str(uuid4())
    now            = utc_now()

    if target_user_id == user["id"]:
        raise HTTPException(422, "Không thể thu hồi quyền của chính mình (owner không thể revoke).")

    file_row = db.execute(
        text("""
            SELECT id, owner_id, status
            FROM files
            WHERE id = :id
        """),
        {"id": file_id},
    ).mappings().first()

    if file_row is None or file_row["status"] != "ready":
        raise HTTPException(404, "Tệp không tồn tại hoặc đã bị xóa.")
    if file_row["owner_id"] != user["id"]:
        raise HTTPException(403, "Chỉ chủ tệp mới có thể thu hồi quyền chia sẻ.")

    result = db.execute(
        text("""
            UPDATE file_access
            SET revoked_at = :now
            WHERE file_id     = :file_id
              AND user_id     = :target
              AND access_type = 'share'
              AND revoked_at  IS NULL
        """),
        {"now": now, "file_id": file_id, "target": target_user_id},
    )
    if result.rowcount == 0:
        raise HTTPException(404, "Người dùng không có quyền truy cập tệp này hoặc đã bị thu hồi.")

    log_audit(
        db,
        actor_id=user["id"],
        action="file.revoke",
        file_id=file_id,
        target_user_id=target_user_id,
        request_id=request_id,
    )
    db.commit()

    return Response(status_code=204)
