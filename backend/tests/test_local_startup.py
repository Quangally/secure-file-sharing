"""Exercise local configuration without real passwords or the user's .env."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys

from dotenv import dotenv_values
import pytest
from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.exc import OperationalError

PROJECT_ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("local_launcher", PROJECT_ROOT / "scripts/start_backend.py")
launcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(launcher)


def test_configure_preserves_settings_and_encodes_password(tmp_path, capsys):
    env_file = tmp_path / ".env"
    env_file.write_text("COOKIE_SECURE=false\nALLOWED_ORIGINS=http://127.0.0.1:5173\n")
    password = "test-only @:#/$%\\'漢字"
    launcher.configure_database(
        env_file, "mysql+pymysql://app@127.0.0.1:3307/custom_db?charset=utf8mb4",
        input_fn=lambda prompt: "demo user", password_fn=lambda prompt: password,
    )
    values = dotenv_values(env_file, interpolate=False)
    url = make_url(values["DATABASE_URL"])
    assert (url.username, url.password) == ("demo user", password)
    assert (url.host, url.port, url.database) == ("127.0.0.1", 3307, "custom_db")
    assert values["COOKIE_SECURE"] == "false"
    assert values["ALLOWED_ORIGINS"] == "http://127.0.0.1:5173"
    output = capsys.readouterr()
    assert password not in output.out + output.err
    assert values["DATABASE_URL"] not in output.out + output.err
    if os.name != "nt":
        assert stat.S_IMODE(env_file.stat().st_mode) == 0o600


def test_initial_setup_is_saved_and_reused_without_prompting(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    real_configure = launcher.configure_database
    calls = []

    def configure(path, previous):
        calls.append(path)
        real_configure(path, previous, input_fn=lambda prompt: "root",
                       password_fn=lambda prompt: "test-only-password")

    monkeypatch.setattr(launcher, "configure_database", configure)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    launcher.load_configuration(env_file)
    before = env_file.read_bytes()
    # A stale variable left over in PowerShell must not override this file.
    monkeypatch.setenv("DATABASE_URL", "mysql+pymysql://wrong@localhost/wrong")
    launcher.load_configuration(env_file)
    assert len(calls) == 1
    assert env_file.read_bytes() == before
    assert make_url(os.environ["DATABASE_URL"]).password == "test-only-password"


def test_env_values_are_not_interpolated(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    value = "mysql+pymysql://root:literal${UNRELATED}@127.0.0.1/secure_share"
    env_file.write_text(f"DATABASE_URL='{value}'\n")
    monkeypatch.setenv("UNRELATED", "do-not-substitute")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    launcher.load_configuration(env_file)
    assert os.environ["DATABASE_URL"] == value


def test_configure_updates_password_without_erasing_other_settings(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text("DATABASE_URL=mysql+pymysql://app:old@127.0.0.1:3307/test_db\nCOOKIE_SECURE=false\n")
    real_configure = launcher.configure_database
    monkeypatch.setattr(launcher, "configure_database", lambda path, previous: real_configure(
        path, previous, input_fn=lambda prompt: "", password_fn=lambda prompt: "new-test-password",
    ))
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("COOKIE_SECURE", raising=False)
    launcher.load_configuration(env_file, configure=True)
    url = make_url(os.environ["DATABASE_URL"])
    assert (url.username, url.password, url.port, url.database) == ("app", "new-test-password", 3307, "test_db")
    assert dotenv_values(env_file)["COOKIE_SECURE"] == "false"


def test_malformed_config_reports_no_credentials(tmp_path, monkeypatch, capsys):
    secret = "test-only-secret"
    (tmp_path / ".env").write_text(f"DATABASE_URL=mysql+pymysql://root:{secret}@localhost:invalid/db\n")
    monkeypatch.setattr(launcher, "PROJECT_ROOT", tmp_path)
    monkeypatch.chdir(tmp_path)
    assert launcher.main([]) == 1
    output = capsys.readouterr()
    assert "--configure" in output.err
    assert secret not in output.out + output.err


def test_main_checks_database_then_starts_server_from_project_root(tmp_path, monkeypatch, capsys):
    import app.database.session as database
    import uvicorn

    (tmp_path / ".env").write_text("DATABASE_URL=mysql+pymysql://app:test-only@127.0.0.1/secure_share\n")
    (tmp_path / "elsewhere").mkdir()
    monkeypatch.setattr(launcher, "PROJECT_ROOT", tmp_path)
    monkeypatch.chdir(tmp_path / "elsewhere")
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.setattr(database, "get_engine", lambda: create_engine("sqlite+pysqlite://"))
    started = []
    monkeypatch.setattr(uvicorn, "run", lambda app, **options: started.append((app, options)))
    assert launcher.main([]) == 0
    assert Path.cwd() == tmp_path
    assert started[0][0] == "app.main:app"
    assert started[0][1]["host"] == "127.0.0.1"
    assert started[0][1]["app_dir"] == str(tmp_path / "backend")
    assert "test-only" not in capsys.readouterr().out


def test_failed_database_check_never_starts_server_or_exposes_password(tmp_path, monkeypatch, capsys):
    import app.database.session as database
    import uvicorn

    secret = "test-only-password"
    (tmp_path / ".env").write_text(f"DATABASE_URL=mysql+pymysql://root:{secret}@127.0.0.1/secure_share\n")
    monkeypatch.setattr(launcher, "PROJECT_ROOT", tmp_path)
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("DATABASE_URL", raising=False)

    def fail():
        raise OperationalError("", {}, Exception(1045, secret))

    monkeypatch.setattr(database, "get_engine", fail)
    monkeypatch.setattr(uvicorn, "run", lambda *args, **kwargs: pytest.fail("Must not start with failed DB connection"))
    assert launcher.main([]) == 1
    output = capsys.readouterr()
    assert "1045" in output.err
    assert secret not in output.out + output.err


@pytest.mark.skipif(os.name != "nt", reason="Windows cmd launcher")
@pytest.mark.parametrize("venv_dir", [".venv", "backend/.venv"])
def test_windows_cmd_uses_venv_and_forwards_arguments(tmp_path, venv_dir):
    project = tmp_path / "project with spaces"
    (project / "scripts").mkdir(parents=True)
    shutil.copyfile(PROJECT_ROOT / "start-backend.cmd", project / "start-backend.cmd")
    (project / "scripts/start_backend.py").write_text(
        "import json,sys\nprint(json.dumps({'args':sys.argv[1:],'python':sys.executable}))\n"
    )
    subprocess.run([sys.executable, "-m", "venv", "--without-pip", str(project / venv_dir)], check=True)
    result = subprocess.run(["cmd.exe", "/d", "/c", "start-backend.cmd", "--configure"],
                            cwd=project, capture_output=True, text=True, check=True)
    output = json.loads(result.stdout)
    assert output["args"] == ["--configure"]
    assert Path(output["python"]).resolve() == (project / venv_dir / "Scripts/python.exe").resolve()
