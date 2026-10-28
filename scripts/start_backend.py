"""Local development launcher: configure MySQL once, then start with one command."""

import argparse
import getpass
import os
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def configure_database(env_file, previous_url, *, input_fn=input, password_fn=None):
    from dotenv import set_key
    from sqlalchemy.engine import URL, make_url

    # Preserve a custom host/database when only changing the local password.
    previous = make_url(previous_url) if previous_url else URL.create(
        "mysql+pymysql", username="root", host="127.0.0.1", port=3306,
        database="secure_share", query={"charset": "utf8mb4"},
    )
    default_user = previous.username or "root"
    username = input_fn(f"MySQL user [{default_user}]: ").strip() or default_user
    read_password = password_fn or getpass.getpass
    password = read_password("Mat khau MySQL (khong hien khi go): ")
    if not password:
        raise ValueError("Mat khau MySQL khong duoc de trong.")
    value = previous.set(username=username, password=password).render_as_string(hide_password=False)
    # set_key preserves unrelated settings and quotes the percent-encoded URL.
    set_key(env_file, "DATABASE_URL", value, quote_mode="always")
    if os.name != "nt":
        env_file.chmod(0o600)
    print("Da luu cau hinh vao .env tren may nay. Khong dua file nay len GitHub.")


def load_configuration(env_file, *, configure=False):
    from dotenv import dotenv_values, load_dotenv
    from sqlalchemy.engine import make_url
    from sqlalchemy.exc import ArgumentError

    value = dotenv_values(env_file, interpolate=False).get("DATABASE_URL") if env_file.exists() else None
    previous_url = None
    if value:
        try:
            parsed = make_url(value)
            if parsed.drivername != "mysql+pymysql" or not parsed.database:
                raise ValueError()
            # Accessing port validates it without including the URL in errors.
            parsed.port
            previous_url = value
        except (ValueError, ArgumentError):
            # Do not echo a connection string or an exception containing it.
            if not configure:
                raise ValueError("DATABASE_URL trong .env khong hop le. Chay lai voi --configure.") from None
    if configure or not previous_url or "replace_with_" in previous_url:
        configure_database(env_file, previous_url)
    # This explicit local launcher uses .env even if this terminal still has an
    # old DATABASE_URL. Other ways of launching the backend remain unchanged.
    load_dotenv(env_file, override=True, interpolate=False)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--configure", action="store_true", help="Nhap lai tai khoan/mat khau MySQL.")
    args = parser.parse_args(argv)
    os.chdir(PROJECT_ROOT)
    sys.path.insert(0, str(PROJECT_ROOT / "backend"))
    try:
        load_configuration(PROJECT_ROOT / ".env", configure=args.configure)
        from sqlalchemy import text
        from sqlalchemy.exc import SQLAlchemyError
        import uvicorn
        from app.database.session import get_engine
    except ImportError:
        print("Thieu thu vien. Cai bang Python cua venv: -m pip install -r backend/requirements.txt", file=sys.stderr)
        return 1
    except (ValueError, OSError) as exc:
        # ValueError messages above are authored locally; OS errors may include
        # user paths, so report only a generic file-access message for those.
        print(str(exc) if isinstance(exc, ValueError) else "Khong doc/ghi duoc .env. Kiem tra quyen thu muc.", file=sys.stderr)
        return 1

    try:
        engine = get_engine()
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        engine.dispose()
    except (SQLAlchemyError, RuntimeError, OSError) as exc:
        original_args = getattr(getattr(exc, "orig", None), "args", ())
        code = original_args[0] if original_args else None
        suffix = f" (ma MySQL {code})" if isinstance(code, int) else ""
        print(f"Khong ket noi duoc MySQL{suffix}. Kiem tra server va database trong .env.", file=sys.stderr)
        hints = {
            1045: "Tai khoan hoac mat khau MySQL chua dung.",
            1049: "Database chua ton tai. Tao schema theo docs/database/mysql-setup.md.",
            2003: "MySQL chua chay hoac host/port chua dung.",
        }
        if code in hints:
            print(hints[code], file=sys.stderr)
        print("Neu doi mat khau, chay lai: .\\start-backend.cmd --configure", file=sys.stderr)
        return 1

    print("Da ket noi MySQL. Backend: http://127.0.0.1:8000", flush=True)
    uvicorn.run("app.main:app", app_dir=str(PROJECT_ROOT / "backend"),
                host="127.0.0.1", port=8000, reload=True,
                reload_dirs=[str(PROJECT_ROOT / "backend")])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (KeyboardInterrupt, EOFError):
        print("\nDa dung.")
        raise SystemExit(130)
