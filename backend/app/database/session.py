"""Lazy SQLAlchemy connection factory for Phuc/Vu; no implicit schema changes."""
from contextlib import contextmanager
from functools import lru_cache
import os
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


@lru_cache(maxsize=1)
def get_engine():
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("DATABASE_URL is required for database operations.")
    url = make_url(value)
    if url.drivername != "mysql+pymysql" or not url.database:
        raise RuntimeError("Use mysql+pymysql and select a database.")
    engine = create_engine(url, pool_pre_ping=True, hide_parameters=True)

    @event.listens_for(engine, "connect")
    def configure_connection(dbapi_connection, _):
        with dbapi_connection.cursor() as cursor:
            cursor.execute("SET SESSION time_zone = '+00:00'")
            cursor.execute("SET SESSION sql_mode = 'STRICT_TRANS_TABLES,NO_ZERO_IN_DATE,NO_ZERO_DATE,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'")

    return engine


@contextmanager
def session_scope():
    with Session(get_engine()) as session:
        with session.begin():
            yield session


def get_session():
    """Request-scoped session; routes own their transaction boundaries."""
    with Session(get_engine()) as session:
        yield session
