import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Ban, X, DollarSign, Receipt } from 'lucide-react';
import axios from 'axios';
import { costRecordApi, batchApi } from '../services/api';
import type { CostRecord, Batch, CostSummaryResult } from '../types';

const costTypes = [
  { value: 'feed', label: '饲料' },
  { value: 'medicine', label: '药品' },
  { value: 'labor', label: '人工' },
  { value: 'electricity', label: '电费' },
  { value: 'other', label: '其他' },
];

// 与后端一致: 饲料/药品的金额必须由 数量*单价 派生
const derivedTypes = ['feed', 'medicine'];

const unitOptions: Record<string, string[]> = {
  feed: ['kg', 'g', '吨', '公斤', '克', '袋', '包', '箱'],
  medicine: ['kg', 'g', 'L', 'ml', '公斤', '克', '升', '毫升', '瓶', '袋', '盒', '支'],
};

const entryKindLabels: Record<string, string> = {
  expense: '费用',
  tax: '税费',
  allowance: '折让',
  refund: '退款',
};

const emptyForm = {
  batch_id: '',
  cost_date: '',
  cost_type: 'feed',
  amount: '',
  description: '',
  quantity: '',
  unit: '',
  unit_price: '',
  notes: '',
};

const emptyAdjustment = {
  kind: 'tax' as 'tax' | 'allowance' | 'refund',
  amount: '',
  adjustment_date: '',
  description: '',
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const CostRecords: React.FC = () => {
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [summary, setSummary] = useState<CostSummaryResult | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CostRecord | null>(null);
  const [formData, setFormData] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    batch_id: '',
    cost_type: '',
    start_date: '',
    end_date: '',
    include_voided: false,
  });
  const [adjustTarget, setAdjustTarget] = useState<CostRecord | null>(null);
  const [adjustmentForm, setAdjustmentForm] = useState(emptyAdjustment);

  const isDerived = derivedTypes.includes(formData.cost_type);

  // 派生类型: 金额实时由 数量*单价 计算, 不允许手填
  const derivedAmount = useMemo(() => {
    const q = parseFloat(formData.quantity);
    const p = parseFloat(formData.unit_price);
    if (Number.isFinite(q) && Number.isFinite(p)) {
      return round2(q * p).toFixed(2);
    }
    return '';
  }, [formData.quantity, formData.unit_price]);

  const currentFilters = () => ({
    batchId: filters.batch_id ? parseInt(filters.batch_id) : undefined,
    costType: filters.cost_type || undefined,
    startDate: filters.start_date || undefined,
    endDate: filters.end_date || undefined,
    includeVoided: filters.include_voided,
  });

  const extractError = (err: unknown, fallback: string) => {
    if (axios.isAxiosError(err) && err.response?.data?.detail) {
      const detail = err.response.data.detail;
      if (typeof detail === 'string') return detail;
      if (detail.message) return detail.message;
      if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
    }
    return fallback;
  };

  const fetchData = async () => {
    try {
      const f = currentFilters();
      const [recordsRes, summaryRes, batchesRes] = await Promise.all([
        costRecordApi.getAll(f),
        costRecordApi.getSummary(f),
        batchApi.getAll(),
      ]);
      setRecords(recordsRes.data);
      setSummary(summaryRes.data);
      setBatches(batchesRes.data);
      setError(null);
    } catch (err) {
      setError(extractError(err, '加载数据失败'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        batch_id: parseInt(formData.batch_id),
        cost_date: formData.cost_date,
        cost_type: formData.cost_type,
        description: formData.description || undefined,
        notes: formData.notes || undefined,
        quantity: formData.quantity ? parseFloat(formData.quantity) : undefined,
        unit: formData.unit || undefined,
        unit_price: formData.unit_price ? parseFloat(formData.unit_price) : undefined,
      };
      // 派生类型金额由服务端计算; 直接类型提交手填金额
      payload.amount = isDerived
        ? (derivedAmount ? parseFloat(derivedAmount) : undefined)
        : parseFloat(formData.amount);

      if (editingRecord) {
        // 乐观锁: 携带读取时的版本号
        await costRecordApi.update(editingRecord.id, {
          ...payload,
          version: editingRecord.version,
        } as Partial<CostRecord> & { version: number });
      } else {
        await costRecordApi.create(payload);
      }

      setShowModal(false);
      setEditingRecord(null);
      setFormData(emptyForm);
      fetchData();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 409) {
        setError('该记录已被其他人修改, 请关闭后重新编辑');
        fetchData();
      } else {
        setError(extractError(err, '保存失败'));
      }
    }
  };

  const handleEdit = (record: CostRecord) => {
    setEditingRecord(record);
    setFormData({
      batch_id: record.batch_id.toString(),
      cost_date: record.cost_date,
      cost_type: record.cost_type,
      amount: record.amount.toString(),
      description: record.description || '',
      quantity: record.quantity?.toString() || '',
      unit: record.unit || '',
      unit_price: record.unit_price?.toString() || '',
      notes: record.notes || '',
    });
    setError(null);
    setShowModal(true);
  };

  const handleVoid = async (record: CostRecord) => {
    if (window.confirm(`确定要撤销这条${entryKindLabels[record.entry_kind] || '费用'}记录吗？撤销后不再计入汇总。`)) {
      try {
        await costRecordApi.void(record.id);
        fetchData();
      } catch (err) {
        setError(extractError(err, '撤销失败'));
      }
    }
  };

  const handleAdjustmentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adjustTarget) return;
    try {
      await costRecordApi.addAdjustment(adjustTarget.id, {
        kind: adjustmentForm.kind,
        amount: parseFloat(adjustmentForm.amount),
        adjustment_date: adjustmentForm.adjustment_date,
        description: adjustmentForm.description || undefined,
      });
      setAdjustTarget(null);
      setAdjustmentForm(emptyAdjustment);
      fetchData();
    } catch (err) {
      setError(extractError(err, '登记调整失败'));
    }
  };

  const getBatchNumber = (batchId: number) => {
    const batch = batches.find(b => b.id === batchId);
    return batch ? batch.batch_number : '未知批次';
  };

  const getCostTypeLabel = (type: string) => {
    const costType = costTypes.find(t => t.value === type);
    return costType ? costType.label : type;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">成本核算</h1>
          <p className="text-gray-600 mt-1">记录和分析养殖成本(饲料/药品金额由数量×单价自动计算)</p>
        </div>
        <button
          onClick={() => {
            setEditingRecord(null);
            setFormData(emptyForm);
            setError(null);
            setShowModal(true);
          }}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus size={20} />
          <span>新增记录</span>
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-100 text-red-700 rounded-lg">{error}</div>
      )}

      <div className="card">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">批次</label>
            <select
              value={filters.batch_id}
              onChange={(e) => setFilters({ ...filters, batch_id: e.target.value })}
              className="select-field"
            >
              <option value="">全部批次</option>
              {batches.map((batch) => (
                <option key={batch.id} value={batch.id}>{batch.batch_number}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">费用类型</label>
            <select
              value={filters.cost_type}
              onChange={(e) => setFilters({ ...filters, cost_type: e.target.value })}
              className="select-field"
            >
              <option value="">全部类型</option>
              {costTypes.map((type) => (
                <option key={type.value} value={type.value}>{type.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">开始日期</label>
            <input
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
              className="input-field"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">结束日期</label>
            <input
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
              className="input-field"
            />
          </div>
          <div className="flex items-end">
            <label className="flex items-center space-x-2 text-sm text-gray-700 pb-2">
              <input
                type="checkbox"
                checked={filters.include_voided}
                onChange={(e) => setFilters({ ...filters, include_voided: e.target.checked })}
                className="rounded"
              />
              <span>显示已撤销</span>
            </label>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card bg-red-50">
          <div className="flex items-center space-x-3">
            <DollarSign className="text-red-600" size={24} />
            <div>
              <p className="text-sm text-red-600">总成本(有效分录)</p>
              <p className="text-2xl font-bold text-red-700">
                ¥{(summary?.total ?? 0).toLocaleString()}
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
                ¥{(summary?.by_type?.feed ?? 0).toLocaleString()}
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
                ¥{(summary?.by_type?.medicine ?? 0).toLocaleString()}
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
                <th>金额(元)</th>
                <th>计入成本</th>
                <th>描述</th>
                <th>数量</th>
                <th>单位</th>
                <th>单价</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id} className={record.status === 'voided' ? 'opacity-50' : ''}>
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
                    <span className={`badge ${
                      record.entry_kind === 'expense' ? 'badge-info' :
                      record.entry_kind === 'tax' ? 'badge-warning' : 'badge-success'
                    }`}>
                      {entryKindLabels[record.entry_kind] || record.entry_kind}
                    </span>
                  </td>
                  <td className="font-medium text-red-600">¥{record.amount.toLocaleString()}</td>
                  <td className={`font-medium ${record.effective_amount < 0 ? 'text-green-600' : 'text-gray-900'}`}>
                    {record.status === 'voided' ? '-' : `¥${record.effective_amount.toLocaleString()}`}
                  </td>
                  <td>{record.description || '-'}</td>
                  <td>{record.quantity ?? '-'}</td>
                  <td>{record.unit || '-'}</td>
                  <td>{record.unit_price != null ? `¥${record.unit_price}` : '-'}</td>
                  <td>
                    {record.status === 'voided' ? (
                      <span className="badge badge-danger">已撤销</span>
                    ) : (
                      <span className="badge badge-success">有效</span>
                    )}
                  </td>
                  <td>
                    <div className="flex items-center space-x-2">
                      {record.status === 'active' && record.entry_kind === 'expense' && (
                        <>
                          <button
                            onClick={() => handleEdit(record)}
                            title="编辑"
                            className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                          >
                            <Edit2 size={18} />
                          </button>
                          <button
                            onClick={() => {
                              setAdjustTarget(record);
                              setAdjustmentForm({ ...emptyAdjustment, adjustment_date: record.cost_date });
                            }}
                            title="登记税费/折让/退款"
                            className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                          >
                            <Receipt size={18} />
                          </button>
                        </>
                      )}
                      {record.status === 'active' && (
                        <button
                          onClick={() => handleVoid(record)}
                          title="撤销"
                          className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Ban size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-gray-500">
                    暂无成本记录
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                {editingRecord ? '编辑成本记录' : '新增成本记录'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
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
                    onChange={(e) => setFormData({ ...formData, batch_id: e.target.value })}
                    className="select-field"
                  >
                    <option value="">请选择批次</option>
                    {batches.map((batch) => (
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
                    type="date"
                    required
                    value={formData.cost_date}
                    onChange={(e) => setFormData({ ...formData, cost_date: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    费用类型 <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={formData.cost_type}
                    onChange={(e) => setFormData({ ...formData, cost_type: e.target.value, unit: '' })}
                    className="select-field"
                  >
                    {costTypes.map((type) => (
                      <option key={type.value} value={type.value}>
                        {type.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    金额(元) <span className="text-red-500">*</span>
                  </label>
                  {isDerived ? (
                    <input
                      type="text"
                      readOnly
                      value={derivedAmount}
                      className="input-field bg-gray-100"
                      placeholder="由数量×单价自动计算"
                    />
                  ) : (
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      required
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      className="input-field"
                      placeholder="金额"
                    />
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  费用描述
                </label>
                <input
                  type="text"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="input-field"
                  placeholder="费用描述"
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    数量 {isDerived && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    required={isDerived}
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="input-field"
                    placeholder="数量"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单位
                  </label>
                  {unitOptions[formData.cost_type] ? (
                    <select
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      className="select-field"
                    >
                      <option value="">请选择</option>
                      {unitOptions[formData.cost_type].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      value={formData.unit}
                      onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                      className="input-field"
                      placeholder="如: 次、天"
                    />
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单价 {isDerived && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    required={isDerived}
                    value={formData.unit_price}
                    onChange={(e) => setFormData({ ...formData, unit_price: e.target.value })}
                    className="input-field"
                    placeholder="单价"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  备注
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  className="input-field"
                  rows={3}
                  placeholder="备注信息"
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                >
                  {editingRecord ? '保存修改' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {adjustTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md mx-4">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-gray-900">
                登记调整 - {getCostTypeLabel(adjustTarget.cost_type)} ¥{adjustTarget.amount}
              </h2>
              <button
                onClick={() => setAdjustTarget(null)}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-4">
              税费/折让/退款将作为关联分录登记, 不会修改原费用记录。
            </p>
            <form onSubmit={handleAdjustmentSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  调整类型 <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={adjustmentForm.kind}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, kind: e.target.value as 'tax' | 'allowance' | 'refund' })}
                  className="select-field"
                >
                  <option value="tax">税费(增加成本)</option>
                  <option value="allowance">折让(抵减成本)</option>
                  <option value="refund">退款(抵减成本)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  金额(元) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  required
                  value={adjustmentForm.amount}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, amount: e.target.value })}
                  className="input-field"
                  placeholder="调整金额"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  调整日期 <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={adjustmentForm.adjustment_date}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, adjustment_date: e.target.value })}
                  className="input-field"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  说明
                </label>
                <input
                  type="text"
                  value={adjustmentForm.description}
                  onChange={(e) => setAdjustmentForm({ ...adjustmentForm, description: e.target.value })}
                  className="input-field"
                  placeholder="调整说明"
                />
              </div>
              <div className="flex justify-end space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setAdjustTarget(null)}
                  className="btn-secondary"
                >
                  取消
                </button>
                <button type="submit" className="btn-primary">
                  登记
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default CostRecords;
