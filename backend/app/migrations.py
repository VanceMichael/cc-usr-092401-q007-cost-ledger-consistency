"""既有 SQLite 数据库的列级迁移。

`Base.metadata.create_all` 只会建新表, 不会给已有表加列; 这里用
PRAGMA/ALTER TABLE 为 cost_records 补齐成本账修复引入的新列, 幂等可重复执行。
"""
from sqlalchemy import text

from .database import engine

#: cost_records 需要补齐的列: 列名 -> DDL 片段
COST_RECORD_COLUMNS = {
    "entry_kind": "VARCHAR(20) NOT NULL DEFAULT 'expense'",
    "status": "VARCHAR(20) NOT NULL DEFAULT 'active'",
    "version": "INTEGER NOT NULL DEFAULT 1",
    "parent_id": "INTEGER",
    "repair_revision": "INTEGER",
}


def ensure_cost_schema(bind=engine) -> None:
    """为既有数据库补齐成本账新列(新装库由 create_all 建全, 此处为空操作)。"""
    with bind.begin() as conn:
        rows = conn.execute(text("PRAGMA table_info(cost_records)")).fetchall()
        if not rows:
            return  # 表尚不存在, 交给 create_all
        existing = {row[1] for row in rows}
        for name, ddl in COST_RECORD_COLUMNS.items():
            if name not in existing:
                conn.execute(text(f"ALTER TABLE cost_records ADD COLUMN {name} {ddl}"))
