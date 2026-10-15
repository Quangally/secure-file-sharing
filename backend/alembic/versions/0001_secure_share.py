"""Initial six-table schema. Canonical SQL also opens directly in Workbench."""
from pathlib import Path
import re
from alembic import op, context
import sqlalchemy as sa

revision = "0001_secure_share"
down_revision = None
branch_labels = None
depends_on = None
TABLES = ("users", "auth_sessions", "public_keys", "files", "file_access", "audit_logs")


def schema_statements():
    # Schema has no semicolons inside SQL strings. Strip whole comment lines only:
    # never remove '--' that can appear in string data/JWKs in future scripts.
    path = Path(__file__).resolve().parents[3] / "database" / "01_schema.sql"
    source = "\n".join(line for line in path.read_text(encoding="utf-8").splitlines()
                       if not line.lstrip().startswith("--"))
    statements = [s.strip() for s in source.split(";") if s.strip()]
    tables = [s for s in statements if re.match(r"CREATE\s+TABLE\s+", s, re.I)]
    found = tuple(re.match(r"CREATE\s+TABLE\s+(\w+)", s, re.I)[1] for s in tables)
    if found != TABLES:
        raise RuntimeError("Initial SQL and migration tables disagree.")
    return tables


def upgrade():
    if not context.is_offline_mode():
        existing = set(sa.inspect(op.get_bind()).get_table_names())
        if existing.intersection(TABLES):
            raise RuntimeError("Application tables already exist. Compare the schema before stamping; do not overwrite them.")
    for statement in schema_statements():
        op.execute(sa.text(statement))


def downgrade():
    # Explicit Alembic downgrade only; never invoked by app startup.
    for name in reversed(TABLES):
        op.drop_table(name)
