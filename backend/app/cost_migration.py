"""存量成本数据的扫描与修复流程。

- 分批处理, 游标持久化在 cost_migration_state, 可中断续跑;
- 每批一个事务: 行修复、repair_revision 标记与游标推进同生共死,
  崩溃重跑不会重复入账(已修复行按 repair_revision 跳过);
- 只读扫描(scan)报告问题; 修复(repair)执行安全动作:
    * 派生类型(feed/medicine): 数量*单价 重算金额(覆盖矛盾的手填总额);
    * 直接类型的负数费用: 原金额归零, 差额转为关联的 refund 分录(不掩盖历史);
    * 无法安全自动修复的(缺数量/单价、非有限数、非法单位、孤儿调整)仅标记上报。
"""
from __future__ import annotations

import math
from decimal import Decimal, ROUND_HALF_UP
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from . import cost_service
from .cost_service import (
    ALLOWED_UNITS,
    ENTRY_KIND_EXPENSE,
    ENTRY_KIND_REFUND,
    STATUS_ACTIVE,
    amount_method_for,
    derive_amount,
)
from .models import CostMigrationState, CostRecord

#: 当前修复规则版本; 已标记 >= 该值的行不再重复处理
REPAIR_REVISION = 1

SCAN_CURSOR_KEY = "scan_cursor"
REPAIR_CURSOR_KEY = "repair_cursor"

DEFAULT_BATCH_SIZE = 100


def _get_cursor(db: Session, key: str) -> int:
    row = db.get(CostMigrationState, key)
    if row is None:
        return 0
    try:
        return int(row.value)
    except (TypeError, ValueError):
        return 0


def _set_cursor(db: Session, key: str, value: int) -> None:
    row = db.get(CostMigrationState, key)
    if row is None:
        row = CostMigrationState(key=key, value=str(value))
        db.add(row)
    else:
        row.value = str(value)


def reset_cursors(db: Session) -> None:
    """重置扫描/修复游标, 从头再跑(修复幂等, 不会重复入账)。"""
    _set_cursor(db, SCAN_CURSOR_KEY, 0)
    _set_cursor(db, REPAIR_CURSOR_KEY, 0)
    db.commit()


def _issue(record_id: int, issue: str, detail: str) -> Dict[str, object]:
    return {"record_id": record_id, "issue": issue, "detail": detail}


def detect_issues(db: Session, record: CostRecord) -> List[Dict[str, object]]:
    """检测单条记录的不一致项(只读)。"""
    issues: List[Dict[str, object]] = []
    rid = record.id

    for field in ("amount", "quantity", "unit_price"):
        value = getattr(record, field)
        if value is not None and not math.isfinite(value):
            issues.append(_issue(rid, "non_finite", f"{field}={value} 不是有限数值"))

    amount_finite = record.amount is not None and math.isfinite(record.amount)
    method = amount_method_for(record.cost_type)

    if amount_finite:
        quantized = Decimal(str(record.amount)).quantize(
            cost_service.CENT, rounding=ROUND_HALF_UP
        )
        if Decimal(str(record.amount)) != quantized:
            issues.append(
                _issue(rid, "amount_precision",
                       f"金额 {record.amount} 超出两位小数精度, 应规范为 {quantized}")
            )

    if record.entry_kind == ENTRY_KIND_EXPENSE:
        if method == "derived":
            q_ok = (
                record.quantity is not None
                and math.isfinite(record.quantity)
                and record.quantity >= 0
            )
            p_ok = (
                record.unit_price is not None
                and math.isfinite(record.unit_price)
                and record.unit_price >= 0
            )
            if not q_ok or not p_ok:
                issues.append(
                    _issue(rid, "missing_quantity_or_price",
                           "派生类型缺少有效的数量或单价, 无法重算金额")
                )
            elif amount_finite:
                expected = derive_amount(
                    Decimal(str(record.quantity)), Decimal(str(record.unit_price))
                )
                actual = Decimal(str(record.amount)).quantize(
                    cost_service.CENT, rounding=ROUND_HALF_UP
                )
                if abs(expected - actual) >= cost_service.CENT:
                    issues.append(
                        _issue(rid, "amount_mismatch",
                               f"金额 {actual} 与 数量*单价={expected} 不一致")
                    )
        else:
            if amount_finite and record.amount < 0:
                issues.append(
                    _issue(rid, "negative_amount",
                           f"费用金额为负数 {record.amount}, 应转为退款分录")
                )
        if record.quantity is not None and math.isfinite(record.quantity) and record.quantity < 0:
            issues.append(_issue(rid, "negative_quantity", "数量为负数"))
        if record.unit_price is not None and math.isfinite(record.unit_price) and record.unit_price < 0:
            issues.append(_issue(rid, "negative_unit_price", "单价为负数"))

    if record.unit:
        allowed = ALLOWED_UNITS.get(record.cost_type)
        if allowed is not None and record.unit.strip() not in allowed:
            issues.append(
                _issue(rid, "invalid_unit",
                       f"单位 '{record.unit}' 不在 {record.cost_type} 的允许范围")
            )

    if record.parent_id is not None:
        parent = db.get(CostRecord, record.parent_id)
        if parent is None:
            issues.append(_issue(rid, "orphan_adjustment", "关联的原分录不存在"))

    return issues


def scan_batch(db: Session, batch_size: int = DEFAULT_BATCH_SIZE) -> Dict[str, object]:
    """扫描一批(只读), 返回报告并推进扫描游标; done=True 表示扫完全表。"""
    cursor = _get_cursor(db, SCAN_CURSOR_KEY)
    rows = (
        db.query(CostRecord)
        .filter(CostRecord.id > cursor)
        .order_by(CostRecord.id)
        .limit(batch_size)
        .all()
    )
    issues: List[Dict[str, object]] = []
    for record in rows:
        issues.extend(detect_issues(db, record))
    if rows:
        _set_cursor(db, SCAN_CURSOR_KEY, rows[-1].id)
    db.commit()
    return {"scanned": len(rows), "done": len(rows) < batch_size, "issues": issues}


def _repair_record(db: Session, record: CostRecord) -> Dict[str, object]:
    """修复单条记录, 返回 {fixed, converted, issues}。调用方负责标记与提交。"""
    fixed = False
    converted = False
    issues: List[Dict[str, object]] = []

    amount_finite = record.amount is not None and math.isfinite(record.amount)
    if not amount_finite:
        issues.append(_issue(record.id, "non_finite", "金额不是有限数值, 需人工处理"))
        return {"fixed": fixed, "converted": converted, "issues": issues}

    if record.entry_kind == ENTRY_KIND_EXPENSE:
        method = amount_method_for(record.cost_type)
        if method == "derived":
            q = record.quantity
            p = record.unit_price
            q_ok = q is not None and math.isfinite(q) and q >= 0
            p_ok = p is not None and math.isfinite(p) and p >= 0
            if q_ok and p_ok:
                expected = derive_amount(Decimal(str(q)), Decimal(str(p)))
                actual = Decimal(str(record.amount)).quantize(cost_service.CENT)
                if expected != actual:
                    record.amount = float(expected)
                    record.version = (record.version or 0) + 1
                    fixed = True
            else:
                issues.append(
                    _issue(record.id, "missing_quantity_or_price",
                           "派生类型缺少有效的数量或单价, 需人工补录")
                )
        else:
            if record.amount < 0:
                # 负数费用 -> 原账归零, 差额登记为关联退款分录
                refund = CostRecord(
                    batch_id=record.batch_id,
                    cost_date=record.cost_date,
                    cost_type=record.cost_type,
                    amount=float(
                        Decimal(str(abs(record.amount))).quantize(
                            cost_service.CENT, rounding=ROUND_HALF_UP
                        )
                    ),
                    description=f"由负数费用 #{record.id} 自动转入",
                    notes="数据修复: 负数费用转为退款分录",
                    entry_kind=ENTRY_KIND_REFUND,
                    status=STATUS_ACTIVE,
                    version=1,
                    parent_id=record.id,
                    repair_revision=REPAIR_REVISION,
                )
                db.add(refund)
                record.amount = 0.0
                record.version = (record.version or 0) + 1
                converted = True
            else:
                # 统一货币精度到分
                quantized = float(
                    Decimal(str(record.amount)).quantize(
                        cost_service.CENT, rounding=ROUND_HALF_UP
                    )
                )
                if quantized != record.amount:
                    record.amount = quantized
                    record.version = (record.version or 0) + 1
                    fixed = True
            if record.quantity is not None and (
                not math.isfinite(record.quantity) or record.quantity < 0
            ):
                issues.append(_issue(record.id, "negative_quantity", "数量非法, 需人工处理"))
            if record.unit_price is not None and (
                not math.isfinite(record.unit_price) or record.unit_price < 0
            ):
                issues.append(_issue(record.id, "negative_unit_price", "单价非法, 需人工处理"))
    else:
        # 调整分录: 统一货币精度到分
        quantized = float(
            Decimal(str(record.amount)).quantize(
                cost_service.CENT, rounding=ROUND_HALF_UP
            )
        )
        if quantized != record.amount:
            record.amount = quantized
            record.version = (record.version or 0) + 1
            fixed = True

    if record.unit:
        allowed = ALLOWED_UNITS.get(record.cost_type)
        if allowed is not None and record.unit.strip() not in allowed:
            issues.append(
                _issue(record.id, "invalid_unit",
                       f"单位 '{record.unit}' 非法, 需人工处理")
            )

    if record.parent_id is not None and db.get(CostRecord, record.parent_id) is None:
        issues.append(_issue(record.id, "orphan_adjustment", "关联的原分录不存在, 需人工处理"))

    return {"fixed": fixed, "converted": converted, "issues": issues}


def repair_batch(
    db: Session,
    batch_size: int = DEFAULT_BATCH_SIZE,
    dry_run: bool = False,
    cursor: Optional[int] = None,
) -> Dict[str, object]:
    """修复一批记录。

    行修复、repair_revision 标记与游标推进在同一事务提交; dry_run 只预演不落库
    (此时游标不持久化, 调用方可凭返回的 next_cursor 继续预演下一批)。
    """
    if cursor is None:
        cursor = _get_cursor(db, REPAIR_CURSOR_KEY)
    rows = (
        db.query(CostRecord)
        .filter(CostRecord.id > cursor)
        .order_by(CostRecord.id)
        .limit(batch_size)
        .all()
    )
    fixed = converted = flagged = 0
    issues: List[Dict[str, object]] = []
    processed = 0
    for record in rows:
        if record.repair_revision is not None and record.repair_revision >= REPAIR_REVISION:
            continue  # 已按当前规则修复过, 幂等跳过
        processed += 1
        result = _repair_record(db, record)
        fixed += 1 if result["fixed"] else 0
        converted += 1 if result["converted"] else 0
        flagged += len(result["issues"])
        issues.extend(result["issues"])
        record.repair_revision = REPAIR_REVISION

    next_cursor = rows[-1].id if rows else cursor
    if dry_run:
        db.rollback()
    else:
        if rows:
            _set_cursor(db, REPAIR_CURSOR_KEY, rows[-1].id)
        db.commit()
    return {
        "processed": processed,
        "done": len(rows) < batch_size,
        "fixed": fixed,
        "converted": converted,
        "flagged": flagged,
        "issues": issues,
        "next_cursor": next_cursor,
    }


def run_to_completion(
    db: Session, batch_size: int = DEFAULT_BATCH_SIZE, dry_run: bool = False
) -> Dict[str, object]:
    """连续执行修复直至扫完全表(脚本用); 每批独立事务, 中断后可续跑。"""
    total = {"processed": 0, "fixed": 0, "converted": 0, "flagged": 0, "issues": []}
    cursor: Optional[int] = None
    while True:
        report = repair_batch(db, batch_size=batch_size, dry_run=dry_run, cursor=cursor)
        total["processed"] += report["processed"]
        total["fixed"] += report["fixed"]
        total["converted"] += report["converted"]
        total["flagged"] += report["flagged"]
        total["issues"].extend(report["issues"])
        if report["done"]:
            break
        if dry_run:
            # 预演不落库, 游标只能在内存中推进
            cursor = report["next_cursor"]
    total["done"] = True
    return total
