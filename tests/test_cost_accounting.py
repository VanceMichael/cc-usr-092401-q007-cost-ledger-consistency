"""成本账派生、更正、汇总一致性与修复流程测试。

覆盖:
- 按费用类型决定 derived/direct 金额来源;
- Decimal 货币精度、拒绝负数/非有限数/非法单位;
- 税费/折让/退款关联分录,不覆盖原账;
- client_token 幂等、version 乐观锁 409;
- 日期闭区间边界、已撤销记录过滤;
- 列表、类型汇总、周期利润同源;
- 历史数据修复可中断续跑、不重复入账;
- 旧库轻量迁移幂等并回填 amount_cents。
"""
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))


class CostAccountingTestBase(unittest.TestCase):
    def setUp(self):
        fd, self.db_path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.remove(self.db_path)
        os.environ["DATABASE_URL"] = f"sqlite:///{self.db_path}"
        # 强制各模块按新的 DATABASE_URL 重新初始化
        for name in list(sys.modules):
            if name == "app" or name.startswith("app."):
                del sys.modules[name]
        from fastapi.testclient import TestClient
        from app.main import app  # noqa: E402
        self.client = TestClient(app)
        self.client.post("/api/ponds/", json={
            "name": "P1", "area": 10, "water_depth": 1.5, "species": "罗非鱼",
        })
        self.client.post("/api/batches/", json={
            "batch_number": "B1", "pond_id": 1, "species": "罗非鱼",
            "stocking_date": "2026-01-01",
        })

    def tearDown(self):
        os.environ.pop("DATABASE_URL", None)
        if os.path.exists(self.db_path):
            os.remove(self.db_path)

    # -- 便捷构造 --
    def create_feed(self, qty, price, unit="kg", date="2026-02-01", amount=None, token=None):
        payload = {"batch_id": 1, "cost_date": date, "cost_type": "feed",
                   "quantity": qty, "unit": unit, "unit_price": price}
        if amount is not None:
            payload["amount"] = amount
        if token:
            payload["client_token"] = token
        return self.client.post("/api/cost-records/", json=payload)

    def create_direct(self, cost_type, amount, date="2026-02-01"):
        return self.client.post("/api/cost-records/", json={
            "batch_id": 1, "cost_date": date, "cost_type": cost_type,
            "amount": amount,
        })


class DerivationAndValidationTests(CostAccountingTestBase):
    def test_feed_amount_derived_from_quantity_and_price(self):
        r = self.create_feed(100, 5.5)
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["amount_cents"], 55000)
        self.assertEqual(body["amount"], 550.0)
        self.assertEqual(body["amount_mode"], "derived")
        self.assertNotIn("amount", r.request.content.decode())  # 前端不传金额也能入账

    def test_contradictory_amount_rejected(self):
        r = self.create_feed(100, 5.5, amount=999)
        self.assertEqual(r.status_code, 400)
        self.assertIn("矛盾", r.json()["detail"])

    def test_matching_amount_accepted_but_still_derived(self):
        r = self.create_feed(100, 5.5, amount=550)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["amount_cents"], 55000)

    def test_derived_requires_quantity_unit_price(self):
        r = self.client.post("/api/cost-records/", json={
            "batch_id": 1, "cost_date": "2026-02-01", "cost_type": "feed",
        })
        self.assertEqual(r.status_code, 400)

    def test_direct_types_reject_quantity(self):
        r = self.create_direct("labor", 100)
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["amount_mode"], "direct")
        r = self.client.post("/api/cost-records/", json={
            "batch_id": 1, "cost_date": "2026-02-01", "cost_type": "labor",
            "amount": 100, "quantity": 2,
        })
        self.assertEqual(r.status_code, 400)

    def test_direct_requires_amount(self):
        r = self.client.post("/api/cost-records/", json={
            "batch_id": 1, "cost_date": "2026-02-01", "cost_type": "electricity",
        })
        self.assertEqual(r.status_code, 400)

    def test_money_precision_rounded_half_up(self):
        # 19.99 × 3 = 59.97;单价 4 位小数参与计算
        r = self.create_feed(3, 19.99)
        self.assertEqual(r.json()["amount_cents"], 5997)
        r = self.create_feed(3, 10.005, date="2026-03-01")
        self.assertEqual(r.json()["amount_cents"], 3002)  # 30.015 -> 30.02

    def test_negative_values_rejected(self):
        r = self.create_feed(-1, 5)
        self.assertEqual(r.status_code, 422)
        r = self.create_feed(10, -5)
        self.assertEqual(r.status_code, 422)
        r = self.create_direct("labor", -1)
        self.assertEqual(r.status_code, 422)

    def test_non_finite_values_rejected(self):
        r = self.create_direct("labor", float("inf"))
        self.assertEqual(r.status_code, 422)
        r = self.create_direct("labor", float("nan"))
        self.assertEqual(r.status_code, 422)
        # 错误响应本身必须是合法 JSON(不回显 NaN/Infinity)
        import json
        json.dumps(r.json())

    def test_illegal_unit_rejected(self):
        r = self.create_feed(10, 5, unit="箱")
        self.assertEqual(r.status_code, 400)
        r = self.create_feed(10, 5, unit="")
        self.assertEqual(r.status_code, 400)

    def test_allowed_units_case_insensitive(self):
        for u in ("kg", "KG", "公斤", "袋"):
            r = self.create_feed(10, 5, unit=u, date=f"2026-04-{10 + len(u)}")
            self.assertEqual(r.status_code, 200, u)
            self.assertEqual(r.json()["unit"], u.lower())

    def test_unknown_cost_type_rejected(self):
        r = self.client.post("/api/cost-records/", json={
            "batch_id": 1, "cost_date": "2026-02-01",
            "cost_type": "bribe", "amount": 1,
        })
        self.assertEqual(r.status_code, 400)


class AdjustmentTests(CostAccountingTestBase):
    def _feed(self):
        return self.create_feed(100, 10).json()["id"]  # 1000 元

    def test_tax_positive_discount_refund_negative(self):
        pid = self._feed()
        r = self.client.post(f"/api/cost-records/{pid}/adjustments/",
                             json={"entry_kind": "tax", "amount": 60})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["amount_cents"], 6000)
        self.assertEqual(r.json()["parent_id"], pid)

        r = self.client.post(f"/api/cost-records/{pid}/adjustments/",
                             json={"entry_kind": "discount", "amount": 30})
        self.assertEqual(r.json()["amount_cents"], -3000)

        r = self.client.post(f"/api/cost-records/{pid}/adjustments/",
                             json={"entry_kind": "refund", "amount": 50})
        self.assertEqual(r.json()["amount_cents"], -5000)

        # 净额 = 1000 + 60 - 30 - 50 = 980
        summary = self.client.get("/api/cost-records/summary/",
                                  params={"batch_id": 1}).json()
        self.assertEqual(summary["total"], 980.0)
        self.assertEqual(summary["by_type"]["feed"]["amount"], 980.0)

    def test_original_entry_never_overwritten(self):
        pid = self._feed()
        self.client.post(f"/api/cost-records/{pid}/adjustments/",
                         json={"entry_kind": "tax", "amount": 60})
        original = self.client.get(f"/api/cost-records/{pid}/").json()
        self.assertEqual(original["amount_cents"], 100000)
        self.assertEqual(original["entry_kind"], "principal")
        self.assertEqual(original["quantity"], 100.0)

    def test_refund_cannot_exceed_net(self):
        pid = self._feed()
        self.client.post(f"/api/cost-records/{pid}/adjustments/",
                         json={"entry_kind": "tax", "amount": 10})
        # 累计 1100 退款超过净额 1010
        self.client.post(f"/api/cost-records/{pid}/adjustments/",
                         json={"entry_kind": "refund", "amount": 1000})
        r = self.client.post(f"/api/cost-records/{pid}/adjustments/",
                             json={"entry_kind": "refund", "amount": 20})
        self.assertEqual(r.status_code, 400)

    def test_adjustment_negative_amount_rejected(self):
        pid = self._feed()
        r = self.client.post(f"/api/cost-records/{pid}/adjustments/",
                             json={"entry_kind": "tax", "amount": -5})
        self.assertEqual(r.status_code, 422)

    def test_adjustment_idempotent_by_token(self):
        pid = self._feed()
        payload = {"entry_kind": "tax", "amount": 5, "client_token": "adj-1"}
        r1 = self.client.post(f"/api/cost-records/{pid}/adjustments/", json=payload)
        r2 = self.client.post(f"/api/cost-records/{pid}/adjustments/", json=payload)
        self.assertEqual(r1.json()["id"], r2.json()["id"])
        summary = self.client.get("/api/cost-records/summary/",
                                  params={"batch_id": 1}).json()
        self.assertEqual(summary["total"], 1005.0)


class VersioningRevokeFilterTests(CostAccountingTestBase):
    def test_optimistic_lock_conflict(self):
        rid = self.create_feed(100, 5).json()["id"]
        r1 = self.client.put(f"/api/cost-records/{rid}/",
                             json={"quantity": 200, "version": 1})
        self.assertEqual(r1.status_code, 200)
        self.assertEqual(r1.json()["version"], 2)
        # 用旧版本再改 -> 409,并返回当前版本
        r2 = self.client.put(f"/api/cost-records/{rid}/",
                             json={"quantity": 300, "version": 1})
        self.assertEqual(r2.status_code, 409)
        self.assertEqual(r2.json()["detail"]["current_version"], 2)
        # 数据未被第二次写入覆盖
        self.assertEqual(self.client.get(f"/api/cost-records/{rid}/").json()["quantity"], 200.0)

    def test_update_requires_version(self):
        rid = self.create_feed(100, 5).json()["id"]
        r = self.client.put(f"/api/cost-records/{rid}/", json={"quantity": 9})
        self.assertEqual(r.status_code, 422)

    def test_update_derived_recomputes_amount(self):
        rid = self.create_feed(100, 5).json()["id"]  # 500
        r = self.client.put(f"/api/cost-records/{rid}/",
                            json={"quantity": 80, "version": 1})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["amount_cents"], 40000)

    def test_update_cannot_make_net_negative_with_existing_refund(self):
        rid = self.create_feed(100, 10).json()["id"]  # 1000
        self.client.post(f"/api/cost-records/{rid}/adjustments/",
                         json={"entry_kind": "refund", "amount": 300})  # -300
        # 把原账改成 200 元 -> 净额 -100,必须拒绝
        r = self.client.put(f"/api/cost-records/{rid}/",
                            json={"quantity": 20, "version": 1})
        self.assertEqual(r.status_code, 400)
        # 金额未变(事务回滚)
        self.assertEqual(self.client.get(f"/api/cost-records/{rid}/").json()["amount_cents"], 100000)

    def test_type_change_cascades_to_adjustments(self):
        rid = self.create_feed(100, 10).json()["id"]
        adj = self.client.post(f"/api/cost-records/{rid}/adjustments/",
                               json={"entry_kind": "tax", "amount": 10}).json()
        r = self.client.put(f"/api/cost-records/{rid}/",
                            json={"cost_type": "medicine", "quantity": 100,
                                  "unit": "kg", "unit_price": 10, "version": 1})
        self.assertEqual(r.status_code, 200)
        adj_after = self.client.get(f"/api/cost-records/{adj['id']}/").json()
        self.assertEqual(adj_after["cost_type"], "medicine")
        # 税费仍计入药品类型汇总
        summary = self.client.get("/api/cost-records/summary/",
                                  params={"batch_id": 1}).json()
        self.assertEqual(summary["by_type"]["medicine"]["amount"], 1010.0)
        self.assertEqual(summary["by_type"]["feed"]["amount"], 0.0)

    def test_revoke_soft_and_cascades_to_children(self):
        rid = self.create_feed(100, 10).json()["id"]
        self.client.post(f"/api/cost-records/{rid}/adjustments/",
                         json={"entry_kind": "tax", "amount": 10})
        r = self.client.post(f"/api/cost-records/{rid}/revoke/",
                             json={"reason": "错录"})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "revoked")

        # 默认列表与汇总不含已撤销记录(父+子均失效)
        records = self.client.get("/api/cost-records/", params={"batch_id": 1}).json()
        self.assertEqual(records, [])
        total = self.client.get("/api/cost-records/summary/",
                                params={"batch_id": 1}).json()["total"]
        self.assertEqual(total, 0)

        # include_revoked 可见,撤销幂等
        records = self.client.get("/api/cost-records/",
                                  params={"batch_id": 1, "include_revoked": True}).json()
        self.assertEqual(len(records), 2)
        self.assertTrue(all(r["status"] == "revoked" for r in records))
        r2 = self.client.post(f"/api/cost-records/{rid}/revoke/", json={})
        self.assertEqual(r2.status_code, 200)

        # 已撤销记录不可再编辑
        r3 = self.client.put(f"/api/cost-records/{rid}/",
                             json={"quantity": 1, "version": r.json()["version"]})
        self.assertEqual(r3.status_code, 400)

    def test_revoked_records_excluded_from_date_filter(self):
        rid = self.create_feed(10, 5, date="2026-05-10").json()["id"]
        self.create_feed(20, 5, date="2026-05-11")
        self.client.post(f"/api/cost-records/{rid}/revoke/", json={})
        rows = self.client.get("/api/cost-records/", params={
            "start_date": "2026-05-01", "end_date": "2026-05-31"}).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], 2)


class DateBoundaryTests(CostAccountingTestBase):
    def test_range_is_closed_on_both_ends(self):
        self.create_feed(1, 5, date="2026-03-01")
        self.create_feed(2, 5, date="2026-03-02")
        self.create_feed(3, 5, date="2026-03-03")
        rows = self.client.get("/api/cost-records/", params={
            "start_date": "2026-03-02", "end_date": "2026-03-02"}).json()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["cost_date"], "2026-03-02")

        rows = self.client.get("/api/cost-records/", params={
            "start_date": "2026-03-01", "end_date": "2026-03-03"}).json()
        self.assertEqual(len(rows), 3)

    def test_open_ended_filters(self):
        self.create_feed(1, 5, date="2026-03-01")
        self.create_feed(2, 5, date="2026-03-10")
        rows = self.client.get("/api/cost-records/",
                               params={"start_date": "2026-03-05"}).json()
        self.assertEqual(len(rows), 1)
        rows = self.client.get("/api/cost-records/",
                               params={"end_date": "2026-03-05"}).json()
        self.assertEqual(len(rows), 1)


class SameEffectiveSetTests(CostAccountingTestBase):
    def test_list_summary_cycle_share_one_effective_set(self):
        self.create_feed(100, 5)          # 500 feed, id 1
        self.create_direct("labor", 300)  # 300 labor
        pid = self.create_feed(20, 10, date="2026-02-05").json()["id"]  # 200 feed
        self.client.post(f"/api/cost-records/{pid}/adjustments/",
                         json={"entry_kind": "discount", "amount": 20})  # -20
        # 撤销一条:id1 500 元失效
        self.client.post(f"/api/cost-records/1/revoke/", json={})

        rows = self.client.get("/api/cost-records/", params={"batch_id": 1}).json()
        list_total = round(sum(r["amount_cents"] for r in rows) / 100, 2)
        summary = self.client.get("/api/cost-records/summary/",
                                  params={"batch_id": 1}).json()
        cycle = self.client.get("/api/analysis/cycle/1/").json()

        # 有效净额 = 300 labor + 200 feed - 20 discount = 480
        self.assertEqual(list_total, 480.0)
        self.assertEqual(summary["total"], 480.0)
        self.assertEqual(cycle["total_cost"], 480.0)
        self.assertEqual(cycle["cost_summary"]["total_cost"], 480.0)
        self.assertEqual(cycle["cost_summary"]["feed_cost"], 180.0)
        self.assertEqual(cycle["cost_summary"]["labor_cost"], 300.0)
        self.assertEqual(cycle["profit"], cycle["total_revenue"] - 480.0)

        # 追溯接口同样只返回有效分录
        trace = self.client.get("/api/analysis/traceability/1/").json()
        self.assertEqual(len(trace["cost_records"]), 3)  # labor + feed200 + discount

    def test_client_token_create_idempotent(self):
        payload = {"batch_id": 1, "cost_date": "2026-02-01",
                   "cost_type": "electricity", "amount": 42, "client_token": "t-1"}
        r1 = self.client.post("/api/cost-records/", json=payload)
        r2 = self.client.post("/api/cost-records/", json=payload)
        self.assertEqual(r1.json()["id"], r2.json()["id"])
        self.assertEqual(len(self.client.get("/api/cost-records/").json()), 1)


class RepairFlowTests(CostAccountingTestBase):
    def _insert_legacy_rows(self):
        from sqlalchemy import text
        from app.database import SessionLocal
        db = SessionLocal()
        rows = [
            # 矛盾:100*5=500 却记 999
            (1, "2026-03-01", "feed", 999.0, 99900, 100.0, "kg", 5.0),
            # 自洽:40*5=200
            (2, "2026-03-02", "feed", 200.0, 20000, 40.0, "kg", 5.0),
            # 直接金额人工账
            (3, "2026-03-03", "labor", 300.0, 30000, None, None, None),
            # 派生类型缺数量单价:不可自动修
            (4, "2026-03-04", "feed", 50.0, 5000, None, None, None),
        ]
        sql = text(
            "INSERT INTO cost_records "
            "(batch_id,cost_date,cost_type,amount,amount_cents,quantity,unit,"
            "unit_price,amount_mode,entry_kind,status,version,created_at) "
            "VALUES (1,:cost_date,:cost_type,:amount,:cents,:qty,:unit,:price,"
            "'direct','principal','active',1,'2026-03-01 00:00:00')"
        )
        for _id, d, ctype, amt, cents, qty, unit, price in rows:
            db.execute(sql, {"cost_date": d, "cost_type": ctype, "amount": amt,
                             "cents": cents, "qty": qty, "unit": unit, "price": price})
        db.commit()
        db.close()

    def test_scan_lists_only_inconsistent(self):
        self._insert_legacy_rows()
        r = self.client.post("/api/cost-records/repair/scan",
                             params={"after_id": 0, "limit": 50})
        self.assertEqual(r.status_code, 200)
        issues = r.json()["issues"]
        ids = {i["record_id"]: i for i in issues}
        self.assertIn(1, ids)
        self.assertTrue(ids[1]["fixable"])
        self.assertEqual(ids[1]["expected_amount_cents"], 50000)
        self.assertIn(4, ids)
        self.assertFalse(ids[4]["fixable"])
        self.assertEqual({i["record_id"] for i in issues}, {1, 4})

    def test_resumable_and_idempotent_repair(self):
        self._insert_legacy_rows()
        # 每批 2 条、每次 1 批 -> 必须多次续跑
        seen_statuses = []
        for _ in range(6):
            r = self.client.post("/api/cost-records/repair/run",
                                 json={"run_key": "R1", "batch_size": 2,
                                       "max_batches": 1})
            self.assertEqual(r.status_code, 200)
            seen_statuses.append(r.json()["status"])
            if r.json()["status"] == "completed":
                break
        self.assertIn("running", seen_statuses)
        self.assertEqual(seen_statuses[-1], "completed")

        status = self.client.get("/api/cost-records/repair/R1/").json()
        self.assertEqual(status["scanned"], 4)
        self.assertEqual(status["repaired"], 1)
        self.assertEqual(status["skipped"], 3)

        # 矛盾记录已就地更正
        rec1 = self.client.get("/api/cost-records/1/").json()
        self.assertEqual(rec1["amount_cents"], 50000)
        self.assertEqual(rec1["amount"], 500.0)
        # 不可修记录原样保留
        rec4 = self.client.get("/api/cost-records/4/").json()
        self.assertEqual(rec4["amount_cents"], 5000)

        # 同一 run_key 再跑:completed 直接返回,数字不变
        again = self.client.post("/api/cost-records/repair/run",
                                 json={"run_key": "R1"}).json()
        self.assertEqual(again["scanned"], 4)
        self.assertEqual(again["repaired"], 1)

        # 新 run_key 扫描已自洽库:0 修正,且每条仍只入账一次
        fresh = self.client.post("/api/cost-records/repair/run",
                                 json={"run_key": "R2"}).json()
        self.assertEqual(fresh["repaired"], 0)
        self.assertEqual(fresh["scanned"], 4)

    def test_repair_endpoint_exposes_resume_after_error(self):
        self._insert_legacy_rows()
        r = self.client.post("/api/cost-records/repair/run",
                             json={"run_key": "R9", "batch_size": 1})
        self.assertEqual(r.status_code, 200)
        # 再用同键继续直到完成
        for _ in range(5):
            r = self.client.post("/api/cost-records/repair/run",
                                 json={"run_key": "R9", "batch_size": 1,
                                       "max_batches": 1})
            if r.json()["status"] == "completed":
                break
        self.assertEqual(r.json()["status"], "completed")


class MigrationTests(unittest.TestCase):
    def test_legacy_table_gets_columns_and_backfill(self):
        import tempfile, os
        fd, path = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        os.remove(path)
        os.environ["DATABASE_URL"] = f"sqlite:///{path}"
        for name in list(sys.modules):
            if name == "app" or name.startswith("app."):
                del sys.modules[name]
        try:
            from sqlalchemy import create_engine, text
            engine = create_engine(
                f"sqlite:///{path}",
                connect_args={"check_same_thread": False},
            )
            with engine.begin() as conn:
                conn.execute(text(
                    "CREATE TABLE cost_records ("
                    "id INTEGER PRIMARY KEY, batch_id INTEGER, cost_date DATE, "
                    "cost_type VARCHAR(50), amount FLOAT NOT NULL, "
                    "description VARCHAR(500), quantity FLOAT, unit VARCHAR(20), "
                    "unit_price FLOAT, notes TEXT, created_at DATETIME)"
                ))
                conn.execute(text(
                    "INSERT INTO cost_records (batch_id, cost_date, cost_type, "
                    "amount, quantity, unit_price, created_at) "
                    "VALUES (1,'2026-01-01','feed',123.456,10,5,'2026-01-01')"
                ))
                conn.execute(text(
                    "INSERT INTO cost_records (batch_id, cost_date, cost_type, "
                    "amount, created_at) VALUES (1,'2026-01-02','labor',88.0,'2026-01-02')"
                ))

            # 迁移幂等:连跑两次不报错
            from app.migrations import run_migrations
            run_migrations(engine)
            run_migrations(engine)

            with engine.begin() as conn:
                cols = {r[1] for r in conn.execute(
                    text("PRAGMA table_info(cost_records)")).fetchall()}
                for needed in ("amount_cents", "version", "status", "entry_kind",
                               "amount_mode", "parent_id", "client_token"):
                    self.assertIn(needed, cols)
                rows = conn.execute(text(
                    "SELECT id, amount_cents, amount_mode, status, version "
                    "FROM cost_records ORDER BY id"
                )).fetchall()
                self.assertEqual(rows[0][1], 12346)  # 123.456 -> 123.46
                self.assertEqual(rows[0][2], "derived")
                self.assertEqual(rows[1][1], 8800)
        finally:
            os.environ.pop("DATABASE_URL", None)
            if os.path.exists(path):
                os.remove(path)


if __name__ == "__main__":
    unittest.main()
