from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import relationship, backref
from datetime import datetime
from .database import Base

class Pond(Base):
    __tablename__ = "ponds"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(100), unique=True, index=True, nullable=False)
    area = Column(Float, nullable=False, comment="面积(亩)")
    water_depth = Column(Float, nullable=False, comment="水深(米)")
    species = Column(String(100), comment="养殖品种")
    status = Column(String(20), default="active", comment="状态: active, inactive")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    batches = relationship("Batch", back_populates="pond")

class Batch(Base):
    __tablename__ = "batches"

    id = Column(Integer, primary_key=True, index=True)
    batch_number = Column(String(50), unique=True, index=True, nullable=False, comment="批次号")
    pond_id = Column(Integer, ForeignKey("ponds.id"), nullable=False)
    species = Column(String(100), nullable=False, comment="养殖品种")
    stocking_date = Column(Date, nullable=False, comment="放苗日期")
    estimated_harvest_date = Column(Date, comment="预计收获日期")
    actual_harvest_date = Column(Date, comment="实际收获日期")
    status = Column(String(20), default="active", comment="状态: active, harvested, closed")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    pond = relationship("Pond", back_populates="batches")
    stocking_records = relationship("StockingRecord", back_populates="batch")
    feeding_records = relationship("FeedingRecord", back_populates="batch")
    water_quality_records = relationship("WaterQualityRecord", back_populates="batch")
    medication_records = relationship("MedicationRecord", back_populates="batch")
    cost_records = relationship("CostRecord", back_populates="batch")
    harvest_sales = relationship("HarvestSale", back_populates="batch")

class StockingRecord(Base):
    __tablename__ = "stocking_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    species = Column(String(100), nullable=False, comment="品种")
    quantity = Column(Integer, nullable=False, comment="数量(尾)")
    source = Column(String(200), comment="来源")
    batch_number = Column(String(50), comment="苗种批次号")
    weight_per_unit = Column(Float, comment="单重(克/尾)")
    total_weight = Column(Float, comment="总重量(公斤)")
    notes = Column(Text, comment="备注")
    created_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("Batch", back_populates="stocking_records")

class FeedingRecord(Base):
    __tablename__ = "feeding_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    feeding_date = Column(Date, nullable=False, comment="投喂日期")
    feed_type = Column(String(100), nullable=False, comment="饲料类型")
    feed_quantity = Column(Float, nullable=False, comment="投喂量(公斤)")
    feeding_time = Column(String(20), comment="投喂时间")
    weather = Column(String(50), comment="天气情况")
    water_temperature = Column(Float, comment="水温(℃)")
    notes = Column(Text, comment="备注")
    created_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("Batch", back_populates="feeding_records")

class WaterQualityRecord(Base):
    __tablename__ = "water_quality_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    record_date = Column(Date, nullable=False, comment="检测日期")
    record_time = Column(String(20), comment="检测时间")
    water_temperature = Column(Float, comment="水温(℃)")
    ph_value = Column(Float, comment="pH值")
    dissolved_oxygen = Column(Float, comment="溶解氧(mg/L)")
    ammonia_nitrogen = Column(Float, comment="氨氮(mg/L)")
    nitrite = Column(Float, comment="亚硝酸盐(mg/L)")
    transparency = Column(Float, comment="透明度(cm)")
    notes = Column(Text, comment="备注")
    created_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("Batch", back_populates="water_quality_records")

class MedicationRecord(Base):
    __tablename__ = "medication_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    medication_date = Column(Date, nullable=False, comment="用药日期")
    drug_name = Column(String(200), nullable=False, comment="药品名称")
    drug_type = Column(String(50), comment="药品类型")
    dosage = Column(Float, comment="用量")
    dosage_unit = Column(String(20), default="kg", comment="用量单位")
    administration_method = Column(String(100), comment="施用方法")
    purpose = Column(String(200), comment="用途")
    manufacturer = Column(String(200), comment="生产厂家")
    batch_number = Column(String(50), comment="药品批次号")
    notes = Column(Text, comment="备注")
    created_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("Batch", back_populates="medication_records")

class CostRecord(Base):
    __tablename__ = "cost_records"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    cost_date = Column(Date, nullable=False, comment="费用日期")
    cost_type = Column(String(50), nullable=False, comment="费用类型: feed, medicine, labor, electricity, other")
    # amount 为历史浮点列,保留兼容;amount_cents 是唯一参与汇总的规范金额(分)
    amount = Column(Float, nullable=False, comment="金额(元), 与 amount_cents 同步")
    amount_cents = Column(Integer, nullable=True, comment="规范金额(分), 唯一参与汇总")
    description = Column(String(500), comment="费用描述")
    quantity = Column(Float, comment="数量")
    unit = Column(String(20), comment="单位")
    unit_price = Column(Float, comment="单价")
    # 金额来源: derived=数量×单价; direct=直接金额
    amount_mode = Column(String(10), nullable=False, default="direct", comment="derived / direct")
    # 分录性质: principal=原始费用; tax=税费; discount=折让; refund=退款; correction=修正补差
    entry_kind = Column(String(10), nullable=False, default="principal",
                        comment="principal/tax/discount/refund/correction")
    # 调整/撤销链:税费、折让、退款以关联分录表达,不覆盖原账
    parent_id = Column(Integer, ForeignKey("cost_records.id"), nullable=True, comment="关联原分录")
    status = Column(String(10), nullable=False, default="active", comment="active / revoked")
    revoked_reason = Column(String(200), nullable=True)
    version = Column(Integer, nullable=False, default=1, comment="乐观锁版本号")
    client_token = Column(String(64), nullable=True, comment="幂等键")
    notes = Column(Text, comment="备注")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("client_token", name="uq_cost_records_client_token"),
    )

    batch = relationship("Batch", back_populates="cost_records")
    children = relationship("CostRecord", backref=backref("parent", remote_side="CostRecord.id"))


class CostRepairRun(Base):
    """历史不一致数据修复批次台账:同一条目只成功一次,可中断续跑。"""
    __tablename__ = "cost_repair_runs"

    id = Column(Integer, primary_key=True, index=True)
    run_key = Column(String(64), unique=True, nullable=False, index=True, comment="修复批次幂等键")
    status = Column(String(20), nullable=False, default="running", comment="running/completed/failed")
    last_id = Column(Integer, nullable=False, default=0, comment="已扫描到的最大记录 id(续跑游标)")
    scanned = Column(Integer, nullable=False, default=0)
    repaired = Column(Integer, nullable=False, default=0)
    skipped = Column(Integer, nullable=False, default=0)
    message = Column(String(500), nullable=True)
    started_at = Column(DateTime, default=datetime.utcnow)
    finished_at = Column(DateTime, nullable=True)


class CostRepairLog(Base):
    """单条修复记录:唯一约束防止同批次对同一分录重复入账。"""
    __tablename__ = "cost_repair_logs"

    id = Column(Integer, primary_key=True, index=True)
    run_key = Column(String(64), ForeignKey("cost_repair_runs.run_key"), nullable=False, index=True)
    record_id = Column(Integer, nullable=False, index=True)
    action = Column(String(20), nullable=False, comment="fixed_amount/noop")
    old_amount_cents = Column(Integer, nullable=True)
    new_amount_cents = Column(Integer, nullable=True)
    detail = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("run_key", "record_id", name="uq_repair_log_run_record"),
    )

class HarvestSale(Base):
    __tablename__ = "harvest_sales"

    id = Column(Integer, primary_key=True, index=True)
    batch_id = Column(Integer, ForeignKey("batches.id"), nullable=False)
    sale_date = Column(Date, nullable=False, comment="销售日期")
    weight = Column(Float, nullable=False, comment="重量(公斤)")
    unit_price = Column(Float, nullable=False, comment="单价(元/公斤)")
    total_amount = Column(Float, comment="总金额(元)")
    buyer = Column(String(200), comment="买家")
    batch_number = Column(String(50), comment="追溯批次号")
    quality_grade = Column(String(50), comment="质量等级")
    notes = Column(Text, comment="备注")
    created_at = Column(DateTime, default=datetime.utcnow)

    batch = relationship("Batch", back_populates="harvest_sales")
