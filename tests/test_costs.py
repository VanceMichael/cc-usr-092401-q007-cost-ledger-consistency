"""成本账接口测试: 派生/校验、调整分录、撤销、乐观锁、日期边界与汇总一致性。"""

import unittest

from cost_helpers import make_client, make_batch


class CostRecordApiTest(unittest.TestCase):
    def setUp(self):
        self.client = make_client()
        self.batch_id = make_batch(self.client)

    def create(self, **overrides):
        payload = {
            "batch_id": self.batch_id,
            "cost_date": "2026-01-05",
            "cost_type": "feed",
            "quantity": 10,
            "unit": "kg",
            "unit_price": 3.5,
        }
        payload.update(overrides)
        return self.client.post("/api/cost-records/", json=payload)

    # ---- 派生与校验 ----

    def test_derived_type_computes_amount_and_ignores_client_amount(self):
        resp = self.create(amount=999)
        self.assertEqual(resp.status_code, 201, resp.text)
        body = resp.json()
        # 客户端谎报的 999 被忽略, 金额 = 10 * 3.5
        self.assertEqual(body["amount"], 35.0)
        self.assertEqual(body["entry_kind"], "expense")
        self.assertEqual(body["status"], "active")
        self.assertEqual(body["version"], 1)

    def test_derived_type_requires_quantity_and_price(self):
        resp = self.create(quantity=None, unit_price=None)
        self.assertEqual(resp.status_code, 422)
        resp = self.create(unit_price=None)
        self.assertEqual(resp.status_code, 422)

    def test_direct_type_uses_explicit_amount(self):
        resp = self.create(cost_type="labor", amount=100, quantity=None, unit=None, unit_price=None)
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertEqual(resp.json()["amount"], 100.0)

    def test_direct_type_requires_amount(self):
        resp = self.create(cost_type="labor", amount=None, quantity=None, unit=None, unit_price=None)
        self.assertEqual(resp.status_code, 422)

    def test_rejects_negative_values(self):
        resp = self.create(cost_type="labor", amount=-1, quantity=None, unit=None, unit_price=None)
        self.assertEqual(resp.status_code, 422)
        resp = self.create(quantity=-5)
        self.assertEqual(resp.status_code, 422)
        resp = self.create(unit_price=-0.01)
        self.assertEqual(resp.status_code, 422)

    def test_rejects_non_finite_values(self):
        resp = self.create(cost_type="labor", amount=float("nan"), quantity=None, unit=None, unit_price=None)
        self.assertEqual(resp.status_code, 422)
        resp = self.create(quantity=float("inf"))
        self.assertEqual(resp.status_code, 422)
        resp = self.create(unit_price=float("-inf"))
        self.assertEqual(resp.status_code, 422)

    def test_rejects_illegal_unit(self):
        resp = self.create(unit="吨X")
        self.assertEqual(resp.status_code, 422)
        resp = self.create(unit="袋")
        self.assertEqual(resp.status_code, 201, resp.text)

    def test_currency_precision_is_unified(self):
        resp = self.create(cost_type="labor", amount=10.005, quantity=None, unit=None, unit_price=None)
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertEqual(resp.json()["amount"], 10.01)

    def test_cost_type_is_normalized(self):
        resp = self.create(cost_type=" feed ")
        self.assertEqual(resp.status_code, 201, resp.text)
        self.assertEqual(resp.json()["cost_type"], "feed")
        self.assertEqual(resp.json()["amount"], 35.0)

    def test_unknown_batch_rejected(self):
        resp = self.create(batch_id=99999)
        self.assertEqual(resp.status_code, 404)

    # ---- 修改与乐观锁 ----

    def test_update_recomputes_derived_amount(self):
        record = self.create().json()
        resp = self.client.put(
            f"/api/cost-records/{record['id']}/",
            json={"version": record["version"], "quantity": 20},
        )
        self.assertEqual(resp.status_code, 200, resp.text)
        body = resp.json()
        self.assertEqual(body["amount"], 70.0)
        self.assertEqual(body["version"], record["version"] + 1)

    def test_update_requires_matching_version(self):
        record = self.create().json()
        resp = self.client.put(
            f"/api/cost-records/{record['id']}/",
            json={"version": record["version"] + 99, "quantity": 20},
        )
        self.assertEqual(resp.status_code, 409)
        # 缺少 version 直接拒绝
        resp = self.client.put(f"/api/cost-records/{record['id']}/", json={"quantity": 20})
        self.assertEqual(resp.status_code, 422)

    def test_update_of_voided_record_rejected(self):
        record = self.create().json()
        self.client.post(f"/api/cost-records/{record['id']}/void/")
        resp = self.client.put(
            f"/api/cost-records/{record['id']}/",
            json={"version": 99, "quantity": 1},
        )
        # 版本已因撤销 +1, 此处版本不匹配 -> 409; 用最新版本则 -> 422
        self.assertEqual(resp.status_code, 409)
        fresh = self.client.get(f"/api/cost-records/{record['id']}/").json()
        resp = self.client.put(
            f"/api/cost-records/{record['id']}/",
            json={"version": fresh["version"], "quantity": 1},
        )
        self.assertEqual(resp.status_code, 422)

    # ---- 税费/折让/退款: 关联分录 ----

    def test_adjustments_are_linked_entries_and_never_overwrite_original(self):
        record = self.create(cost_type="labor", amount=100, quantity=None, unit=None, unit_price=None).json()
        rid = record["id"]
        for kind, amount in (("tax", 7), ("allowance", 5), ("refund", 10)):
            resp = self.client.post(
                f"/api/cost-records/{rid}/adjustments/",
                json={"kind": kind, "amount": amount, "adjustment_date": "2026-01-06"},
            )
            self.assertEqual(resp.status_code, 201, resp.text)
            self.assertEqual(resp.json()["parent_id"], rid)
            self.assertEqual(resp.json()["entry_kind"], kind)

        # 原账不被覆盖
        fresh = self.client.get(f"/api/cost-records/{rid}/").json()
        self.assertEqual(fresh["amount"], 100.0)

        # 关联分录可查
        children = self.client.get(f"/api/cost-records/{rid}/adjustments/").json()
        self.assertEqual(len(children), 3)

        # 汇总带符号: 100 + 7 - 5 - 10 = 92
        summary = self.client.get("/api/cost-records/summary/", params={"batch_id": self.batch_id}).json()
        self.assertEqual(summary["total"], 92.0)
        self.assertEqual(summary["by_type"]["labor"], 92.0)

    def test_adjustment_validation(self):
        record = self.create(cost_type="labor", amount=100, quantity=None, unit=None, unit_price=None).json()
        rid = record["id"]
        # 非法类型
        resp = self.client.post(
            f"/api/cost-records/{rid}/adjustments/",
            json={"kind": "discount", "amount": 1, "adjustment_date": "2026-01-06"},
        )
        self.assertEqual(resp.status_code, 422)
        # 负数/零金额
        resp = self.client.post(
            f"/api/cost-records/{rid}/adjustments/",
            json={"kind": "tax", "amount": -1, "adjustment_date": "2026-01-06"},
        )
        self.assertEqual(resp.status_code, 422)
        # 调整之上不能再挂调整
        child = self.client.post(
            f"/api/cost-records/{rid}/adjustments/",
            json={"kind": "tax", "amount": 1, "adjustment_date": "2026-01-06"},
        ).json()
        resp = self.client.post(
            f"/api/cost-records/{child['id']}/adjustments/",
            json={"kind": "tax", "amount": 1, "adjustment_date": "2026-01-06"},
        )
        self.assertEqual(resp.status_code, 422)
        # 已撤销分录不能登记调整
        self.client.post(f"/api/cost-records/{rid}/void/")
        resp = self.client.post(
            f"/api/cost-records/{rid}/adjustments/",
            json={"kind": "tax", "amount": 1, "adjustment_date": "2026-01-06"},
        )
        self.assertEqual(resp.status_code, 422)

    # ---- 撤销与有效分录集合 ----

    def test_voided_records_excluded_from_list_summary_and_profit(self):
        feed = self.create().json()  # 35
        labor = self.create(cost_type="labor", amount=100, quantity=None, unit=None, unit_price=None).json()
        self.client.post(f"/api/cost-records/{labor['id']}/void/")

        listed = self.client.get("/api/cost-records/").json()
        self.assertEqual([r["id"] for r in listed], [feed["id"]])

        with_voided = self.client.get("/api/cost-records/", params={"include_voided": True}).json()
        self.assertEqual(len(with_voided), 2)
        voided = [r for r in with_voided if r["id"] == labor["id"]][0]
        self.assertEqual(voided["status"], "voided")

        summary = self.client.get("/api/cost-records/summary/", params={"batch_id": self.batch_id}).json()
        self.assertEqual(summary["total"], 35.0)

        analysis = self.client.get(f"/api/analysis/cycle/{self.batch_id}/").json()
        self.assertEqual(analysis["total_cost"], 35.0)
        self.assertEqual(analysis["profit"], -35.0)
        self.assertEqual(analysis["cost_summary"]["feed_cost"], 35.0)
        self.assertEqual(analysis["cost_summary"]["labor_cost"], 0)

    def test_double_void_rejected(self):
        record = self.create().json()
        resp = self.client.post(f"/api/cost-records/{record['id']}/void/")
        self.assertEqual(resp.status_code, 200)
        resp = self.client.post(f"/api/cost-records/{record['id']}/void/")
        self.assertEqual(resp.status_code, 422)

    def test_physical_delete_disabled(self):
        record = self.create().json()
        resp = self.client.delete(f"/api/cost-records/{record['id']}/")
        self.assertEqual(resp.status_code, 410)

    # ---- 日期筛选边界 ----

    def test_date_filter_includes_boundary_days(self):
        for day in ("2026-01-05", "2026-01-06", "2026-01-07"):
            self.create(cost_date=day)

        exact = self.client.get(
            "/api/cost-records/",
            params={"start_date": "2026-01-06", "end_date": "2026-01-06"},
        ).json()
        self.assertEqual(len(exact), 1)
        self.assertEqual(exact[0]["cost_date"], "2026-01-06")

        tail = self.client.get("/api/cost-records/", params={"start_date": "2026-01-06"}).json()
        self.assertEqual([r["cost_date"] for r in tail], ["2026-01-06", "2026-01-07"])

        head = self.client.get("/api/cost-records/", params={"end_date": "2026-01-06"}).json()
        self.assertEqual([r["cost_date"] for r in head], ["2026-01-05", "2026-01-06"])

        resp = self.client.get(
            "/api/cost-records/",
            params={"start_date": "2026-01-07", "end_date": "2026-01-06"},
        )
        self.assertEqual(resp.status_code, 422)

    def test_date_filter_applies_to_summary(self):
        self.create(cost_date="2026-01-05")
        self.create(cost_date="2026-01-06", cost_type="labor", amount=100, quantity=None, unit=None, unit_price=None)
        summary = self.client.get(
            "/api/cost-records/summary/",
            params={"start_date": "2026-01-06", "end_date": "2026-01-06"},
        ).json()
        self.assertEqual(summary["total"], 100.0)

    # ---- 同一有效分录集合: 列表/汇总/周期利润 ----

    def test_list_summary_and_cycle_profit_share_one_effective_set(self):
        self.create(cost_date="2026-01-05")  # 35 feed
        labor = self.create(
            cost_date="2026-01-06", cost_type="labor", amount=100,
            quantity=None, unit=None, unit_price=None,
        ).json()
        self.client.post(
            f"/api/cost-records/{labor['id']}/adjustments/",
            json={"kind": "refund", "amount": 40, "adjustment_date": "2026-01-07"},
        )
        ghost = self.create(cost_date="2026-01-08", cost_type="other", amount=9,
                            quantity=None, unit=None, unit_price=None).json()
        self.client.post(f"/api/cost-records/{ghost['id']}/void/")

        listed = self.client.get("/api/cost-records/").json()
        list_total = round(sum(r["effective_amount"] for r in listed), 2)

        summary = self.client.get("/api/cost-records/summary/").json()
        analysis = self.client.get(f"/api/analysis/cycle/{self.batch_id}/").json()

        self.assertEqual(list_total, 95.0)  # 35 + 100 - 40
        self.assertEqual(summary["total"], list_total)
        self.assertEqual(analysis["total_cost"], list_total)
        self.assertEqual(analysis["cost_summary"]["total_cost"], list_total)


if __name__ == "__main__":
    unittest.main()
