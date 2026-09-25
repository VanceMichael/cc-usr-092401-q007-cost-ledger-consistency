"""成本账领域服务: 金额派生、校验规则与有效分录集合。

设计约定:
- 费用类型决定金额来源: DERIVED_COST_TYPES(feed/medicine) 必须由 数量*单价 派生,
  其余类型(direct) 直接填写金额, 数量/单价仅作辅助信息。
- 金额统一两位小数(分), 数量/单价统一四位小数; 拒绝负数、非有限数与非法单位。
- 税费(tax)/折让(allowance)/退款(refund) 以关联分录表达(parent_id 指向原费用),
  不覆盖原账; 撤销(void)只改状态, 不删除记录。
- 列表/汇总/周期利润/前端均必须基于 effective_cost_query 返回的同一有效分录集合。
"""
from __future__ import annotations

import math
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation
from typing import Dict, List, Optional, Tuple

from sqlalchemy.orm import Session

from .models import CostRecord

# ---- 常量 ----

CENT = Decimal("0.01")
QUANTUM_QUANTITY = Decimal("0.0001")

#: 必须由 数量*单价 派生金额的费用类型
DERIVED_COST_TYPES = frozenset({"feed", "medicine"})
#: 允许直接填写金额的费用类型
DIRECT_COST_TYPES = frozenset({"labor", "electricity", "other"})
KNOWN_COST_TYPES = DERIVED_COST_TYPES | DIRECT_COST_TYPES

#: 合法分录类型
ENTRY_KIND_EXPENSE = "expense"
ENTRY_KIND_TAX = "tax"
ENTRY_KIND_ALLOWANCE = "allowance"
ENTRY_KIND_REFUND = "refund"
ENTRY_KINDS = frozenset(
    {ENTRY_KIND_EXPENSE, ENTRY_KIND_TAX, ENTRY_KIND_ALLOWANCE, ENTRY_KIND_REFUND}
)
#: 抵减成本的分录类型(其余为增加成本)
CREDIT_ENTRY_KINDS = frozenset({ENTRY_KIND_ALLOWANCE, ENTRY_KIND_REFUND})

STATUS_ACTIVE = "active"
STATUS_VOIDED = "voided"

#: 各费用类型允许的数量单位(白名单); direct 类型不校验单位
ALLOWED_UNITS: Dict[str, frozenset] = {
    "feed": frozenset({"kg", "g", "吨", "公斤", "克", "袋", "包", "箱"}),
    "medicine": frozenset({"kg", "g", "L", "ml", "公斤", "克", "升", "毫升", "瓶", "袋", "盒", "支"}),
}


class CostValidationError(ValueError):
    """成本数据校验失败, 路由层转换为 422。"""


class CostConflictError(RuntimeError):
    """乐观锁版本冲突, 路由层转换为 409。"""


# ---- 数值规范化 ----

def _to_decimal(value, field: str) -> Decimal:
    if value is None:
        raise CostValidationError(f"{field}不能为空")
    if isinstance(value, bool):
        raise CostValidationError(f"{field}必须是数值")
    if isinstance(value, float) and not math.isfinite(value):
        raise CostValidationError(f"{field}必须是有限数值, 不允许 NaN/Infinity")
    try:
        dec = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise CostValidationError(f"{field}必须是数值")
    if not dec.is_finite():
        raise CostValidationError(f"{field}必须是有限数值, 不允许 NaN/Infinity")
    return dec


def normalize_money(value, field: str = "金额") -> Decimal:
    """金额统一为两位小数(分), 拒绝负数与非有限数。"""
    dec = _to_decimal(value, field)
    if dec < 0:
        raise CostValidationError(f"{field}不允许为负数")
    return dec.quantize(CENT, rounding=ROUND_HALF_UP)


def normalize_quantity(value, field: str = "数量") -> Decimal:
    dec = _to_decimal(value, field)
    if dec < 0:
        raise CostValidationError(f"{field}不允许为负数")
    return dec.quantize(QUANTUM_QUANTITY, rounding=ROUND_HALF_UP)


def normalize_unit_price(value, field: str = "单价") -> Decimal:
    dec = _to_decimal(value, field)
    if dec < 0:
        raise CostValidationError(f"{field}不允许为负数")
    return dec.quantize(QUANTUM_QUANTITY, rounding=ROUND_HALF_UP)


def normalize_unit(unit: Optional[str], cost_type: str) -> Optional[str]:
    """单位白名单校验; 未提供数量时单位必须为 None。"""
    if unit is None:
        return None
    cleaned = unit.strip()
    if not cleaned:
        return None
    allowed = ALLOWED_UNITS.get(cost_type)
    if allowed is not None and cleaned not in allowed:
        raise CostValidationError(
            f"费用类型 {cost_type} 不支持单位 '{cleaned}', 允许: {sorted(allowed)}"
        )
    return cleaned


def derive_amount(quantity: Decimal, unit_price: Decimal) -> Decimal:
    """派生金额 = 数量 * 单价, 结果统一两位小数。"""
    return (quantity * unit_price).quantize(CENT, rounding=ROUND_HALF_UP)


# ---- 费用类型与金额来源 ----

def amount_method_for(cost_type: Optional[str]) -> str:
    """按费用类型决定金额来源: derived(数量*单价) 或 direct(直接金额)。

    未知类型按 direct 处理(与历史数据兼容)。
    """
    return "derived" if cost_type in DERIVED_COST_TYPES else "direct"


def validate_and_derive(
    *,
    cost_type: str,
    amount,
    quantity,
    unit_price,
    unit: Optional[str],
) -> Tuple[Decimal, Optional[Decimal], Optional[Decimal], Optional[str]]:
    """按费用类型校验并返回规范化后的 (amount, quantity, unit_price, unit)。

    derived 类型: 必须提供数量与单价, 金额由服务端计算(忽略客户端传入的 amount)。
    direct  类型: 必须提供金额; 数量/单价可选, 提供时同样校验非负与单位合法性。
    """
    if not cost_type or not str(cost_type).strip():
        raise CostValidationError("费用类型不能为空")
    cost_type = str(cost_type).strip()

    method = amount_method_for(cost_type)
    if method == "derived":
        if quantity is None or unit_price is None:
            raise CostValidationError(
                f"费用类型 {cost_type} 必须填写数量和单价, 金额由系统计算"
            )
        q = normalize_quantity(quantity)
        p = normalize_unit_price(unit_price)
        u = normalize_unit(unit, cost_type)
        if q > 0 and u is None:
            raise CostValidationError(f"费用类型 {cost_type} 数量大于 0 时必须填写单位")
        return derive_amount(q, p), q, p, u

    # direct
    amt = normalize_money(amount)
    q = normalize_quantity(quantity) if quantity is not None else None
    p = normalize_unit_price(unit_price) if unit_price is not None else None
    u = normalize_unit(unit, cost_type)
    if q is not None and q > 0 and u is None:
        raise CostValidationError("数量大于 0 时必须填写单位")
    return amt, q, p, u


# ---- 有效分录集合(唯一事实来源) ----

def effective_cost_query(
    db: Session,
    batch_id: Optional[int] = None,
    cost_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
):
    """有效分录集合: 仅 active 状态; 日期筛选含边界日(闭区间)。

    成本列表、类型汇总、周期利润与前端展示必须全部基于该查询,
    已撤销(voided)记录一律不参与。
    """
    query = db.query(CostRecord).filter(CostRecord.status == STATUS_ACTIVE)
    if batch_id is not None:
        query = query.filter(CostRecord.batch_id == batch_id)
    if cost_type:
        query = query.filter(CostRecord.cost_type == cost_type)
    if start_date is not None:
        query = query.filter(CostRecord.cost_date >= start_date)
    if end_date is not None:
        query = query.filter(CostRecord.cost_date <= end_date)
    return query


def signed_amount(entry: CostRecord) -> Decimal:
    """分录对成本的带符号贡献: 折让/退款为负, 其余为正。"""
    amt = Decimal(str(entry.amount or 0)).quantize(CENT, rounding=ROUND_HALF_UP)
    if entry.entry_kind in CREDIT_ENTRY_KINDS:
        return -amt
    return amt


def summarize_entries(entries: List[CostRecord]) -> Dict[str, object]:
    """对同一有效分录集合计算总额与按费用类型分组(带符号)。"""
    total = Decimal("0.00")
    by_type: Dict[str, Decimal] = {}
    for entry in entries:
        contribution = signed_amount(entry)
        total += contribution
        by_type[entry.cost_type] = by_type.get(entry.cost_type, Decimal("0.00")) + contribution
    return {
        "total": float(total),
        "by_type": {k: float(v) for k, v in by_type.items()},
        "count": len(entries),
    }


def effective_cost_summary(
    db: Session,
    batch_id: Optional[int] = None,
    cost_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
) -> Dict[str, object]:
    entries = effective_cost_query(db, batch_id, cost_type, start_date, end_date).all()
    return summarize_entries(entries)


# ---- 调整分录(税费/折让/退款) ----

def create_adjustment(
    db: Session,
    parent: CostRecord,
    *,
    kind: str,
    amount,
    adjustment_date: date,
    description: Optional[str] = None,
    notes: Optional[str] = None,
) -> CostRecord:
    """在原始费用分录上登记税费/折让/退款, 不修改原账。

    调整分录继承原分录的批次、费用日期与费用类型, 金额为直接金额(非负, 两位小数)。
    """
    if kind not in (ENTRY_KIND_TAX, ENTRY_KIND_ALLOWANCE, ENTRY_KIND_REFUND):
        raise CostValidationError(f"不支持的分录类型: {kind}")
    if parent.status != STATUS_ACTIVE:
        raise CostValidationError("原分录已撤销, 不能登记调整")
    if parent.entry_kind != ENTRY_KIND_EXPENSE:
        raise CostValidationError("只能对原始费用分录登记税费/折让/退款")
    amt = normalize_money(amount)
    if amt <= 0:
        raise CostValidationError("调整金额必须大于 0")
    entry = CostRecord(
        batch_id=parent.batch_id,
        cost_date=adjustment_date,
        cost_type=parent.cost_type,
        amount=float(amt),
        description=description,
        notes=notes,
        entry_kind=kind,
        status=STATUS_ACTIVE,
        version=1,
        parent_id=parent.id,
    )
    db.add(entry)
    db.flush()
    return entry


def void_record(record: CostRecord) -> None:
    """撤销分录: 仅置状态, 保留账目痕迹。"""
    if record.status == STATUS_VOIDED:
        raise CostValidationError("该记录已撤销")
    record.status = STATUS_VOIDED
    record.version = (record.version or 0) + 1
