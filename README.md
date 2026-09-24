# 成本明细与汇总失配修复

这是水产养殖管理系统，后端维护塘口、养殖批次、投苗、投喂、水质、用药、成本和出塘销售资料，前端提供日常录入与周期分析页面。数据默认保存在 SQLite 文件中。

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

## 成本账规则

- 费用类型决定金额来源：`feed`（饲料）、`medicine`（药品）必须填写数量、合法单位与单价，金额由数量×单价经 Decimal 四舍五入到分派生，手填金额与派生值矛盾时返回 400；`labor`（人工）、`electricity`（电费）、`other`（其他）只接受直接金额，不接受数量/单价。
- 金额以 `amount_cents`（分，整数）为唯一汇总口径，拒绝负数、NaN/Infinity 与非法单位。
- 税费（+）、折让（-）、退款（-）以关联子分录表达，原账永不覆盖；折让/退款累计不得超过原费用净额。
- 记录只能软撤销（DELETE 同样软撤销）并级联撤销其调整分录；列表、类型汇总（`/api/cost-records/summary/`）、周期利润、批次追溯共用同一有效分录集合（`status=active`、日期闭区间含边界日）。
- 编辑必须回传 `version`，过期版本返回 409；创建/调整可带 `client_token` 实现幂等。

## 历史不一致数据的扫描与修正

扫描为只读、可重复执行：

```bash
curl -X POST "http://localhost:8000/api/cost-records/repair/scan?after_id=0&limit=500"
```

修正按 `run_key` 分批执行，可中断、可续跑：同 `run_key` 下每条记录只入账一次（`(run_key, record_id)` 唯一约束），每批独立提交，重复执行已完成的批次直接返回。也可用 CLI：

```bash
python3 -m scripts.repair_costs scan
python3 -m scripts.repair_costs run --run-key cost-repair-default
python3 -m scripts.repair_costs status --run-key cost-repair-default
```

缺少数量/单价、金额为负等无法自动判定的记录只登记为"需人工处理"，不会被自动改动。
