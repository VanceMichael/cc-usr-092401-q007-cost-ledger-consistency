# 成本明细与汇总失配修复

这是水产养殖管理系统，后端维护塘口、养殖批次、投苗、投喂、水质、用药、成本和出塘销售资料，前端提供日常录入与周期分析页面。数据默认保存在 SQLite 文件中。

## 成本账规则

- **金额来源按费用类型决定**：`feed`/`medicine` 为派生类型，金额必须由 `数量 × 单价` 在服务端计算（客户端传入的金额会被忽略）；`labor`/`electricity`/`other` 为直接类型，直接填写金额。
- **统一货币精度**：金额保留两位小数（分），数量/单价保留四位小数；拒绝负数、NaN/Infinity 及白名单之外的单位。
- **税费/折让/退款**：通过 `POST /api/cost-records/{id}/adjustments/` 登记为关联分录（`parent_id` 指向原费用），原账不被覆盖；折让/退款在汇总中带负号。
- **撤销代替删除**：`POST /api/cost-records/{id}/void/` 只置状态保留痕迹；物理删除接口已禁用（410）。已撤销记录不参与列表、汇总与周期利润。
- **并发保护**：`PUT` 必须携带读取时的 `version`，版本不匹配返回 409。
- **同一有效分录集合**：成本列表、`/api/cost-records/summary/`、周期利润分析与前端汇总均只统计 `active` 分录；日期筛选为含边界日的闭区间。

## 存量数据扫描与修复

不一致的历史记录（金额与数量×单价矛盾、负数费用、精度越界、非法单位等）提供可重复执行的扫描与修复流程：

```bash
# 命令行(在仓库根目录)
python3 backend/repair_costs.py scan              # 只读扫描
python3 backend/repair_costs.py repair --dry-run  # 预演修复
python3 backend/repair_costs.py repair            # 执行修复
python3 backend/repair_costs.py reset             # 重置游标从头再跑

# 或 HTTP 接口(每批一次调用, 便于外部调度)
POST /api/cost-records/maintenance/scan?batch_size=100
POST /api/cost-records/maintenance/repair?batch_size=100&dry_run=false
POST /api/cost-records/maintenance/reset
```

修复按批提交、游标持久化在 `cost_migration_state` 表，可中断续跑；已修复行带 `repair_revision` 标记，重复执行不会重复入账。负数费用自动转为关联的退款分录（原账归零），无法安全自动修复的记录只标记上报、不猜值。

## 测试命令

在仓库根目录执行：

```bash
python3 -m unittest discover -s tests -v
```

## 编译与构建命令

先安装前端依赖，再检查后端并构建前端：

```bash
python3 -m compileall -q backend/app
npm --prefix frontend install --legacy-peer-deps
npm --prefix frontend run build
```

本地启动可使用 `docker compose up --build`。开发环境不得提交真实账号、连接凭据或生产数据。
