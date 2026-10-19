"""conftest.py — Thêm thư mục backend vào sys.path để pytest tìm được package app."""
import sys
from pathlib import Path

# Thêm thư mục chứa package `app` vào đầu sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))
