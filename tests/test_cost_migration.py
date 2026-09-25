"""存量数据扫描/修复流程测试: 可重复执行、可中断续跑、不重复入账。"""

import unittest
from datetime import date

from cost_helpers import make_client, make_batch
from app.database import SessionLocal
from app.models import CostRecord


def insert_legacy(batch_id, **fields):
    """模拟旧接口写入的不一致记录(绕过新校验, 直接落库)。"""
    db = SessionLocal()
    try:
        record = CostRecord(batch_id=batch_id, **fields)
        db.add(record)
        db.commit()
        db.refresh(record)
        return record.id
    finally:
        db.close()


def get_record(record_id) -> CostRecord:
    db = SessionLocal()
    try:
        return db.get(CostRecord, record_id)
    finally:
        db.close()


class CostMigrationTest(unittest.TestCase):
    def setUp(self):
        self.client = make_client()
        self.batch_id = make_batch(self.client)

    def seed_legacy(self):
        """各类不一致: 金额矛盾、负数费用、缺数量单价、精度越界、非法单位。"""
        self.mismatch_id = insert_legacy(
            self.batch_id, cost_date=date(2026, 1, 2), cost_type="feed",
            amount=999.0, quantity=10, unit="kg", unit_price=3.5,
        )
        self.negative_id = insert_legacy(
            self.batch_id, cost_date=date(2026, 1, 3), cost_type="labor", amount=-50.0,
        )
        self.missing_id = insert_legacy(
            self.batch_id, cost_date=date(2026, 1, 4), cost_type="feed", amount=20.0,
        )
        self.precision_id = insert_legacy(
            self.batch_id, cost_date=date(2026, 1, 5), cost_type="other", amount=7.777,
        )
        self.bad_unit_id = insert_legacy(
            self.batch_id, cost_date=date(2026, 1, 6), cost_type="medicine",
            amount=12.0, quantity=2, unit="吨X", unit_price=6.0,
        )
        self.clean_id = insert_legacy(
            self.batch_id, cost_date=date(2026, 1, 7), cost_type="medicine",
            amount=12.0, quantity=2, unit="克", unit_price=6.0,
        )

    def scan_all(self, batch_size=2):
        self.client.post("/api/cost-records/maintenance/reset")
        issues = []
        while True:
            report = self.client.post(
                "/api/cost-records/maintenance/scan", params={"batch_size": batch_size}
            ).json()
            issues.extend(report["issues"])
            if report["done"]:
                break
        return issues

    def repair_all(self, batch_size=2, **params):
        reports = []
        cursor = None
        while True:
            query = {"batch_size": batch_size, **params}
            if cursor is not None:
                query["cursor"] = cursor
            report = self.client.post(
                "/api/cost-records/maintenance/repair", params=query
            ).json()
            reports.append(report)
            if report["done"]:
                break
            if params.get("dry_run"):
                # 预演不推进持久游标, 用返回的 next_cursor 继续
                cursor = report["next_cursor"]
        return reports

    def test_scan_reports_all_inconsistency_kinds(self):
        self.seed_legacy()
        issues = self.scan_all()
        by_id = {}
        for issue in issues:
            by_id.setdefault(issue["record_id"], set()).add(issue["issue"])

        self.assertIn("amount_mismatch", by_id[self.mismatch_id])
        self.assertIn("negative_amount", by_id[self.negative_id])
        self.assertIn("missing_quantity_or_price", by_id[self.missing_id])
        self.assertIn("amount_precision", by_id[self.precision_id])
        self.assertIn("invalid_unit", by_id[self.bad_unit_id])
        self.assertNotIn(self.clean_id, by_id)

    def test_repair_fixes_marks_and_converts(self):
        self.seed_legacy()
        self.client.post("/api/cost-records/maintenance/reset")
        self.repair_all()

        # 派生类型按 数量*单价 重算
        self.assertEqual(get_record(self.mismatch_id).amount, 35.0)
        # 负数费用: 原账归零 + 关联退款分录
        self.assertEqual(get_record(self.negative_id).amount, 0.0)
        db = SessionLocal()
        refunds = db.query(CostRecord).filter(CostRecord.entry_kind == "refund").all()
        db.close()
        self.assertEqual(len(refunds), 1)
        self.assertEqual(refunds[0].amount, 50.0)
        self.assertEqual(refunds[0].parent_id, self.negative_id)
        # 精度统一
        self.assertEqual(get_record(self.precision_id).amount, 7.78)
        # 干净记录不动
        self.assertEqual(get_record(self.clean_id).amount, 12.0)
        # 全部打上修复标记
        for rid in (self.mismatch_id, self.negative_id, self.missing_id,
                    self.precision_id, self.bad_unit_id, self.clean_id):
            self.assertEqual(get_record(rid).repair_revision, 1)

        # 修复后汇总 = 35 - 50(退款) + 20 + 7.78 + 12 + 12 = 36.78
        summary = self.client.get(
            "/api/cost-records/summary/", params={"batch_id": self.batch_id}
        ).json()
        self.assertAlmostEqual(summary["total"], 36.78, places=2)

    def test_repair_is_resumable_and_idempotent(self):
        self.seed_legacy()
        self.client.post("/api/cost-records/maintenance/reset")

        # 只跑第一批(模拟中断), 然后续跑剩余
        first = self.client.post(
            "/api/cost-records/maintenance/repair", params={"batch_size": 1}
        ).json()
        self.assertFalse(first["done"])
        rest = self.repair_all(batch_size=2)

        db = SessionLocal()
        refund_count = db.query(CostRecord).filter(CostRecord.entry_kind == "refund").count()
        db.close()
        self.assertEqual(refund_count, 1)

        # 重置游标从头再跑: 已修复行被跳过, 不产生任何新修复/新分录
        self.client.post("/api/cost-records/maintenance/reset")
        again = self.repair_all(batch_size=3)
        self.assertEqual(sum(r["fixed"] for r in again), 0)
        self.assertEqual(sum(r["converted"] for r in again), 0)

        db = SessionLocal()
        refund_count = db.query(CostRecord).filter(CostRecord.entry_kind == "refund").count()
        total_rows = db.query(CostRecord).count()
        db.close()
        self.assertEqual(refund_count, 1)
        self.assertEqual(total_rows, 7)  # 6 条原始 + 1 条退款

    def test_dry_run_changes_nothing(self):
        self.seed_legacy()
        self.client.post("/api/cost-records/maintenance/reset")
        reports = self.repair_all(dry_run=True)
        self.assertGreater(sum(r["fixed"] for r in reports), 0)
        # 预演不落库
        self.assertEqual(get_record(self.mismatch_id).amount, 999.0)
        self.assertIsNone(get_record(self.mismatch_id).repair_revision)

    def test_unrepairable_rows_are_flagged_not_guessed(self):
        self.seed_legacy()
        self.client.post("/api/cost-records/maintenance/reset")
        reports = self.repair_all()
        flagged_ids = {i["record_id"] for r in reports for i in r["issues"]}
        # 缺数量单价与非法单位只能上报, 不猜值
        self.assertIn(self.missing_id, flagged_ids)
        self.assertIn(self.bad_unit_id, flagged_ids)
        self.assertEqual(get_record(self.missing_id).amount, 20.0)
        self.assertEqual(get_record(self.bad_unit_id).unit, "吨X")


if __name__ == "__main__":
    unittest.main()
