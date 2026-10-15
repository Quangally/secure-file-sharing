-- Chay sau 01_schema.sql va 02_demo.sql trong MySQL Workbench.
-- File nay CHI DOC. Day la bien demo, backend phai thay bang parameter binding.
USE secure_share;
SET SESSION time_zone = '+00:00';
SET @current_user_id = '10000000-0000-4000-8000-000000000001'; -- An
SET @file_id = '30000000-0000-4000-8000-000000000001';
SET @recipient_email = 'minhanh@example.test';

-- name: profile
SELECT id, full_name, email, status, created_at
FROM users WHERE id = @current_user_id AND status = 'active';

-- name: my_files
-- share_count la du lieu tinh toan, khong tao cot dem co the bi lech.
-- Ten, MIME, size goc: client giai ma encrypted_metadata bang owner envelope.
SELECT f.id, f.ciphertext_size, f.created_at, f.updated_at,
       f.content_iv, f.metadata_iv, f.encrypted_metadata, f.protocol_version,
       own.key_id, own.wrapped_aes_key,
       (SELECT COUNT(*) FROM file_access AS s
        JOIN users AS recipient ON recipient.id = s.user_id AND recipient.status = 'active'
        WHERE s.file_id = f.id AND s.access_type = 'share' AND s.revoked_at IS NULL
       ) AS share_count
FROM files AS f
JOIN file_access AS own ON own.file_id = f.id AND own.user_id = f.owner_id
    AND own.access_type = 'owner' AND own.revoked_at IS NULL
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
WHERE f.owner_id = @current_user_id AND f.status = 'ready'
ORDER BY f.updated_at DESC, f.id;

-- name: shared_with_me
SELECT f.id, owner_user.full_name AS shared_by, a.granted_at AS shared_at,
       f.content_iv, f.metadata_iv, f.encrypted_metadata, f.ciphertext_size,
       f.protocol_version, a.key_id, a.wrapped_aes_key
FROM file_access AS a
JOIN files AS f ON f.id = a.file_id AND f.status = 'ready'
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
JOIN users AS recipient ON recipient.id = a.user_id AND recipient.status = 'active'
WHERE a.user_id = @current_user_id AND a.access_type = 'share' AND a.revoked_at IS NULL
ORDER BY a.granted_at DESC, f.id;

-- name: recipient_lookup
-- Chi tra user da dang ky + public key con hieu luc. UI nen nhap email, khong nhap '1'.
SELECT u.id AS recipient_user_id, u.full_name, u.email,
       k.id AS key_id, k.public_key_jwk, LOWER(HEX(k.fingerprint_sha256)) AS fingerprint_sha256
FROM users AS u
JOIN public_keys AS k ON k.user_id = u.id AND k.revoked_at IS NULL
WHERE u.email = @recipient_email AND u.status = 'active' AND u.id <> @current_user_id;

-- name: authorized_download
-- Dung cung dieu kien nay cho content VA envelope/metadata; khong chi kiem tra tren UI.
-- Khong tra storage_key noi bo len browser; backend doc stream sau khi kiem tra quyen.
SELECT f.id, f.owner_id, f.storage_key, f.ciphertext_size, f.ciphertext_sha256,
       f.content_iv, f.metadata_iv, f.encrypted_metadata, f.protocol_version,
       a.key_id, a.wrapped_aes_key
FROM files AS f
JOIN file_access AS a ON a.file_id = f.id AND a.user_id = @current_user_id
    AND a.revoked_at IS NULL
JOIN users AS viewer_user ON viewer_user.id = a.user_id AND viewer_user.status = 'active'
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
WHERE f.id = @file_id AND f.status = 'ready';

-- name: share_recipients
-- Chi chu tep duoc xem danh sach nguoi nhan de thu hoi.
SELECT a.user_id, recipient.full_name, recipient.email, a.granted_at, a.key_id
FROM files AS f
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
JOIN file_access AS a ON a.file_id = f.id AND a.access_type = 'share' AND a.revoked_at IS NULL
JOIN users AS recipient ON recipient.id = a.user_id AND recipient.status = 'active'
WHERE f.id = @file_id AND f.owner_id = @current_user_id AND f.status = 'ready'
ORDER BY a.granted_at DESC, a.user_id;

-- name: integrity_report
-- Ket qua mong doi: 0 dong. Backend bat buoc tao tep va owner envelope trong cung transaction.
SELECT f.id AS ready_file_without_owner_envelope
FROM files AS f
LEFT JOIN file_access AS own ON own.file_id = f.id AND own.user_id = f.owner_id
    AND own.access_type = 'owner' AND own.revoked_at IS NULL
WHERE f.status = 'ready' AND own.file_id IS NULL;
