#!/usr/bin/env python3
"""历史成本不一致记录扫描与修正 CLI。

可重复执行;使用固定/指定 run_key 续跑,同一 run_key 下每条记录只入账一次。

用法:
  python -m scripts.repair_costs scan                 # 只读扫描全部问题
  python -m scripts.repair_costs run [--run-key KEY]  # 执行/续跑修正
  python -m scripts.repair_costs status --run-key KEY # 查看进度
"""
import argparse
import sys
import uuid

from sqlalchemy.orm import Session

from backend.app.database import SessionLocal
from backend.app.services import cost_service as svc

DEFAULT_RUN_KEY = "cost-repair-default"


def cmd_scan(db: Session, args) -> int:
    after_id = 0
    total = 0
    while True:
        issues = svc.find_issues(db, after_id=after_id, limit=args.page_size,
                                 batch_id=args.batch_id)
        if not issues:
            break
        for it in issues:
            total += 1
            print(f"#{it.record_id} [{it.cost_type}] {it.reason} "
                  f"current={it.current_amount_cents} "
                  f"expected={it.expected_amount_cents} "
                  f"fixable={it.fixable}")
        after_id = issues[-1].record_id
    print(f"扫描完成:共 {total} 条问题记录")
    return 0


def cmd_run(db: Session, args) -> int:
    run_key = args.run_key or DEFAULT_RUN_KEY
    while True:
        run = svc.run_repair(db, run_key, batch_size=args.batch_size,
                             max_batches=1)
        print(f"已扫描 {run.scanned} / 修正 {run.repaired} / 跳过 {run.skipped}"
              f" (游标 id={run.last_id}, 状态={run.status})")
        if run.status == "completed":
            break
    print(f"修复完成:run_key={run_key}")
    return 0


def cmd_status(db: Session, args) -> int:
    run = svc.repair_status(db, args.run_key)
    if not run:
        print("修复批次不存在")
        return 1
    print(f"run_key={run.run_key} status={run.status} "
          f"scanned={run.scanned} repaired={run.repaired} "
          f"skipped={run.skipped} last_id={run.last_id}")
    if run.message:
        print(f"message: {run.message}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="成本账一致性扫描与修正")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_scan = sub.add_parser("scan", help="只读扫描不一致记录")
    p_scan.add_argument("--batch-id", type=int, default=None)
    p_scan.add_argument("--page-size", type=int, default=500)
    p_scan.set_defaults(func=cmd_scan)

    p_run = sub.add_parser("run", help="执行/续跑修正")
    p_run.add_argument("--run-key", default=DEFAULT_RUN_KEY)
    p_run.add_argument("--batch-size", type=int, default=200)
    p_run.set_defaults(func=cmd_run)

    p_status = sub.add_parser("status", help="查看修复进度")
    p_status.add_argument("--run-key", default=DEFAULT_RUN_KEY)
    p_status.set_defaults(func=cmd_status)

    args = parser.parse_args(argv)
    db = SessionLocal()
    try:
        return args.func(db, args)
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
