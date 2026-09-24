"""成本核算路由。

记账规则全部委托给 services.cost_service,本层只做参数装配与异常映射。
列表、类型汇总共用同一有效分录集合查询。
"""
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import CostRecord
from ..schemas import (
    CostRecordCreate, CostRecordUpdate, CostRecordResponse,
    CostAdjustmentCreate, CostRevokeRequest,
    CostSummaryResponse,
    CostRepairScanResponse, CostRepairIssue,
    CostRepairRequest, CostRepairStatusResponse,
)
from ..services import cost_service as svc

router = APIRouter(
    prefix="/api/cost-records",
    tags=["成本核算"]
)


def _handle_domain_error(exc: Exception):
    if isinstance(exc, svc.NotFoundError):
        raise HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, svc.VersionConflictError):
        raise HTTPException(
            status_code=409,
            detail={"message": str(exc), "current_version": exc.current_version},
        )
    if isinstance(exc, svc.CostRuleError):
        raise HTTPException(status_code=400, detail=str(exc))
    raise exc


@router.post("/", response_model=CostRecordResponse)
def create_cost_record(record: CostRecordCreate, db: Session = Depends(get_db)):
    try:
        new_record = svc.create_principal(db, record.model_dump())
        db.commit()
        db.refresh(new_record)
        return new_record
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _handle_domain_error(exc)


@router.get("/", response_model=List[CostRecordResponse])
def get_cost_records(
    skip: int = 0,
    limit: int = Query(100, le=1000),
    batch_id: Optional[int] = None,
    cost_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    include_revoked: bool = False,
    db: Session = Depends(get_db),
):
    try:
        query = svc.query_active(
            db, batch_id=batch_id, cost_type=cost_type,
            start=start_date, end=end_date, include_revoked=include_revoked,
        )
        return query.offset(skip).limit(limit).all()
    except svc.CostRuleError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/summary/", response_model=CostSummaryResponse)
def get_cost_summary(
    batch_id: Optional[int] = None,
    cost_type: Optional[str] = None,
    start_date: Optional[date] = None,
    end_date: Optional[date] = None,
    db: Session = Depends(get_db),
):
    """类型汇总,与列表、周期利润来自同一有效分录集合。"""
    try:
        filters = dict(batch_id=batch_id, cost_type=cost_type,
                       start=start_date, end=end_date)
        by_type_cents = svc.sum_by_type(db, **filters)
        known = ("feed", "medicine", "labor", "electricity", "other")
        known_set = set(known)
        other_extra = sum(v for k, v in by_type_cents.items() if k not in known_set)
        by_type = {}
        for t in known:
            cents = by_type_cents.get(t, 0) + (other_extra if t == "other" else 0)
            by_type[t] = {"amount_cents": cents, "amount": round(cents / 100, 2)}
        total = sum(v["amount_cents"] for v in by_type.values())
        return CostSummaryResponse(
            total_cents=total,
            total=round(total / 100, 2),
            by_type=by_type,
        )
    except svc.CostRuleError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/repair/scan", response_model=CostRepairScanResponse)
def scan_inconsistent_records(
    after_id: int = 0,
    limit: int = Query(500, le=2000),
    batch_id: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """只读扫描:列出金额与派生规则不一致的历史记录。可重复执行。"""
    issues = svc.find_issues(db, after_id=after_id, limit=limit, batch_id=batch_id)
    next_after_id = max((i.record_id for i in issues), default=after_id)
    return CostRepairScanResponse(
        scanned_window=len(issues),
        next_after_id=next_after_id,
        issues=[CostRepairIssue(
            record_id=i.record_id, cost_type=i.cost_type, reason=i.reason,
            current_amount_cents=i.current_amount_cents,
            expected_amount_cents=i.expected_amount_cents, fixable=i.fixable,
        ) for i in issues],
    )


@router.post("/repair/run", response_model=CostRepairStatusResponse)
def run_repair(payload: CostRepairRequest, db: Session = Depends(get_db)):
    """执行/续跑修复。同一 run_key 重复调用即续跑,不会重复入账。"""
    try:
        run = svc.run_repair(db, payload.run_key,
                             batch_size=payload.batch_size,
                             max_batches=payload.max_batches)
        return run
    except Exception as exc:  # noqa: BLE001
        if isinstance(exc, svc.CostRuleError):
            raise HTTPException(status_code=400, detail=str(exc))
        run = svc.repair_status(db, payload.run_key)
        raise HTTPException(
            status_code=500,
            detail={"message": f"修复中断,可用相同 run_key 续跑: {exc}",
                    "run": CostRepairStatusResponse.model_validate(run).model_dump()
                    if run else None},
        )


@router.get("/repair/{run_key}/", response_model=CostRepairStatusResponse)
def get_repair_status(run_key: str, db: Session = Depends(get_db)):
    run = svc.repair_status(db, run_key)
    if not run:
        raise HTTPException(status_code=404, detail="修复批次不存在")
    return run


@router.post("/{record_id}/adjustments/", response_model=CostRecordResponse)
def create_adjustment(record_id: int, payload: CostAdjustmentCreate,
                      db: Session = Depends(get_db)):
    """税费/折让/退款:生成关联分录,原账保持不变。"""
    try:
        adj = svc.create_adjustment(
            db, record_id,
            entry_kind=payload.entry_kind,
            amount=payload.amount,
            cost_date=payload.cost_date,
            description=payload.description,
            client_token=payload.client_token,
        )
        db.commit()
        db.refresh(adj)
        return adj
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _handle_domain_error(exc)


@router.get("/{record_id}/", response_model=CostRecordResponse)
def get_cost_record(record_id: int, db: Session = Depends(get_db)):
    record = db.query(CostRecord).filter(CostRecord.id == record_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="成本记录不存在")
    return record


@router.put("/{record_id}/", response_model=CostRecordResponse)
def update_cost_record(record_id: int, record: CostRecordUpdate,
                       db: Session = Depends(get_db)):
    try:
        data = record.model_dump(exclude={"version"}, exclude_unset=True)
        updated = svc.update_principal(
            db, record_id, data, expected_version=record.version
        )
        db.commit()
        db.refresh(updated)
        return updated
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _handle_domain_error(exc)


@router.post("/{record_id}/revoke/", response_model=CostRecordResponse)
def revoke_cost_record(record_id: int, payload: CostRevokeRequest = None,
                       db: Session = Depends(get_db)):
    """软撤销(保留原账),级联撤销关联调整分录。幂等。"""
    reason = payload.reason if payload else None
    try:
        record = svc.revoke_entry(db, record_id, reason)
        db.commit()
        db.refresh(record)
        return record
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _handle_domain_error(exc)


@router.delete("/{record_id}/")
def delete_cost_record(record_id: int, db: Session = Depends(get_db)):
    """DELETE 语义改为软撤销:历史账目不得物理删除。"""
    try:
        svc.revoke_entry(db, record_id, "通过 DELETE 撤销")
        db.commit()
        return {"message": "成本记录已撤销(保留原账)"}
    except Exception as exc:  # noqa: BLE001
        db.rollback()
        _handle_domain_error(exc)
