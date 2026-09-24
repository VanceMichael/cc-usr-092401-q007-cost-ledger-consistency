"""SQLite 轻量幂等迁移。

项目使用 Base.metadata.create_all 建表,但它不会给已存在的表补列。
启动时对 cost_records 做一次 PRAGMA 检查,缺失的列以 ALTER TABLE 补齐,
并补建幂等唯一索引;修复台账新表由 create_all 直接建立。
整个过程可重复执行。
"""
from sqlalchemy import text
from sqlalchemy.engine import Engine

COST_NEW_COLUMNS = {
    "amount_cents": "INTEGER",
    "amount_mode": "VARCHAR(10) NOT NULL DEFAULT 'direct'",
    "entry_kind": "VARCHAR(10) NOT NULL DEFAULT 'principal'",
    "parent_id": "INTEGER",
    "status": "VARCHAR(10) NOT NULL DEFAULT 'active'",
    "revoked_reason": "VARCHAR(200)",
    "version": "INTEGER NOT NULL DEFAULT 1",
    "client_token": "VARCHAR(64)",
    "updated_at": "DATETIME",
}


def _existing_columns(conn, table: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA table_info({table})")).fetchall()
    return {row[1] for row in rows}


def _existing_indexes(conn, table: str) -> set[str]:
    rows = conn.execute(text(f"PRAGMA index_list({table})")).fetchall()
    return {row[1] for row in rows}


def run_migrations(engine: Engine) -> None:
    with engine.begin() as conn:
        cols = _existing_columns(conn, "cost_records")
        for name, ddl in COST_NEW_COLUMNS.items():
            if name not in cols:
                conn.execute(text(
                    f"ALTER TABLE cost_records ADD COLUMN {name} {ddl}"
                ))

        # 历史浮点 amount 为 NULL/非法时,amount_cents 保持 NULL,交由修复流程处理
        # 从浮点金额回填规范金额(分),保证修复前汇总不丢数据;修复流程再按
        # 数量×单价就地更正矛盾记录。
        conn.execute(text(
            "UPDATE cost_records SET amount_cents = "
            "CAST(ROUND(amount * 100) AS INTEGER) WHERE amount_cents IS NULL"
        ))
        # 有数量单价的饲料/药品老记录标记为派生模式
        conn.execute(text(
            "UPDATE cost_records SET amount_mode = 'derived' "
            "WHERE cost_type IN ('feed', 'medicine') "
            "AND quantity IS NOT NULL AND unit_price IS NOT NULL"
        ))

        indexes = _existing_indexes(conn, "cost_records")
        if "uq_cost_records_client_token" not in indexes:
            # SQLite 唯一索引中多个 NULL 互不冲突,不影响无 token 的旧数据
            conn.execute(text(
                "CREATE UNIQUE INDEX uq_cost_records_client_token "
                "ON cost_records(client_token) WHERE client_token IS NOT NULL"
            ))
