from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from .. import cost_migration, cost_service
from ..database import get_db
from ..models import Batch, CostRecord
from ..schemas import (
    CostAdjustmentCreate,
    CostRecordCreate,
    CostRecordResponse,
    CostRecordUpdate,
    CostRepairReport,
    CostScanReport,
    CostSummaryResponse,
)

router = APIRouter(
    prefix="/api/cost-records",
    tags=["成本核算"]
)


def _get_batch_or_404(db: Session, batch_id: int) -> Batch:
    db_batch = db.query(Batch).filter(Batch.id == batch_id).first()
    if not db_batch:
        raise HTTPException(status_code=404, detail="批次不存在")
    return db_batch


def _assign_values(target: CostRecord, *, amount, quantity, unit_price, unit) -> None:
    target.amount = float(amount)
    target.quantity = float(quantity) if quantity is not None else None
    target.unit_price = float(unit_price) if unit_price is not None else None
    target.unit = unit


@router.post("/", response_model=CostRecordResponse, status_code=201)
def create_cost_record(record: CostRecordCreate, db: Session = Depends(get_db)):
    _get_batch_or_404(db, record.batch_id)
    cost_type = record.cost_type.strip() if record.cost_type else ""
    try:
        amount, quantity, unit_price, unit = cost_service.validate_and_derive(
            cost_type=cost_type,
            amount=record.amount,
            quantity=record.quantity,
            unit_price=record.unit_price,
            unit=record.unit,
        )
    except cost_service.CostValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    new_record = CostRecord(
        batch_id=record.batch_id,
        cost_date=record.cost_date,
        cost_type=cost_type,
        description=record.description,
        notes=record.notes,
        entry_kind=cost_service.ENTRY_KIND_EXPENSE,
        status=cost_service.STATUS_ACTIVE,
        version=1,
    )
    _assign_values(new_record, amount=amount, quantity=quantity, unit_price=unit_price, unit=unit)
    db.add(new_record)
    db.commit()
    db.refresh(new_record)
    return new_record


@router.get("/", response_model=List[CostRecordResponse])
def get_cost_records(
    skip: int = 0,
    limit: int = Query(100, le=1000),
    batch_id: Optional[int] = None,
    cost_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    include_voided: bool = False,
    db: Session = Depends(get_db),
):
    """成本列表。默认仅返回有效分录(active); 日期筛选含边界日。

    include_voided=true 时同时返回已撤销记录(带状态标识), 但绝不参与汇总。
    """
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")

    if include_voided:
        query = db.query(CostRecord)
        if batch_id is not None:
            query = query.filter(CostRecord.batch_id == batch_id)
        if cost_type:
            query = query.filter(CostRecord.cost_type == cost_type)
        if start_date is not None:
            query = query.filter(CostRecord.cost_date >= start_date)
        if end_date is not None:
            query = query.filter(CostRecord.cost_date <= end_date)
    else:
        query = cost_service.effective_cost_query(
            db, batch_id, cost_type, start_date, end_date
        )

    return (
        query.order_by(CostRecord.cost_date, CostRecord.id)
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.get("/summary/", response_model=CostSummaryResponse)
def get_cost_summary(
    batch_id: Optional[int] = None,
    cost_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
):
    """类型汇总: 与列表/周期利润基于同一有效分录集合, 已撤销记录不参与。"""
    if start_date and end_date and start_date > end_date:
        raise HTTPException(status_code=422, detail="开始日期不能晚于结束日期")
    summary = cost_service.effective_cost_summary(
        db, batch_id, cost_type, start_date, end_date
    )
    return CostSummaryResponse(**summary)


@router.get("/{record_id}/", response_model=CostRecordResponse)
def get_cost_record(record_id: int, db: Session = Depends(get_db)):
    record = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="成本记录不存在")
    return record


@router.put("/{record_id}/", response_model=CostRecordResponse)
def update_cost_record(record_id: int, record: CostRecordUpdate, db: Session = Depends(get_db)):
    db_record = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not db_record:
        raise HTTPException(status_code=404, detail="成本记录不存在")

    # 乐观锁版本冲突保护
    if record.version != db_record.version:
        raise HTTPException(
            status_code=409,
            detail={
                "message": "记录已被其他人修改, 请刷新后重试",
                "current_version": db_record.version,
            },
        )
    if db_record.status == cost_service.STATUS_VOIDED:
        raise HTTPException(status_code=422, detail="记录已撤销, 不能修改")

    update_data = record.dict(exclude_unset=True)
    update_data.pop("version", None)

    for required in ("batch_id", "cost_date", "cost_type"):
        if required in update_data and update_data[required] is None:
            raise HTTPException(status_code=422, detail=f"{required} 不能为空")

    new_batch_id = update_data.get("batch_id", db_record.batch_id)
    if new_batch_id != db_record.batch_id:
        _get_batch_or_404(db, new_batch_id)

    # 未提供的字段沿用现值, 再按费用类型统一校验/派生
    cost_type = update_data.get("cost_type", db_record.cost_type)
    cost_type = cost_type.strip() if cost_type else ""
    try:
        if db_record.entry_kind == cost_service.ENTRY_KIND_EXPENSE:
            amount, quantity, unit_price, unit = cost_service.validate_and_derive(
                cost_type=cost_type,
                amount=update_data.get("amount", db_record.amount),
                quantity=update_data.get("quantity", db_record.quantity),
                unit_price=update_data.get("unit_price", db_record.unit_price),
                unit=update_data.get("unit", db_record.unit),
            )
        else:
            # 调整分录(tax/allowance/refund): 金额直接登记, 不允许挂数量单价
            amount = cost_service.normalize_money(update_data.get("amount", db_record.amount))
            quantity = unit_price = None
            unit = None
    except cost_service.CostValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    db_record.batch_id = new_batch_id
    db_record.cost_date = update_data.get("cost_date", db_record.cost_date)
    db_record.cost_type = cost_type
    db_record.description = update_data.get("description", db_record.description)
    db_record.notes = update_data.get("notes", db_record.notes)
    _assign_values(db_record, amount=amount, quantity=quantity, unit_price=unit_price, unit=unit)
    db_record.version += 1

    db.commit()
    db.refresh(db_record)
    return db_record


@router.post("/{record_id}/adjustments/", response_model=CostRecordResponse, status_code=201)
def create_cost_adjustment(
    record_id: int, adjustment: CostAdjustmentCreate, db: Session = Depends(get_db)
):
    """税费/折让/退款登记为关联分录, 原账保持不变。"""
    parent = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="成本记录不存在")
    try:
        entry = cost_service.create_adjustment(
            db,
            parent,
            kind=adjustment.kind,
            amount=adjustment.amount,
            adjustment_date=adjustment.adjustment_date,
            description=adjustment.description,
            notes=adjustment.notes,
        )
    except cost_service.CostValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    db.refresh(entry)
    return entry


@router.get("/{record_id}/adjustments/", response_model=List[CostRecordResponse])
def list_cost_adjustments(record_id: int, db: Session = Depends(get_db)):
    """某条费用分录关联的税费/折让/退款分录(含已撤销, 便于审计)。"""
    parent = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail="成本记录不存在")
    return (
        db.query(CostRecord)
        .filter(CostRecord.parent_id == record_id)
        .order_by(CostRecord.id)
        .all()
    )


@router.post("/{record_id}/void/", response_model=CostRecordResponse)
def void_cost_record(record_id: int, db: Session = Depends(get_db)):
    """撤销分录: 只置状态保留痕迹, 不再参与任何汇总。"""
    db_record = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not db_record:
        raise HTTPException(status_code=404, detail="成本记录不存在")
    try:
        cost_service.void_record(db_record)
    except cost_service.CostValidationError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    db.commit()
    db.refresh(db_record)
    return db_record


@router.delete("/{record_id}/")
def delete_cost_record(record_id: int, db: Session = Depends(get_db)):
    # 账目只撤销不物理删除, 保证周期利润与审计痕迹一致
    raise HTTPException(
        status_code=410,
        detail="成本记录不支持物理删除, 请使用 POST /{id}/void/ 撤销",
    )


# ---- 存量数据扫描与修复(可中断续跑, 幂等不重复入账) ----

@router.post("/maintenance/scan", response_model=CostScanReport)
def scan_cost_records(batch_size: int = Query(cost_migration.DEFAULT_BATCH_SIZE, ge=1, le=1000),
                      db: Session = Depends(get_db)):
    report = cost_migration.scan_batch(db, batch_size=batch_size)
    return CostScanReport(**report)


@router.post("/maintenance/repair", response_model=CostRepairReport)
def repair_cost_records(
    batch_size: int = Query(cost_migration.DEFAULT_BATCH_SIZE, ge=1, le=1000),
    dry_run: bool = False,
    cursor: Optional[int] = None,
    db: Session = Depends(get_db),
):
    # dry_run 不推进持久游标, 调用方可传入上一批返回的 next_cursor 继续预演;
    # 正式修复始终使用持久化游标, 保证断点续跑语义
    report = cost_migration.repair_batch(
        db,
        batch_size=batch_size,
        dry_run=dry_run,
        cursor=cursor if dry_run else None,
    )
    return CostRepairReport(**report)


@router.post("/maintenance/reset")
def reset_maintenance_cursors(db: Session = Depends(get_db)):
    """重置扫描/修复游标以便从头重跑(修复打了版本标记, 不会重复入账)。"""
    cost_migration.reset_cursors(db)
    return {"message": "扫描/修复游标已重置"}
