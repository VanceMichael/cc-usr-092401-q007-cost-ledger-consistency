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
