#!/usr/bin/env python3
"""存量成本数据扫描与修复命令行工具。

用法:
    python backend/repair_costs.py scan                 # 只读扫描, 分批打印不一致项
    python backend/repair_costs.py repair --dry-run     # 预演修复, 不落库
    python backend/repair_costs.py repair               # 执行修复
    python backend/repair_costs.py reset                # 重置游标从头再跑

特性:
- 每批独立提交, 游标持久化在 cost_migration_state, Ctrl+C 中断后重跑自动续跑;
- 已修复行带 repair_revision 标记, 重跑跳过, 不会重复入账;
- 修复规则见 app/cost_migration.py(派生类型重算金额、负数费用转退款分录)。
"""
import argparse
import sys
from pathlib import Path

# 允许 `python backend/repair_costs.py` 直接运行
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.cost_migration import (  # noqa: E402
    DEFAULT_BATCH_SIZE,
    repair_batch,
    reset_cursors,
    scan_batch,
)
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402,F401  (导入即确保表结构与列迁移完成)


def run_scan(batch_size: int) -> int:
    db = SessionLocal()
    total_issues = 0
    total_scanned = 0
    try:
        while True:
            report = scan_batch(db, batch_size=batch_size)
            total_scanned += report["scanned"]
            total_issues += len(report["issues"])
            print(f"扫描 {report['scanned']} 条 (累计 {total_scanned}), "
                  f"本批问题 {len(report['issues'])}")
            for issue in report["issues"]:
                print(f"  - 记录 #{issue['record_id']} [{issue['issue']}]: {issue['detail']}")
            if report["done"]:
                break
    except KeyboardInterrupt:
        print("\n已中断, 游标已保存; 重新运行即可从断点继续。")
        return 130
    finally:
        db.close()
    print(f"扫描完成: 共 {total_scanned} 条, {total_issues} 个问题")
    return 0 if total_issues == 0 else 2


def run_repair(batch_size: int, dry_run: bool) -> int:
    db = SessionLocal()
    totals = {"processed": 0, "fixed": 0, "converted": 0, "flagged": 0}
    cursor = None
    try:
        while True:
            report = repair_batch(db, batch_size=batch_size, dry_run=dry_run, cursor=cursor)
            for key in ("processed", "fixed", "converted", "flagged"):
                totals[key] += report[key]
            print(
                f"{'[预演] ' if dry_run else ''}本批处理 {report['processed']} 条: "
                f"重算 {report['fixed']}, 转退款 {report['converted']}, "
                f"待人工处理 {report['flagged']}"
            )
            for issue in report["issues"]:
                print(f"  ! 记录 #{issue['record_id']} [{issue['issue']}]: {issue['detail']}")
            if report["done"]:
                break
            if dry_run:
                # 预演不推进持久游标, 仅在内存中继续
                cursor = report["next_cursor"]
    except KeyboardInterrupt:
        print("\n已中断, 已修复批次不回滚; 重新运行将从断点续跑且不重复入账。")
        return 130
    finally:
        db.close()
    print(
        f"{'预演' if dry_run else '修复'}完成: 处理 {totals['processed']} 条, "
        f"重算 {totals['fixed']}, 转退款 {totals['converted']}, "
        f"待人工处理 {totals['flagged']}"
    )
    return 0 if totals["flagged"] == 0 else 2


def main() -> int:
    parser = argparse.ArgumentParser(description="成本账存量数据扫描与修复")
    sub = parser.add_subparsers(dest="command", required=True)

    p_scan = sub.add_parser("scan", help="只读扫描不一致记录")
    p_scan.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)

    p_repair = sub.add_parser("repair", help="修复不一致记录")
    p_repair.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    p_repair.add_argument("--dry-run", action="store_true", help="只预演不落库")

    sub.add_parser("reset", help="重置扫描/修复游标")

    args = parser.parse_args()

    if args.command == "scan":
        return run_scan(args.batch_size)
    if args.command == "repair":
        return run_repair(args.batch_size, args.dry_run)
    if args.command == "reset":
        db = SessionLocal()
        try:
            reset_cursors(db)
        finally:
            db.close()
        print("游标已重置")
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
