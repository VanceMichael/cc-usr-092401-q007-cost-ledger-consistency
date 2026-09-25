"""成本接口测试的公共环境: 指向临时 SQLite 库并提供清表工具。

注意: 必须在导入 app 之前设置 DATABASE_URL, 因此测试模块应先 import 本模块。
"""
import os
import sys
import tempfile
from pathlib import Path

os.environ.setdefault(
    "DATABASE_URL",
    f"sqlite:///{Path(tempfile.gettempdir()) / 'aquaculture_cost_tests.db'}",
)
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from fastapi.testclient import TestClient  # noqa: E402

from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app import models  # noqa: E402

# 按外键依赖顺序清表
_TABLES = (
    models.CostRecord,
    models.HarvestSale,
    models.StockingRecord,
    models.FeedingRecord,
    models.WaterQualityRecord,
    models.MedicationRecord,
    models.Batch,
    models.Pond,
    models.CostMigrationState,
)


def reset_db():
    db = SessionLocal()
    try:
        for model in _TABLES:
            db.query(model).delete()
        db.commit()
    finally:
        db.close()


def make_client() -> TestClient:
    reset_db()
    return TestClient(app)


def make_batch(client: TestClient, name: str = "批次-1") -> int:
    pond = client.post(
        "/api/ponds/",
        json={"name": f"塘口-{name}", "area": 10.0, "water_depth": 2.0, "species": "草鱼"},
    ).json()
    batch = client.post(
        "/api/batches/",
        json={
            "batch_number": name,
            "pond_id": pond["id"],
            "species": "草鱼",
            "stocking_date": "2026-01-01",
        },
    ).json()
    return batch["id"]
