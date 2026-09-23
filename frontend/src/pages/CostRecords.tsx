import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X, DollarSign } from 'lucide-react';
import { costRecordApi, batchApi } from '../services/api';
import type { CostRecord, Batch } from '../types';

const CostRecords: React.FC = () => {
  const [records, setRecords] = useState<CostRecord[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CostRecord | null>(null);
  const [formData, setFormData] = useState({
    batch_id: '',
    cost_date: '',
    cost_type: 'feed',
    amount: '',
    description: '',
    quantity: '',
    unit: '',
    unit_price: '',
    notes: ''
  });

  const costTypes = [
    { value: 'feed', label: '饲料' },
    { value: 'medicine', label: '药品' },
    { value: 'labor', label: '人工' },
    { value: 'electricity', label: '电费' },
    { value: 'other', label: '其他' },
  ];

  const fetchData = async () => {
    try {
      const [recordsRes, batchesRes] = await Promise.all([
        costRecordApi.getAll(),
        batchApi.getAll()
      ]);
      setRecords(recordsRes.data);
      setBatches(batchesRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = {
        ...formData,
        batch_id: parseInt(formData.batch_id),
        amount: parseFloat(formData.amount),
        quantity: formData.quantity ? parseFloat(formData.quantity) : undefined,
        unit_price: formData.unit_price ? parseFloat(formData.unit_price) : undefined
      };
      
      if (editingRecord) {
        await costRecordApi.update(editingRecord.id, data);
      } else {
        await costRecordApi.create(data);
      }
      
      setShowModal(false);
      setEditingRecord(null);
      setFormData({
        batch_id: '',
        cost_date: '',
        cost_type: 'feed',
        amount: '',
        description: '',
        quantity: '',
        unit: '',
        unit_price: '',
        notes: ''
      });
      fetchData();
    } catch (error) {
      console.error('Error saving record:', error);
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
      notes: record.notes || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除这条记录吗？')) {
      try {
        await costRecordApi.delete(id);
        fetchData();
      } catch (error) {
        console.error('Error deleting record:', error);
      }
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

  const getTotalCost = () => {
    return records.reduce((sum, r) => sum + r.amount, 0);
  };

  const getCostByType = () => {
    const result: Record<string, number> = {};
    records.forEach(r => {
      result[r.cost_type] = (result[r.cost_type] || 0) + r.amount;
    });
    return result;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  const costByType = getCostByType();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">成本核算</h1>
          <p className="text-gray-600 mt-1">记录和分析养殖成本</p>
        </div>
        <button
          onClick={() => {
            setEditingRecord(null);
            setFormData({
              batch_id: '',
              cost_date: '',
              cost_type: 'feed',
              amount: '',
              description: '',
              quantity: '',
              unit: '',
              unit_price: '',
              notes: ''
            });
            setShowModal(true);
          }}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus size={20} />
          <span>新增记录</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card bg-red-50">
          <div className="flex items-center space-x-3">
            <DollarSign className="text-red-600" size={24} />
            <div>
              <p className="text-sm text-red-600">总成本</p>
              <p className="text-2xl font-bold text-red-700">
                ¥{getTotalCost().toLocaleString()}
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
                ¥{(costByType['feed'] || 0).toLocaleString()}
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
                ¥{(costByType['medicine'] || 0).toLocaleString()}
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
                <th>金额(元)</th>
                <th>描述</th>
                <th>数量</th>
                <th>单位</th>
                <th>单价</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
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
                  <td className="font-medium text-red-600">¥{record.amount.toLocaleString()}</td>
                  <td>{record.description || '-'}</td>
                  <td>{record.quantity || '-'}</td>
                  <td>{record.unit || '-'}</td>
                  <td>{record.unit_price ? `¥${record.unit_price}` : '-'}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEdit(record)}
                        className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(record.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {records.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center py-8 text-gray-500">
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
                    onChange={(e) => setFormData({ ...formData, cost_type: e.target.value })}
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
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    className="input-field"
                    placeholder="金额"
                  />
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
                    数量
                  </label>
                  <input
                    type="number"
                    step="0.01"
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
                  <input
                    type="text"
                    value={formData.unit}
                    onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                    className="input-field"
                    placeholder="如: 公斤、袋等"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单价
                  </label>
                  <input
                    type="number"
                    step="0.01"
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
    </div>
  );
};

export default CostRecords;
