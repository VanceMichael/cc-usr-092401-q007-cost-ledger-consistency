"""货币精度与数值校验工具。

所有金额一律使用 Decimal 并量化到分(0.01),数量/单价在参与金额
计算前同样量化,避免 float 导致的 0.1+0.2 之类误差进入汇总。
"""
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from math import isfinite
from typing import Any, Optional

# 金额:分;数量:3 位小数(克/公斤换算);单价:4 位小数后量化结果仍为分
MONEY_QUANT = Decimal("0.01")
PRICE_QUANT = Decimal("0.0001")
QTY_QUANT = Decimal("0.001")

ZERO = Decimal("0")


class MoneyValidationError(ValueError):
    """输入不是合法的有限非负货币/数值。"""


def to_decimal(value: Any, field: str = "值") -> Decimal:
    """把入参转成 Decimal;NaN/Infinity/不可解析一律拒绝。"""
    if value is None or value == "":
        raise MoneyValidationError(f"{field}不能为空")
    if isinstance(value, bool):
        raise MoneyValidationError(f"{field}不能是布尔值")
    if isinstance(value, float):
        if not isfinite(value):
            raise MoneyValidationError(f"{field}必须是有限数")
        value = repr(value)
    try:
        d = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise MoneyValidationError(f"{field}不是合法数字")
    if not d.is_finite():
        raise MoneyValidationError(f"{field}必须是有限数")
    return d


def validate_non_negative(value: Any, field: str = "值") -> Decimal:
    d = to_decimal(value, field)
    if d < ZERO:
        raise MoneyValidationError(f"{field}不能为负数")
    return d


def validate_positive(value: Any, field: str = "值") -> Decimal:
    d = to_decimal(value, field)
    if d <= ZERO:
        raise MoneyValidationError(f"{field}必须大于0")
    return d


def quantize(d: Decimal, quant: Decimal = MONEY_QUANT) -> Decimal:
    return d.quantize(quant, rounding=ROUND_HALF_UP)


def money(value: Any) -> Decimal:
    """转金额:有限、非负、量化到分。"""
    return quantize(validate_non_negative(value, "金额"))


def price(value: Any) -> Decimal:
    return quantize(validate_positive(value, "单价"), PRICE_QUANT)


def quantity(value: Any) -> Decimal:
    return quantize(validate_positive(value, "数量"), QTY_QUANT)


def derived_amount(qty: Decimal, unit_price: Decimal) -> Decimal:
    """数量 × 单价,四舍五入到分 —— 唯一允许的派生金额来源。"""
    return quantize(qty * unit_price)


def as_cents(d: Decimal) -> int:
    return int(quantize(d) * 100)


def maybe_money(value: Optional[Any]) -> Optional[Decimal]:
    if value is None:
        return None
    return money(value)
