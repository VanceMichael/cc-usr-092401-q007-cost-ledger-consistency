"""成本账核心领域服务。

唯一的记账规则出口:
- 按费用类型决定金额来源(derived: 数量×单价 / direct: 直接金额);
- 列表、类型汇总、周期利润共用 :func:`query_active` 取出的同一有效分录集合;
- 税费/折让/退款/补差以关联子分录表达,绝不覆盖原账;
- 金额统一为 amount_cents(分, 整数),Decimal 计算;
- 历史数据修复以台账+明细唯一键保证可中断续跑、不重复入账。
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import Batch, CostRecord, CostRepairRun, CostRepairLog
from ..money import (
    MoneyValidationError,
    derived_amount, money, price, quantity as validate_quantity,
)

# ---- 费用类型与金额来源规则 -------------------------------------------------

COST_TYPES = ("feed", "medicine", "labor", "electricity", "other")
COST_TYPE_LABELS = {
    "feed": "饲料", "medicine": "药品", "labor": "人工",
    "electricity": "电费", "other": "其他",
}
# 这些类型必须由数量×单价计算金额
DERIVED_TYPES = frozenset({"feed", "medicine"})
# 这些类型允许直接填写金额
DIRECT_TYPES = frozenset({"labor", "electricity", "other"})

# 各派生类型允许的单位(小写匹配)
ALLOWED_UNITS = {
    "feed": {"kg", "公斤", "吨", "t", "袋", "斤", "g", "克"},
    "medicine": {"kg", "公斤", "g", "克", "袋", "瓶", "盒", "箱", "升", "l", "ml", "毫升"},
}

ENTRY_KINDS = ("principal", "tax", "discount", "refund", "correction")
# 调整分录的金额符号:税费增加成本,折让/退款冲减成本
ADJUSTMENT_SIGN = {"tax": 1, "discount": -1, "refund": -1}
ACTIVE, REVOKED = "active", "revoked"


class CostRuleError(ValueError):
    """400:记账规则校验失败。"""


class VersionConflictError(Exception):
    """409:乐观锁版本冲突。"""

    def __init__(self, current_version: int):
        self.current_version = current_version
        super().__init__(f"记录已被他人修改,当前版本为 {current_version}")


class NotFoundError(Exception):
    """404。"""


# ---- 内部工具 ---------------------------------------------------------------

def _norm_unit(unit: Optional[str], cost_type: str) -> str:
    if unit is None or not str(unit).strip():
        raise CostRuleError("派生金额的费用记录必须填写单位")
    u = str(unit).strip().lower()
    allowed = ALLOWED_UNITS.get(cost_type, set())
    if u not in allowed:
        raise CostRuleError(
            f"{COST_TYPE_LABELS[cost_type]}费用不接受单位“{unit}”,允许: {sorted(allowed)}"
        )
    return u


def _require_batch(db: Session, batch_id: int) -> Batch:
    b = db.query(Batch).filter(Batch.id == batch_id).first()
    if not b:
        raise NotFoundError("批次不存在")
    return b


def _cents_to_float(cents: int) -> float:
    return float(Decimal(cents) / 100)


def _amount_cents(record: CostRecord) -> int:
    """有效金额,统一以分为准。"""
    if record.amount_cents is None:  # 历史数据尚未修复
        return int(money(record.amount if record.amount is not None else 0) * 100)
    return record.amount_cents


def _sync_amount(record: CostRecord, cents: int) -> None:
    record.amount_cents = cents
    record.amount = _cents_to_float(cents)


def _derive_cents(qty_dec: Decimal, price_dec: Decimal) -> int:
    return int(derived_amount(qty_dec, price_dec) * 100)


def _validate_cost_type(cost_type: str) -> None:
    if cost_type not in COST_TYPES:
        raise CostRuleError(
            f"非法费用类型“{cost_type}”,允许: {', '.join(COST_TYPES)}"
        )


def _idempotent_get(db: Session, client_token: Optional[str]) -> Optional[CostRecord]:
    if not client_token:
        return None
    return db.query(CostRecord).filter(
        CostRecord.client_token == client_token
    ).first()


def _flush_idempotent(db: Session, record: CostRecord, client_token: Optional[str]) -> CostRecord:
    """提交并在唯一键并发冲突时转为返回已存在的分录(幂等)。"""
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        existing = _idempotent_get(db, client_token)
        if existing is not None:
            return existing
        raise
    return record


# ---- 派生/直接金额规则 ------------------------------------------------------

@dataclass
class ValidatedEntry:
    cost_type: str
    amount_cents: int
    amount_mode: str
    qty: Optional[float]
    unit: Optional[str]
    unit_price: Optional[float]


def _validate_fields(
    cost_type: str,
    *,
    amount: object = None,
    quantity: object = None,
    unit_price: object = None,
    unit: object = None,
    require_complete: bool = True,
) -> ValidatedEntry:
    """按类型校验并产出唯一合法金额。

    require_complete=True 用于创建;PATCH 更新时以合并后的完整字段调用,
    语义同样是“完整记录必须自洽”。
    """
    _validate_cost_type(cost_type)

    if cost_type in DERIVED_TYPES:
        if quantity in (None, "") or unit_price in (None, ""):
            raise CostRuleError(
                f"{COST_TYPE_LABELS[cost_type]}费用必须填写数量和单价,金额由数量×单价计算"
            )
        try:
            q = validate_quantity(quantity)
            p = price(unit_price)
        except MoneyValidationError as e:
            raise CostRuleError(str(e))
        u = _norm_unit(unit, cost_type)
        cents = _derive_cents(q, p)
        if amount not in (None, ""):
            try:
                stated = money(amount)
            except MoneyValidationError as e:
                raise CostRuleError(str(e))
            if int(stated * 100) != cents:
                raise CostRuleError(
                    f"金额 ¥{stated} 与 数量×单价=¥{Decimal(cents) / 100} 矛盾;"
                    f"请修改数量或单价,不要直接填写金额"
                )
        return ValidatedEntry(cost_type, cents, "derived",
                              float(q), u, float(p))

    # direct 类型
    if quantity not in (None, "") or unit_price not in (None, ""):
        raise CostRuleError(
            f"{COST_TYPE_LABELS[cost_type]}费用直接填写金额,不接受数量/单价"
        )
    if amount in (None, ""):
        raise CostRuleError(f"{COST_TYPE_LABELS[cost_type]}费用必须填写金额")
    try:
        a = money(amount)
    except MoneyValidationError as e:
        raise CostRuleError(str(e))
    return ValidatedEntry(cost_type, int(a * 100), "direct", None, None, None)


# ---- 有效分录集合(列表/汇总/周期利润共用) ---------------------------------

def query_active(
    db: Session,
    *,
    batch_id: Optional[int] = None,
    cost_type: Optional[str] = None,
    start: Optional[date] = None,
    end: Optional[date] = None,
    include_revoked: bool = False,
):
    """所有读取方共用的基础查询。

    - 默认只取 status=active;父分录被撤销时子分录在撤销时已级联失效;
    - 日期为闭区间,边界日包含在内;
    - 调整分录继承父分录的 batch 与 cost_type,因此自动并入类型汇总。
    """
    q = db.query(CostRecord)
    if not include_revoked:
        q = q.filter(CostRecord.status == ACTIVE)
    if batch_id is not None:
        q = q.filter(CostRecord.batch_id == batch_id)
    if cost_type:
        _validate_cost_type(cost_type)
        q = q.filter(CostRecord.cost_type == cost_type)
    if start is not None:
        q = q.filter(CostRecord.cost_date >= start)
    if end is not None:
        q = q.filter(CostRecord.cost_date <= end)
    return q.order_by(CostRecord.cost_date.desc(), CostRecord.id.desc())


def sum_by_type(db: Session, **filters) -> dict[str, int]:
    """返回 {cost_type: 金额分},含调整分录后的净额。"""
    rows = (
        query_active(db, **filters)
        .with_entities(CostRecord.cost_type, func.sum(CostRecord.amount_cents))
        .group_by(CostRecord.cost_type)
        .all()
    )
    return {cost_type: int(total or 0) for cost_type, total in rows}


def total_cents(db: Session, **filters) -> int:
    return int(query_active(db, **filters).with_entities(
        func.coalesce(func.sum(CostRecord.amount_cents), 0)
    ).scalar() or 0)


# ---- 创建 / 调整 / 更新 / 撤销 ---------------------------------------------

def create_principal(db: Session, data: dict) -> CostRecord:
    cost_type = data.get("cost_type")
    v = _validate_fields(
        cost_type,
        amount=data.get("amount"),
        quantity=data.get("quantity"),
        unit_price=data.get("unit_price"),
        unit=data.get("unit"),
    )
    _require_batch(db, data["batch_id"])
    if not data.get("cost_date"):
        raise CostRuleError("费用日期不能为空")

    token = data.get("client_token")
    existing = _idempotent_get(db, token)
    if existing is not None:
        return existing

    record = CostRecord(
        batch_id=data["batch_id"],
        cost_date=data["cost_date"],
        cost_type=v.cost_type,
        description=(data.get("description") or None),
        quantity=v.qty,
        unit=v.unit,
        unit_price=v.unit_price,
        amount_mode=v.amount_mode,
        entry_kind="principal",
        status=ACTIVE,
        version=1,
        client_token=token or None,
        notes=(data.get("notes") or None),
    )
    _sync_amount(record, v.amount_cents)
    db.add(record)
    return _flush_idempotent(db, record, token)


def _net_parent_cents(db: Session, parent: CostRecord) -> int:
    """父分录自身加其全部有效调整后的净额(分)。"""
    child_sum = db.query(func.coalesce(func.sum(CostRecord.amount_cents), 0)).filter(
        CostRecord.parent_id == parent.id,
        CostRecord.status == ACTIVE,
    ).scalar() or 0
    return _amount_cents(parent) + int(child_sum)


def create_adjustment(
    db: Session,
    parent_id: int,
    *,
    entry_kind: str,
    amount: object,
    cost_date: Optional[date] = None,
    description: Optional[str] = None,
    client_token: Optional[str] = None,
) -> CostRecord:
    """税费(正)/折让/退款(负)等关联分录,原账不动。"""
    if entry_kind not in ADJUSTMENT_SIGN:
        raise CostRuleError(
            f"调整类型必须是 {sorted(ADJUSTMENT_SIGN)},不能为 {entry_kind}"
        )
    parent = db.query(CostRecord).filter(CostRecord.id == parent_id).first()
    if not parent:
        raise NotFoundError("关联的原成本分录不存在")
    if parent.status != ACTIVE:
        raise CostRuleError("原分录已撤销,不能再追加调整分录")
    if parent.parent_id is not None:
        raise CostRuleError("不能对调整分录再追加调整")

    try:
        magnitude = money(amount)  # 输入恒为非负,方向由 entry_kind 决定
    except MoneyValidationError as e:
        raise CostRuleError(str(e))
    cents = int(magnitude * 100) * ADJUSTMENT_SIGN[entry_kind]
    if cents == 0:
        raise CostRuleError("调整金额不能为0")

    # 折让/退款不得把父分录净额冲成负数
    if cents < 0 and _net_parent_cents(db, parent) + cents < 0:
        raise CostRuleError("折让/退款累计金额不能超过原费用净额")

    existing = _idempotent_get(db, client_token)
    if existing is not None:
        return existing

    record = CostRecord(
        batch_id=parent.batch_id,
        cost_date=cost_date or parent.cost_date,
        cost_type=parent.cost_type,
        amount_mode="direct",
        entry_kind=entry_kind,
        parent_id=parent.id,
        description=description,
        status=ACTIVE,
        version=1,
        client_token=client_token or None,
    )
    _sync_amount(record, cents)
    db.add(record)
    return _flush_idempotent(db, record, client_token)


def update_principal(
    db: Session,
    record_id: int,
    data: dict,
    *,
    expected_version: int,
) -> CostRecord:
    record = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not record:
        raise NotFoundError("成本记录不存在")
    if record.status != ACTIVE:
        raise CostRuleError("已撤销的记录不能编辑,请新建分录")
    if record.entry_kind != "principal":
        raise CostRuleError("调整分录不能直接编辑,请撤销后重新登记")
    if expected_version is None:
        raise CostRuleError("缺少版本号(version),无法进行并发保护")
    if record.version != expected_version:
        raise VersionConflictError(record.version)

    if data.get("batch_id") is not None:
        _require_batch(db, data["batch_id"])
        record.batch_id = data["batch_id"]
    if data.get("cost_date") is not None:
        record.cost_date = data["cost_date"]
    for field in ("description", "notes"):
        if field in data:
            setattr(record, field, data[field] or None)

    # 成本类型/数量/单价/金额任一变化,都按合并后的完整字段重新校验派生
    cost_type = data.get("cost_type", record.cost_type)
    type_changed = "cost_type" in data and data["cost_type"] != record.cost_type

    def _merged(key: str, current):
        # 客户端显式传了该键(含 null)以客户端为准;类型切换时旧的数量/单价作废
        if key in data:
            return data[key]
        return None if type_changed else current

    merged = {
        "amount": _merged("amount", None if record.amount_mode == "derived" else record.amount),
        "quantity": _merged("quantity", record.quantity),
        "unit_price": _merged("unit_price", record.unit_price),
        "unit": _merged("unit", record.unit),
    }
    # 更新调用不传 amount 时,derived 记录允许缺省(由数量单价重算)
    if "amount" not in data and cost_type in DERIVED_TYPES:
        merged["amount"] = None
    v = _validate_fields(cost_type, **merged)

    v = _validate_fields(cost_type, **merged)

    old_type = record.cost_type
    record.cost_type = v.cost_type
    record.amount_mode = v.amount_mode
    record.quantity = v.qty
    record.unit = v.unit
    record.unit_price = v.unit_price
    _sync_amount(record, v.amount_cents)

    # 关联调整分录继承父分录类型;金额变更后净额不得被折让/退款冲成负数
    children = db.query(CostRecord).filter(
        CostRecord.parent_id == record.id,
        CostRecord.status == ACTIVE,
    ).all()
    child_sum = sum(c.amount_cents or 0 for c in children)
    if v.amount_cents + child_sum < 0:
        raise CostRuleError(
            "修改后原费用与已有折让/退款合计为负,请先撤销部分调整分录"
        )
    if old_type != v.cost_type:
        for child in children:
            child.cost_type = v.cost_type
            child.version += 1

    record.version += 1
    db.flush()
    return record


def revoke_entry(db: Session, record_id: int, reason: Optional[str] = None) -> CostRecord:
    """软撤销;级联撤销其全部关联调整分录,原账保留可审计。"""
    record = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not record:
        raise NotFoundError("成本记录不存在")
    if record.status == REVOKED:
        return record  # 撤销幂等

    record.status = REVOKED
    record.revoked_reason = reason
    record.version += 1
    children = db.query(CostRecord).filter(
        CostRecord.parent_id == record.id,
        CostRecord.status == ACTIVE,
    ).all()
    for child in children:
        child.status = REVOKED
        child.revoked_reason = f"父分录 {record.id} 已撤销"
        child.version += 1
    db.flush()
    return record


# ---- 历史数据扫描与修复 -----------------------------------------------------

@dataclass
class RepairIssue:
    record_id: int
    cost_type: str
    reason: str
    current_amount_cents: Optional[int]
    expected_amount_cents: Optional[int]
    fixable: bool


def _inspect(record: CostRecord) -> Optional[RepairIssue]:
    """判定一条历史记录是否自洽。"""
    cost_type = record.cost_type or "other"
    if cost_type not in COST_TYPES:
        return RepairIssue(record.id, cost_type, "非法费用类型",
                           record.amount_cents, None, False)

    # 新增字段为空的老记录先补默认值判断
    kind = record.entry_kind or "principal"
    if kind != "principal":
        return None  # 新规则产生的调整分录无需修

    try:
        if record.amount_cents is None:
            current = int(money(record.amount if record.amount is not None else 0) * 100)
        elif record.amount_cents < 0 and kind == "principal":
            return RepairIssue(record.id, cost_type, "原始费用金额为负",
                               record.amount_cents, None, False)
        else:
            current = record.amount_cents
    except (MoneyValidationError, ValueError, ArithmeticError):
        return RepairIssue(record.id, cost_type, "金额不是合法有限数",
                           None, None, False)

    if cost_type in DERIVED_TYPES:
        if record.quantity in (None, 0) or record.unit_price in (None, 0):
            return RepairIssue(record.id, cost_type,
                               "派生类型缺少数量或单价,需人工补录",
                               current, None, False)
        try:
            expected = _derive_cents(validate_quantity(record.quantity), price(record.unit_price))
        except (MoneyValidationError, CostRuleError):
            return RepairIssue(record.id, cost_type,
                               "数量/单价非法(负数或非有限数)", current, None, False)
        if expected != current:
            return RepairIssue(record.id, cost_type,
                               "金额与数量×单价不一致", current, expected, True)
        return None

    # direct:金额重新量化即可(amount_cents 缺失也算待修)
    if record.amount_cents is None:
        return RepairIssue(record.id, cost_type, "缺少规范金额(分)",
                           None, current, True)
    return None


def find_issues(
    db: Session,
    *,
    after_id: int = 0,
    limit: int = 500,
    batch_id: Optional[int] = None,
) -> list[RepairIssue]:
    q = db.query(CostRecord).filter(CostRecord.id > after_id)
    if batch_id is not None:
        q = q.filter(CostRecord.batch_id == batch_id)
    issues: list[RepairIssue] = []
    for record in q.order_by(CostRecord.id).limit(limit).all():
        issue = _inspect(record)
        if issue is not None:
            issues.append(issue)
    return issues


def _apply_fix(db: Session, record: CostRecord, issue: RepairIssue) -> str:
    """就地更正一条记录(确定性、可重复:结果只取决于记录字段)。"""
    old = record.amount_cents
    if issue.reason == "金额与数量×单价不一致":
        _sync_amount(record, issue.expected_amount_cents)
        record.amount_mode = "derived"
        action = "fixed_amount"
    elif issue.reason == "缺少规范金额(分)":
        _sync_amount(record, issue.expected_amount_cents)
        record.amount_mode = "direct"
        action = "fixed_amount"
    else:
        action = "noop"
    record.entry_kind = record.entry_kind or "principal"
    record.status = record.status or ACTIVE
    record.version = record.version or 1
    return action


def run_repair(
    db: Session,
    run_key: str,
    *,
    batch_size: int = 200,
    max_batches: Optional[int] = None,
) -> CostRepairRun:
    """按 run_key 执行/续跑修复。

    - run_key 相同即续跑:从 last_id 游标之后继续;
    - (run_key, record_id) 唯一约束保证同一条目不会重复入账;
    - 每批独立提交,中断后重跑只处理未完成部分。
    """
    run = db.query(CostRepairRun).filter(CostRepairRun.run_key == run_key).first()
    if run is None:
        run = CostRepairRun(run_key=run_key, status="running")
        db.add(run)
        db.commit()
        db.refresh(run)
    elif run.status == "completed":
        return run  # 已完成,重复执行直接返回(幂等)
    else:
        run.status = "running"
        db.commit()

    batches_done = 0
    try:
        while True:
            records = (
                db.query(CostRecord)
                .filter(CostRecord.id > run.last_id)
                .order_by(CostRecord.id)
                .limit(batch_size)
                .all()
            )
            if not records:
                run.status = "completed"
                run.finished_at = datetime.utcnow()
                db.commit()
                return run

            for record in records:
                run.last_id = max(run.last_id, record.id)
                run.scanned += 1
                already = db.query(CostRepairLog).filter(
                    CostRepairLog.run_key == run_key,
                    CostRepairLog.record_id == record.id,
                ).first()
                if already is not None:
                    run.skipped += 1
                    continue

                issue = _inspect(record)
                if issue is None:
                    log = CostRepairLog(run_key=run_key, record_id=record.id,
                                        action="noop", detail="记录自洽")
                    db.add(log)
                    run.skipped += 1
                    continue

                if not issue.fixable:
                    log = CostRepairLog(run_key=run_key, record_id=record.id,
                                        action="noop",
                                        old_amount_cents=issue.current_amount_cents,
                                        detail=f"需人工处理: {issue.reason}")
                    db.add(log)
                    run.skipped += 1
                    continue

                action = _apply_fix(db, record, issue)
                db.add(CostRepairLog(
                    run_key=run_key, record_id=record.id, action=action,
                    old_amount_cents=issue.current_amount_cents,
                    new_amount_cents=issue.expected_amount_cents,
                    detail=issue.reason,
                ))
                run.repaired += 1

            db.commit()  # 一批一提交:崩溃后已提交批次不会重复
            batches_done += 1
            if max_batches is not None and batches_done >= max_batches:
                return run
    except Exception as exc:  # noqa: BLE001 - 标记失败并保留游标以便续跑
        db.rollback()
        run.message = f"{type(exc).__name__}: {exc}"[:500]
        db.commit()
        raise


def repair_status(db: Session, run_key: str) -> Optional[CostRepairRun]:
    return db.query(CostRepairRun).filter(CostRepairRun.run_key == run_key).first()
