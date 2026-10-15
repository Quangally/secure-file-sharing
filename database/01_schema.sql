-- Secure Share v1 | MySQL 8.4 / InnoDB / utf8mb4
-- Chay tren database moi. Script khong DROP, TRUNCATE hay xoa du lieu cu.
-- Khong chay voi MariaDB/XAMPP. Moi ket noi backend phai dung UTC va strict mode.
SET NAMES utf8mb4;
SET SESSION time_zone = '+00:00';
SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION';

CREATE DATABASE IF NOT EXISTS secure_share
    CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE secure_share;

-- UUID do ung dung sinh; viet thuong, cung charset/collation cho moi PK/FK.
CREATE TABLE users (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(254) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    password_hash VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    status ENUM('active', 'disabled') NOT NULL DEFAULT 'active',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    last_login_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_email (email),
    CONSTRAINT ck_users_name CHECK (CHAR_LENGTH(TRIM(full_name)) BETWEEN 1 AND 100),
    CONSTRAINT ck_users_email CHECK (email = TRIM(email) AND LOCATE('@', email) > 1),
    CONSTRAINT ck_users_password_hash CHECK (LEFT(password_hash, 10) = '$argon2id$')
) ENGINE=InnoDB;

-- Opaque session token: chi luu SHA-256 cua token ngau nhien, khong luu token ro.
CREATE TABLE auth_sessions (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    token_hash BINARY(32) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at DATETIME(6) NOT NULL,
    revoked_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sessions_token_hash (token_hash),
    KEY ix_sessions_user_expiry (user_id, expires_at),
    CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT ck_sessions_expiry CHECK (expires_at > created_at),
    CONSTRAINT ck_sessions_revoked CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) ENGINE=InnoDB;

-- Chi PUBLIC JWK. API phai kiem tra RSA 2048, e=65537 va tinh fingerprint tu SPKI DER.
CREATE TABLE public_keys (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    public_key_jwk JSON NOT NULL,
    fingerprint_sha256 BINARY(32) NOT NULL,
    rsa_bits SMALLINT UNSIGNED NOT NULL DEFAULT 2048,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_at DATETIME(6) NULL,
    -- UNIQUE cho phep nhieu NULL: moi user chi co mot key chua bi revoke.
    active_slot TINYINT GENERATED ALWAYS AS
        (CASE WHEN revoked_at IS NULL THEN 1 ELSE NULL END) STORED,
    PRIMARY KEY (id),
    UNIQUE KEY uq_public_keys_id_user (id, user_id),
    UNIQUE KEY uq_public_keys_fingerprint (fingerprint_sha256),
    UNIQUE KEY uq_public_keys_one_active (user_id, active_slot),
    CONSTRAINT fk_public_keys_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT ck_public_keys_bits CHECK (rsa_bits = 2048),
    CONSTRAINT ck_public_keys_json CHECK (
        JSON_TYPE(public_key_jwk) = 'OBJECT'
        AND JSON_CONTAINS_PATH(public_key_jwk, 'all', '$.kty', '$.n', '$.e') = 1
        AND JSON_UNQUOTE(JSON_EXTRACT(public_key_jwk, '$.kty')) = 'RSA'
        AND JSON_TYPE(JSON_EXTRACT(public_key_jwk, '$.n')) = 'STRING'
        AND JSON_TYPE(JSON_EXTRACT(public_key_jwk, '$.e')) = 'STRING'
        AND JSON_CONTAINS_PATH(public_key_jwk, 'one',
            '$.d', '$.p', '$.q', '$.dp', '$.dq', '$.qi', '$.oth') = 0
    ),
    CONSTRAINT ck_public_keys_revoked CHECK (revoked_at IS NULL OR revoked_at >= created_at)
) ENGINE=InnoDB;

-- Noi dung tep nam trong storage, DB chi giu storage_key va metadata da ma hoa.
-- encrypted_metadata = AES-GCM(UTF8(JSON{name,mimeType,size})); ket qua gom C || tag.
CREATE TABLE files (
    id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    storage_key VARCHAR(160) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    ciphertext_size BIGINT UNSIGNED NOT NULL,
    ciphertext_sha256 BINARY(32) NOT NULL,
    content_iv VARBINARY(12) NOT NULL,
    metadata_iv VARBINARY(12) NOT NULL,
    encrypted_metadata VARBINARY(4096) NOT NULL,
    protocol_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    status ENUM('uploading', 'ready', 'deleted') NOT NULL DEFAULT 'uploading',
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    deleted_at DATETIME(6) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_files_storage_key (storage_key),
    UNIQUE KEY uq_files_id_owner (id, owner_id),
    KEY ix_files_owner_status_updated (owner_id, status, updated_at),
    CONSTRAINT fk_files_owner FOREIGN KEY (owner_id) REFERENCES users(id),
    CONSTRAINT ck_files_ciphertext_size CHECK (ciphertext_size >= 16),
    CONSTRAINT ck_files_content_iv CHECK (OCTET_LENGTH(content_iv) = 12),
    CONSTRAINT ck_files_metadata_iv CHECK (OCTET_LENGTH(metadata_iv) = 12),
    CONSTRAINT ck_files_distinct_iv CHECK (content_iv <> metadata_iv),
    CONSTRAINT ck_files_metadata CHECK (OCTET_LENGTH(encrypted_metadata) >= 16),
    CONSTRAINT ck_files_protocol CHECK (protocol_version = 1),
    CONSTRAINT ck_files_deleted CHECK (
        (status = 'deleted' AND deleted_at IS NOT NULL)
        OR (status <> 'deleted' AND deleted_at IS NULL)
    )
) ENGINE=InnoDB;

-- Mot envelope cho moi cap (file,user), bao gom chinh chu tep.
-- owner_id lap lai co chu dich de FK/CHECK rang buoc owner/share dung chu tep.
CREATE TABLE file_access (
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    key_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    access_type ENUM('owner', 'share') NOT NULL,
    wrapped_aes_key VARBINARY(256) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    granted_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    revoked_at DATETIME(6) NULL,
    PRIMARY KEY (file_id, user_id),
    KEY ix_access_recipient_active (user_id, revoked_at, file_id),
    KEY ix_access_file_owner (file_id, owner_id),
    KEY ix_access_key_user (key_id, user_id),
    CONSTRAINT fk_access_file_owner FOREIGN KEY (file_id, owner_id)
        REFERENCES files(id, owner_id),
    CONSTRAINT fk_access_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_access_key_user FOREIGN KEY (key_id, user_id)
        REFERENCES public_keys(id, user_id),
    CONSTRAINT ck_access_envelope_size CHECK (OCTET_LENGTH(wrapped_aes_key) = 256),
    CONSTRAINT ck_access_role CHECK (
        (access_type = 'owner' AND user_id = owner_id AND revoked_at IS NULL)
        OR (access_type = 'share' AND user_id <> owner_id)
    ),
    CONSTRAINT ck_access_revoked CHECK (revoked_at IS NULL OR revoked_at >= granted_at)
) ENGINE=InnoDB;

-- Khong log noi dung tep, ten tep goc, mat khau, token, private key, AES key hay envelope.
CREATE TABLE audit_logs (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    file_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    target_user_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
    action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    outcome ENUM('success', 'denied', 'error') NOT NULL DEFAULT 'success',
    request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    occurred_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY ix_audit_actor_time (actor_id, occurred_at),
    KEY ix_audit_file_time (file_id, occurred_at),
    KEY ix_audit_request (request_id),
    KEY ix_audit_target (target_user_id),
    CONSTRAINT fk_audit_actor FOREIGN KEY (actor_id) REFERENCES users(id),
    CONSTRAINT fk_audit_file FOREIGN KEY (file_id) REFERENCES files(id),
    CONSTRAINT fk_audit_target FOREIGN KEY (target_user_id) REFERENCES users(id),
    CONSTRAINT ck_audit_action CHECK (action IN (
        'user.register', 'auth.login', 'auth.logout', 'key.register', 'key.revoke',
        'file.upload', 'file.download', 'file.share', 'file.revoke', 'file.delete'
    ))
) ENGINE=InnoDB;

-- FK mac dinh RESTRICT/NO ACTION: xoa mem tep, vo hieu hoa user de giu lich su.
-- Khong tao cot private_key, raw_aes_key, original_name hay confirm_password.
