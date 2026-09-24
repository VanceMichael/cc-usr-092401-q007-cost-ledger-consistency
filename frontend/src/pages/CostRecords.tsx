import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, X, DollarSign, Undo2, BadgePercent, Search, Wrench } from 'lucide-react';
import axios from 'axios';
import { costRecordApi, batchApi } from '../services/api';
import type {
  CostRecord, Batch, CostType, AdjustmentKind, CostSummary, CostRepairStatus,
} from '../types';

const COST_TYPES: { value: CostType; label: string }[] = [
  { value: 'feed', label: '饲料' },
  { value: 'medicine', label: '药品' },
  { value: 'labor', label: '人工' },
  { value: 'electricity', label: '电费' },
  { value: 'other', label: '其他' },
];

// 与后端 cost_service 保持一致:饲料/药品必须数量×单价,其余直接金额
const DERIVED_TYPES: CostType[] = ['feed', 'medicine'];
const UNIT_HINTS: Record<string, string[]> = {
  feed: ['kg', '公斤', '吨', 't', '袋', '斤', 'g', '克'],
  medicine: ['kg', '公斤', 'g', '克', '袋', '瓶', '盒', '箱', '升', 'l', 'ml', '毫升'],
};

const ENTRY_KIND_LABEL: Record<string, string> = {
  principal: '原账', tax: '税费', discount: '折让', refund: '退款', correction: '修正',
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const genToken = () => `fe-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

interface FormState {
  batch_id: string;
  cost_date: string;
  cost_type: CostType;
  amount: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  batch_id: '', cost_date: '', cost_type: 'feed', amount: '',
  description: '', quantity: '', unit: '', unit_price: '', notes: '',
};

const CostRecords: React.FC = () => {
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CostRecord | null>(null);
  const [formData, setFormData] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitToken, setSubmitToken] = useState<string>(genToken());

  // 日期范围筛选(闭区间,边界日由后端包含)
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showRevoked, setShowRevoked] = useState(false);

  // 调整分录弹窗
  const [adjustTarget, setAdjustTarget] = useState<CostRecord | null>(null);
  const [adjustKind, setAdjustKind] = useState<AdjustmentKind>('tax');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustDesc, setAdjustDesc] = useState('');
  const [adjustError, setAdjustError] = useState<string | null>(null);

  // 修复面板
  const [showRepair, setShowRepair] = useState(false);
  const [repairKey, setRepairKey] = useState('cost-repair-default');
  const [repairStatus, setRepairStatus] = useState<CostRepairStatus | null>(null);
  const [repairBusy, setRepairBusy] = useState(false);

  const buildQuery = () => ({
    startDate: startDate || undefined,
    endDate: endDate || undefined,
    includeRevoked: showRevoked || undefined,
  });

  const fetchData = async () => {
    try {
      const query = buildQuery();
      const [recordsRes, batchesRes, summaryRes] = await Promise.all([
        costRecordApi.getAll(query),
        batchApi.getAll(),
        costRecordApi.summary(query),
      ]);
      setRecords(recordsRes.data);
      setBatches(batchesRes.data);
      setSummary(summaryRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startDate, endDate, showRevoked]);

  const isDerived = DERIVED_TYPES.includes(formData.cost_type);

  // 派生类型:金额永远由数量×单价计算(与后端同一精度规则)
  const derivedPreview = useMemo(() => {
    if (!isDerived) return null;
    const q = parseFloat(formData.quantity);
    const p = parseFloat(formData.unit_price);
    if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) return null;
    return round2(q * p);
  }, [isDerived, formData.quantity, formData.unit_price]);

  const resetForm = () => {
    setEditingRecord(null);
    setFormData(EMPTY_FORM);
    setFormError(null);
    setSubmitToken(genToken());
  };

  const openCreate = () => {
    resetForm();
    setShowModal(true);
  };

  const handleTypeChange = (t: CostType) => {
    // 切换类型即清空另一套字段,避免数量/单价/金额互相污染
    setFormData(prev => ({
      ...prev,
      cost_type: t,
      amount: '',
      quantity: '',
      unit_price: '',
      unit: DERIVED_TYPES.includes(t) ? prev.unit : '',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const payload: Record<string, unknown> = {
      batch_id: parseInt(formData.batch_id, 10),
      cost_date: formData.cost_date,
      cost_type: formData.cost_type,
      description: formData.description || undefined,
      notes: formData.notes || undefined,
    };

    if (isDerived) {
      payload.quantity = parseFloat(formData.quantity);
      payload.unit_price = parseFloat(formData.unit_price);
      payload.unit = formData.unit.trim();
      // 金额不发送:由后端按 数量×单价 派生
    } else {
      payload.amount = parseFloat(formData.amount);
    }

    try {
      if (editingRecord) {
        payload.version = editingRecord.version;
        await costRecordApi.update(editingRecord.id, payload as never);
      } else {
        payload.client_token = submitToken;
        await costRecordApi.create(payload as never);
      }
      setShowModal(false);
      resetForm();
      fetchData();
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 409) {
        // 版本冲突:提示并刷新,让用户基于最新版本重新编辑
        const detail = error.response.data?.detail;
        setFormError(`记录已被他人修改(当前版本 ${detail?.current_version ?? '?'}),请刷新后重试`);
        fetchData();
        const latest = (await costRecordApi.getById(editingRecord!.id)).data;
        setEditingRecord(latest);
      } else if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        setFormError(typeof detail === 'string' ? detail : '提交失败,请检查输入');
      } else {
        setFormError('提交失败');
      }
    }
  };

  const handleEdit = (record: CostRecord) => {
    setEditingRecord(record);
    setFormData({
      batch_id: record.batch_id.toString(),
      cost_date: record.cost_date,
      cost_type: record.cost_type,
      amount: record.amount_mode === 'direct' ? record.amount.toString() : '',
      description: record.description || '',
      quantity: record.quantity?.toString() || '',
      unit: record.unit || '',
      unit_price: record.unit_price?.toString() || '',
      notes: record.notes || '',
    });
    setFormError(null);
    setShowModal(true);
  };

  const handleRevoke = async (record: CostRecord) => {
    const label = record.entry_kind === 'principal' ? '撤销这条记录(其税费/折让/退款将一并撤销)' : '撤销这条调整分录';
    if (!window.confirm(`确定要${label}吗?原账目会保留但不再计入汇总。`)) return;
    try {
      await costRecordApi.revoke(record.id, '前端人工撤销');
      fetchData();
    } catch (error) {
      console.error('Error revoking record:', error);
    }
  };

  const submitAdjustment = async () => {
    if (!adjustTarget) return;
    setAdjustError(null);
    const amt = parseFloat(adjustAmount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setAdjustError('请输入大于0的金额');
      return;
    }
    try {
      await costRecordApi.addAdjustment(adjustTarget.id, {
        entry_kind: adjustKind,
        amount: amt,
        description: adjustDesc || undefined,
        client_token: genToken(),
      });
      setAdjustTarget(null);
      setAdjustAmount('');
      setAdjustDesc('');
      fetchData();
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const detail = error.response?.data?.detail;
        setAdjustError(typeof detail === 'string' ? detail : '调整失败');
      }
    }
  };

  const runRepair = async () => {
    setRepairBusy(true);
    try {
      // 每次请求只跑一批,允许观察进度;同 run_key 天然续跑
      const res = await costRecordApi.repairRun({ run_key: repairKey, batch_size: 100, max_batches: 1 });
      setRepairStatus(res.data);
      if (res.data.status !== 'completed') {
        await runRepair(); // 续跑下一批
      } else {
        fetchData();
      }
    } catch (error) {
      console.error('Repair interrupted', error);
    } finally {
      setRepairBusy(false);
    }
  };

  const getBatchNumber = (batchId: number) =>
    batches.find(b => b.id === batchId)?.batch_number ?? '未知批次';
  const getCostTypeLabel = (type: string) =>
    COST_TYPES.find(t => t.value === type)?.label ?? type;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const typeAmount = (t: CostType) => summary?.by_type[t]?.amount ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">成本核算</h1>
          <p className="text-gray-600 mt-1">
            饲料、药品按数量×单价自动入账;税费/折让/退款以关联分录登记,不覆盖原账
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <button onClick={() => setShowRepair(v => !v)} className="btn-secondary flex items-center space-x-2">
            <Wrench size={18} />
            <span>数据修复</span>
          </button>
          <button onClick={openCreate} className="btn-primary flex items-center space-x-2">
            <Plus size={20} />
            <span>新增记录</span>
          </button>
        </div>
      </div>

      {showRepair && (
        <div className="card bg-yellow-50 border-yellow-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">历史不一致记录扫描与修正</h2>
          <p className="text-sm text-gray-600 mb-3">
            修正过程可中断续跑:同一修复批次键下每条记录只更正一次,重复执行不会重复入账。
          </p>
          <div className="flex items-center space-x-3">
            <input
              className="input-field"
              value={repairKey}
              onChange={e => setRepairKey(e.target.value)}
              placeholder="修复批次键(续跑时保持不变)"
            />
            <button onClick={runRepair} disabled={repairBusy || !repairKey} className="btn-primary whitespace-nowrap">
              {repairBusy ? '修正中…' : '执行/续跑修正'}
            </button>
          </div>
          {repairStatus && (
            <div className="mt-3 text-sm text-gray-700">
              状态:{repairStatus.status === 'completed' ? '已完成' : '进行中'} ·
              已扫描 {repairStatus.scanned} · 已修正 {repairStatus.repaired} ·
              跳过/待人工 {repairStatus.skipped} · 游标 id={repairStatus.last_id}
              {repairStatus.message && <div className="text-red-600 mt-1">{repairStatus.message}</div>}
            </div>
          )}
        </div>
      )}

      {/* 日期范围筛选(闭区间,边界日包含) */}
      <div className="card flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">开始日期(含)</label>
          <input type="date" className="input-field" value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">结束日期(含)</label>
          <input type="date" className="input-field" value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
        <button
          className="btn-secondary flex items-center space-x-2"
          onClick={() => { setStartDate(''); setEndDate(''); }}
        >
          <Search size={16} />
          <span>清除筛选</span>
        </button>
        <label className="flex items-center space-x-2 text-sm text-gray-700 ml-auto">
          <input type="checkbox" checked={showRevoked} onChange={e => setShowRevoked(e.target.checked)} />
          <span>显示已撤销记录</span>
        </label>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card bg-red-50">
          <div className="flex items-center space-x-3">
            <DollarSign className="text-red-600" size={24} />
            <div>
              <p className="text-sm text-red-600">总成本(净额)</p>
              <p className="text-2xl font-bold text-red-700">
                ¥{(summary?.total ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-orange-50">
          <div className="flex items-center space-x-3">
            <DollarSign className="text-orange-600" size={24} />
            <div>
              <p className="text-sm text-orange-600">饲料成本</p>
              <p className="text-2xl font-bold text-orange-700">
                ¥{typeAmount('feed').toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-purple-50">
          <div className="flex items-center space-x-3">
            <DollarSign className="text-purple-600" size={24} />
            <div>
              <p className="text-sm text-purple-600">药品成本</p>
              <p className="text-2xl font-bold text-purple-700">
                ¥{typeAmount('medicine').toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>批次号</th>
                <th>日期</th>
                <th>费用类型</th>
                <th>分录</th>
                <th>金额(元,净额)</th>
                <th>描述</th>
                <th>数量</th>
                <th>单位</th>
                <th>单价</th>
                <th>版本</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => {
                const revoked = record.status === 'revoked';
                const isPrincipal = record.entry_kind === 'principal';
                return (
                  <tr key={record.id} className={revoked ? 'opacity-50 line-through' : ''}>
                    <td className="font-medium text-ocean-700">{getBatchNumber(record.batch_id)}</td>
                    <td>{record.cost_date}</td>
                    <td>
                      <span className={`badge ${
                        record.cost_type === 'feed' ? 'badge-warning' :
                        record.cost_type === 'medicine' ? 'badge-danger' : 'badge-info'
                      }`}>
                        {getCostTypeLabel(record.cost_type)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${isPrincipal ? 'badge-info' : 'badge-warning'}`}>
                        {ENTRY_KIND_LABEL[record.entry_kind] || record.entry_kind}
                        {record.parent_id ? ` #${record.parent_id}` : ''}
                      </span>
                      {revoked && <span className="badge badge-danger ml-1">已撤销</span>}
                    </td>
                    <td className={`font-medium ${record.amount_cents < 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {record.amount_cents < 0 ? '-' : ''}¥{Math.abs(record.amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td>{record.description || '-'}</td>
                    <td>{record.quantity ?? '-'}</td>
                    <td>{record.unit || '-'}</td>
                    <td>{record.unit_price != null ? `¥${record.unit_price}` : '-'}</td>
                    <td className="text-gray-400">v{record.version}</td>
                    <td>
                      <div className="flex items-center space-x-2">
                        {isPrincipal && !revoked && (
                          <button
                            onClick={() => handleEdit(record)}
                            title="编辑(版本冲突保护)"
                            className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                          >
                            <Edit2 size={18} />
                          </button>
                        )}
                        {isPrincipal && !revoked && (
                          <button
                            onClick={() => {
                              setAdjustTarget(record);
                              setAdjustKind('tax');
                              setAdjustAmount('');
                              setAdjustDesc('');
                              setAdjustError(null);
                            }}
                            title="登记税费/折让/退款(关联分录)"
                            className="p-2 text-yellow-600 hover:bg-yellow-50 rounded-lg transition-colors"
                          >
                            <BadgePercent size={18} />
                          </button>
                        )}
                        {!revoked && (
                          <button
                            onClick={() => handleRevoke(record)}
                            title="撤销(保留原账)"
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          >
                            <Undo2 size={18} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {records.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center py-8 text-gray-500">
                    暂无成本记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {editingRecord ? `编辑成本记录(当前 v${editingRecord.version})` : '新增成本记录'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-2 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    养殖批次 <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={formData.batch_id}
                    onChange={e => setFormData({ ...formData, batch_id: e.target.value })}
                    className="select-field"
                  >
                    <option value="">请选择批次</option>
                    {batches.map(batch => (
                      <option key={batch.id} value={batch.id}>
                        {batch.batch_number} - {batch.species}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    费用日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date" required
                    value={formData.cost_date}
                    onChange={e => setFormData({ ...formData, cost_date: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  费用类型 <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={formData.cost_type}
                  onChange={e => handleTypeChange(e.target.value as CostType)}
                  className="select-field"
                >
                  {COST_TYPES.map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {isDerived ? (
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      数量 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number" step="0.001" min="0" required
                      value={formData.quantity}
                      onChange={e => setFormData({ ...formData, quantity: e.target.value })}
                      className="input-field" placeholder="数量"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      单位 <span className="text-red-500">*</span>
                    </label>
                    <input
                      list="unit-hints" required
                      value={formData.unit}
                      onChange={e => setFormData({ ...formData, unit: e.target.value })}
                      className="input-field" placeholder="如 kg、袋"
                    />
                    <datalist id="unit-hints">
                      {(UNIT_HINTS[formData.cost_type] || []).map(u => <option key={u} value={u} />)}
                    </datalist>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      单价 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number" step="0.0001" min="0" required
                      value={formData.unit_price}
                      onChange={e => setFormData({ ...formData, unit_price: e.target.value })}
                      className="input-field" placeholder="单价"
                    />
                  </div>
                  <div className="col-span-3 p-3 bg-ocean-50 rounded-lg text-sm text-ocean-800">
                    金额由系统计算,不可手填:
                    <span className="font-bold ml-1">
                      ¥{derivedPreview != null ? derivedPreview.toLocaleString(undefined, { minimumFractionDigits: 2 }) : '—'}
                    </span>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    金额(元) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number" step="0.01" min="0" required
                    value={formData.amount}
                    onChange={e => setFormData({ ...formData, amount: e.target.value })}
                    className="input-field" placeholder="直接填写金额"
                  />
                  <p className="text-xs text-gray-500 mt-1">该费用类型直接登记金额,不接受数量/单价。</p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">费用描述</label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  className="input-field" placeholder="费用描述"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
                <textarea
                  value={formData.notes}
                  onChange={e => setFormData({ ...formData, notes: e.target.value })}
                  className="input-field" rows={3} placeholder="备注信息"
                />
              </div>

              {formError && (
                <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm whitespace-pre-wrap">{formError}</div>
              )}

              <div className="flex justify-end space-x-3 pt-4">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">取消</button>
                <button type="submit" className="btn-primary">
                  {editingRecord ? '保存修改' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 税费/折让/退款弹窗 */}
      {adjustTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900">
                登记关联分录 — 原账 #{adjustTarget.id}
              </h2>
              <button onClick={() => setAdjustTarget(null)} className="p-2 text-gray-400 hover:text-gray-600">
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              原账金额保持不变;新分录以税费(加)或折让/退款(减)计入净额,折让退款累计不能超过原费用净额。
            </p>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                {(['tax', 'discount', 'refund'] as AdjustmentKind[]).map(k => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setAdjustKind(k)}
                    className={`py-2 rounded-lg border text-sm ${
                      adjustKind === k ? 'border-ocean-500 bg-ocean-50 font-medium' : 'border-gray-200'
                    }`}
                  >
                    {k === 'tax' ? '税费(+)' : k === 'discount' ? '折让(-)' : '退款(-)'}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">金额(元,正数)</label>
                <input
                  type="number" step="0.01" min="0"
                  className="input-field" value={adjustAmount}
                  onChange={e => setAdjustAmount(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">说明</label>
                <input
                  type="text" className="input-field" value={adjustDesc}
                  onChange={e => setAdjustDesc(e.target.value)}
                />
              </div>
              {adjustError && <div className="p-3 bg-red-100 text-red-700 rounded-lg text-sm">{adjustError}</div>}
              <div className="flex justify-end space-x-3">
                <button type="button" onClick={() => setAdjustTarget(null)} className="btn-secondary">取消</button>
                <button type="button" onClick={submitAdjustment} className="btn-primary">登记</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CostRecords;
