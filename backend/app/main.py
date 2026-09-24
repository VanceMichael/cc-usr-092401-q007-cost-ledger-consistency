from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from .database import engine, Base
from .migrations import run_migrations
from .routers import ponds, batches, stocking, feeding, water_quality, medication, costs, harvest, analysis

Base.metadata.create_all(bind=engine)
run_migrations(engine)

app = FastAPI(
    title="水产养殖管理系统",
    description="一个完整的水产养殖管理系统，支持塘口管理、投苗记录、日常管理、成本核算、出塘销售和养殖周期分析",
    version="1.0.0"
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # NaN/Infinity/异常对象等不是合法 JSON，统一清洗 error 后再返回
    def _safe(value):
        import math
        if isinstance(value, float) and not math.isfinite(value):
            return str(value)
        if isinstance(value, (str, int, bool)) or value is None:
            return value
        if isinstance(value, dict):
            return {k: _safe(v) for k, v in value.items()}
        if isinstance(value, (list, tuple)):
            return [_safe(v) for v in value]
        return str(value)

    safe_errors = []
    for err in exc.errors():
        safe_errors.append({k: _safe(v) for k, v in dict(err).items()})
    return JSONResponse(status_code=422, content={"detail": safe_errors})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ponds.router)
app.include_router(batches.router)
app.include_router(stocking.router)
app.include_router(feeding.router)
app.include_router(water_quality.router)
app.include_router(medication.router)
app.include_router(costs.router)
app.include_router(harvest.router)
app.include_router(analysis.router)

@app.get("/")
def root():
    return {
        "message": "欢迎使用水产养殖管理系统API",
        "docs": "/docs",
        "version": "1.0.0"
    }

@app.get("/health")
def health_check():
    return {"status": "healthy"}
