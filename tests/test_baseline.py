"""检查项目基线的入口、路由装配和本地存储约定。"""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class BaselineTest(unittest.TestCase):
    def test_backend_uses_sqlite_and_registers_domain_routers(self):
        database = (ROOT / "backend/app/database.py").read_text(encoding="utf-8")
        main = (ROOT / "backend/app/main.py").read_text(encoding="utf-8")
        self.assertIn("sqlite:///", database)
        for name in ("ponds", "batches", "stocking", "feeding", "water_quality", "medication", "costs", "harvest", "analysis"):
            self.assertIn(f"{name}.router", main)

    def test_frontend_exposes_a_build_script(self):
        package = json.loads((ROOT / "frontend/package.json").read_text(encoding="utf-8"))
        self.assertIn("build", package["scripts"])
        self.assertIn("react", package["dependencies"])


if __name__ == "__main__":
    unittest.main()
