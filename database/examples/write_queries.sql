-- MySQL 8.4: mau cau lenh CHO BACKEND. %(...)s la placeholder PyMySQL,
-- KHONG bam Execute toan bo file nay trong Workbench. Khong noi chuoi SQL.
-- current_user_id phai lay tu session da xac thuc, khong lay tu request body.

-- name: session_lookup
SELECT s.id AS session_id, u.id AS user_id, u.full_name, u.email
FROM auth_sessions AS s
JOIN users AS u ON u.id = s.user_id AND u.status = 'active'
WHERE s.token_hash = %(token_hash)s AND s.revoked_at IS NULL
  AND s.expires_at > UTC_TIMESTAMP(6);

-- name: logout
UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP(6)
WHERE id = %(session_id)s AND user_id = %(current_user_id)s AND revoked_at IS NULL;

-- name: lock_owned_file
-- Buoc dau cua share/revoke/delete: SELECT FOR UPDATE trong transaction.
SELECT f.id, f.owner_id FROM files AS f
JOIN users AS u ON u.id = f.owner_id AND u.status = 'active'
WHERE f.id = %(file_id)s AND f.owner_id = %(current_user_id)s AND f.status = 'ready'
FOR UPDATE;

-- name: lock_recipient_key
-- Chi tiep tuc neu fingerprint khop gia tri client da xac minh qua kenh doc lap.
SELECT k.id, k.user_id FROM public_keys AS k
JOIN users AS u ON u.id = k.user_id AND u.status = 'active'
WHERE k.id = %(key_id)s AND k.user_id = %(recipient_user_id)s
  AND k.fingerprint_sha256 = %(verified_fingerprint)s AND k.revoked_at IS NULL
FOR SHARE;

-- name: grant_access
-- Sau hai lock tren. Moi lan share lai phai wrap lai cho key hien tai.
-- Neu da co (file,user), backend chay regrant_access thay vi INSERT IGNORE/REPLACE.
INSERT INTO file_access
    (file_id, owner_id, user_id, key_id, access_type, wrapped_aes_key)
SELECT f.id, f.owner_id, k.user_id, k.id, 'share', %(wrapped_aes_key)s
FROM files AS f
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
JOIN public_keys AS k ON k.id = %(key_id)s AND k.user_id = %(recipient_user_id)s
    AND k.revoked_at IS NULL AND k.fingerprint_sha256 = %(verified_fingerprint)s
JOIN users AS recipient ON recipient.id = k.user_id AND recipient.status = 'active'
WHERE f.id = %(file_id)s AND f.owner_id = %(current_user_id)s
    AND f.status = 'ready' AND k.user_id <> f.owner_id;

-- name: regrant_access
UPDATE file_access AS a
JOIN files AS f ON f.id = a.file_id
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
JOIN public_keys AS k ON k.id = %(key_id)s AND k.user_id = a.user_id
    AND k.revoked_at IS NULL AND k.fingerprint_sha256 = %(verified_fingerprint)s
JOIN users AS recipient ON recipient.id = a.user_id AND recipient.status = 'active'
SET a.key_id = k.id, a.wrapped_aes_key = %(wrapped_aes_key)s,
    a.granted_at = UTC_TIMESTAMP(6), a.revoked_at = NULL
WHERE f.id = %(file_id)s AND f.owner_id = %(current_user_id)s AND f.status = 'ready'
    AND a.user_id = %(recipient_user_id)s AND a.access_type = 'share';

-- name: revoke_access
UPDATE file_access AS a
JOIN files AS f ON f.id = a.file_id
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
SET a.revoked_at = UTC_TIMESTAMP(6)
WHERE f.id = %(file_id)s AND f.owner_id = %(current_user_id)s AND f.status = 'ready'
    AND a.user_id = %(recipient_user_id)s AND a.access_type = 'share'
    AND a.revoked_at IS NULL;

-- name: soft_delete_file
UPDATE files AS f
JOIN users AS owner_user ON owner_user.id = f.owner_id AND owner_user.status = 'active'
SET f.status = 'deleted', f.deleted_at = UTC_TIMESTAMP(6)
WHERE f.id = %(file_id)s AND f.owner_id = %(current_user_id)s AND f.status = 'ready';

-- name: append_audit
INSERT INTO audit_logs (actor_id, file_id, target_user_id, action, outcome, request_id)
VALUES (%(current_user_id)s, %(file_id)s, %(recipient_user_id)s,
        %(action)s, %(outcome)s, %(request_id)s);

-- Share/regrant/revoke/delete thanh cong: ghi audit truoc COMMIT, neu loi ROLLBACK.
-- Truy van bi tu choi: ghi log o transaction rieng sau ROLLBACK neu can.
-- Upload: ghi ciphertext vao storage tam -> transaction insert files(status=uploading)
-- + insert owner file_access -> chuyen storage object sang ten cuoi -> update ready
-- + audit -> COMMIT. That bai: ROLLBACK, don tep tam/orphan bang job idempotent.
-- SQL khong tu ghi/xoa file trong storage; backend phai xu ly buoc nay.
