import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X } from 'lucide-react';
import { stockingRecordApi, batchApi } from '../services/api';
import type { StockingRecord, Batch } from '../types';

const StockingRecords: React.FC = () => {
  const [records, setRecords] = useState<StockingRecord[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<StockingRecord | null>(null);
  const [formData, setFormData] = useState({
    batch_id: '',
    species: '',
    quantity: '',
    source: '',
    batch_number: '',
    weight_per_unit: '',
    total_weight: '',
    notes: ''
  });

  const fetchData = async () => {
    try {
      const [recordsRes, batchesRes] = await Promise.all([
        stockingRecordApi.getAll(),
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
        quantity: parseInt(formData.quantity),
        weight_per_unit: formData.weight_per_unit ? parseFloat(formData.weight_per_unit) : undefined,
        total_weight: formData.total_weight ? parseFloat(formData.total_weight) : undefined
      };
      
      if (editingRecord) {
        await stockingRecordApi.update(editingRecord.id, data);
      } else {
        await stockingRecordApi.create(data);
      }
      
      setShowModal(false);
      setEditingRecord(null);
      setFormData({
        batch_id: '',
        species: '',
        quantity: '',
        source: '',
        batch_number: '',
        weight_per_unit: '',
        total_weight: '',
        notes: ''
      });
      fetchData();
    } catch (error) {
      console.error('Error saving record:', error);
    }
  };

  const handleEdit = (record: StockingRecord) => {
    setEditingRecord(record);
    setFormData({
      batch_id: record.batch_id.toString(),
      species: record.species,
      quantity: record.quantity.toString(),
      source: record.source || '',
      batch_number: record.batch_number || '',
      weight_per_unit: record.weight_per_unit?.toString() || '',
      total_weight: record.total_weight?.toString() || '',
      notes: record.notes || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除这条记录吗？')) {
      try {
        await stockingRecordApi.delete(id);
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
          <h1 className="text-2xl font-bold text-gray-900">投苗记录</h1>
          <p className="text-gray-600 mt-1">记录水产养殖投苗信息</p>
        </div>
        <button
          onClick={() => {
            setEditingRecord(null);
            setFormData({
              batch_id: '',
              species: '',
              quantity: '',
              source: '',
              batch_number: '',
              weight_per_unit: '',
              total_weight: '',
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

      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>批次号</th>
                <th>品种</th>
                <th>数量(尾)</th>
                <th>来源</th>
                <th>苗种批次</th>
                <th>总重量(公斤)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="font-medium text-ocean-700">{getBatchNumber(record.batch_id)}</td>
                  <td>{record.species}</td>
                  <td>{record.quantity.toLocaleString()}</td>
                  <td>{record.source || '-'}</td>
                  <td>{record.batch_number || '-'}</td>
                  <td>{record.total_weight || '-'}</td>
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
                  <td colSpan={7} className="text-center py-8 text-gray-500">
                    暂无投苗记录
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
                {editingRecord ? '编辑投苗记录' : '新增投苗记录'}
              </h2>
              <button
                onClick={() => setShowModal(false)}
                className="p-2 text-gray-400 hover:text-gray-600"
              >
                <X size={20} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    品种 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.species}
                    onChange={(e) => setFormData({ ...formData, species: e.target.value })}
                    className="input-field"
                    placeholder="如: 草鱼"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    数量(尾) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    required
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                    className="input-field"
                    placeholder="请输入数量"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    来源
                  </label>
                  <input
                    type="text"
                    value={formData.source}
                    onChange={(e) => setFormData({ ...formData, source: e.target.value })}
                    className="input-field"
                    placeholder="苗种来源"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    苗种批次号
                  </label>
                  <input
                    type="text"
                    value={formData.batch_number}
                    onChange={(e) => setFormData({ ...formData, batch_number: e.target.value })}
                    className="input-field"
                    placeholder="苗种批次号"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单重(克/尾)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.weight_per_unit}
                    onChange={(e) => setFormData({ ...formData, weight_per_unit: e.target.value })}
                    className="input-field"
                    placeholder="单重"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    总重量(公斤)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total_weight}
                    onChange={(e) => setFormData({ ...formData, total_weight: e.target.value })}
                    className="input-field"
                    placeholder="总重量"
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

export default StockingRecords;
