"""MySQL migrations; never import the app or create tables during startup."""
import os
from alembic import context
from sqlalchemy import create_engine, pool
from sqlalchemy.engine import make_url


def database_url():
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("Set DATABASE_URL to a mysql+pymysql URL before running Alembic.")
    url = make_url(value)
    if url.drivername != "mysql+pymysql" or not url.database:
        raise RuntimeError("DATABASE_URL must select a MySQL database using mysql+pymysql.")
    return url


def offline():
    context.configure(url=database_url(), literal_binds=True, dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def online():
    engine = create_engine(database_url(), poolclass=pool.NullPool, hide_parameters=True)
    with engine.connect() as connection:
        version = str(connection.exec_driver_sql("SELECT VERSION()").scalar_one())
        if not version.startswith("8.4.") or "MariaDB" in version:
            raise RuntimeError("This schema targets MySQL 8.4; verify your server version.")
        connection.exec_driver_sql("SET SESSION time_zone = '+00:00'")
        connection.exec_driver_sql("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")
        connection.commit()
        context.configure(connection=connection, target_metadata=None)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


offline() if context.is_offline_mode() else online()
