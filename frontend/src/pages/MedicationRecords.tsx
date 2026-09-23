import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X, Pill } from 'lucide-react';
import { medicationRecordApi, batchApi } from '../services/api';
import type { MedicationRecord, Batch } from '../types';

const MedicationRecords: React.FC = () => {
  const [records, setRecords] = useState<MedicationRecord[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<MedicationRecord | null>(null);
  const [formData, setFormData] = useState({
    batch_id: '',
    medication_date: '',
    drug_name: '',
    drug_type: '',
    dosage: '',
    dosage_unit: 'kg',
    administration_method: '',
    purpose: '',
    manufacturer: '',
    batch_number: '',
    notes: ''
  });

  const fetchData = async () => {
    try {
      const [recordsRes, batchesRes] = await Promise.all([
        medicationRecordApi.getAll(),
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
        dosage: formData.dosage ? parseFloat(formData.dosage) : undefined
      };
      
      if (editingRecord) {
        await medicationRecordApi.update(editingRecord.id, data);
      } else {
        await medicationRecordApi.create(data);
      }
      
      setShowModal(false);
      setEditingRecord(null);
      setFormData({
        batch_id: '',
        medication_date: '',
        drug_name: '',
        drug_type: '',
        dosage: '',
        dosage_unit: 'kg',
        administration_method: '',
        purpose: '',
        manufacturer: '',
        batch_number: '',
        notes: ''
      });
      fetchData();
    } catch (error) {
      console.error('Error saving record:', error);
    }
  };

  const handleEdit = (record: MedicationRecord) => {
    setEditingRecord(record);
    setFormData({
      batch_id: record.batch_id.toString(),
      medication_date: record.medication_date,
      drug_name: record.drug_name,
      drug_type: record.drug_type || '',
      dosage: record.dosage?.toString() || '',
      dosage_unit: record.dosage_unit || 'kg',
      administration_method: record.administration_method || '',
      purpose: record.purpose || '',
      manufacturer: record.manufacturer || '',
      batch_number: record.batch_number || '',
      notes: record.notes || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除这条记录吗？')) {
      try {
        await medicationRecordApi.delete(id);
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
          <h1 className="text-2xl font-bold text-gray-900">用药记录</h1>
          <p className="text-gray-600 mt-1">记录水产养殖用药信息</p>
        </div>
        <button
          onClick={() => {
            setEditingRecord(null);
            setFormData({
              batch_id: '',
              medication_date: '',
              drug_name: '',
              drug_type: '',
              dosage: '',
              dosage_unit: 'kg',
              administration_method: '',
              purpose: '',
              manufacturer: '',
              batch_number: '',
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
                <th>用药日期</th>
                <th>药品名称</th>
                <th>药品类型</th>
                <th>用量</th>
                <th>单位</th>
                <th>用途</th>
                <th>生产厂家</th>
                <th>药品批次</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="font-medium text-ocean-700">{getBatchNumber(record.batch_id)}</td>
                  <td>{record.medication_date}</td>
                  <td>{record.drug_name}</td>
                  <td>{record.drug_type || '-'}</td>
                  <td>{record.dosage || '-'}</td>
                  <td>{record.dosage_unit || '-'}</td>
                  <td>{record.purpose || '-'}</td>
                  <td>{record.manufacturer || '-'}</td>
                  <td>{record.batch_number || '-'}</td>
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
                  <td colSpan={10} className="text-center py-8 text-gray-500">
                    暂无用药记录
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
                {editingRecord ? '编辑用药记录' : '新增用药记录'}
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
                    用药日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.medication_date}
                    onChange={(e) => setFormData({ ...formData, medication_date: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    药品名称 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.drug_name}
                    onChange={(e) => setFormData({ ...formData, drug_name: e.target.value })}
                    className="input-field"
                    placeholder="药品名称"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    药品类型
                  </label>
                  <input
                    type="text"
                    value={formData.drug_type}
                    onChange={(e) => setFormData({ ...formData, drug_type: e.target.value })}
                    className="input-field"
                    placeholder="如: 抗生素、消毒剂等"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用量
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.dosage}
                    onChange={(e) => setFormData({ ...formData, dosage: e.target.value })}
                    className="input-field"
                    placeholder="用量"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单位
                  </label>
                  <select
                    value={formData.dosage_unit}
                    onChange={(e) => setFormData({ ...formData, dosage_unit: e.target.value })}
                    className="select-field"
                  >
                    <option value="kg">kg</option>
                    <option value="g">g</option>
                    <option value="L">L</option>
                    <option value="ml">ml</option>
                    <option value="瓶">瓶</option>
                    <option value="袋">袋</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    施用方法
                  </label>
                  <input
                    type="text"
                    value={formData.administration_method}
                    onChange={(e) => setFormData({ ...formData, administration_method: e.target.value })}
                    className="input-field"
                    placeholder="如: 全池泼洒、拌料投喂等"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    用途
                  </label>
                  <input
                    type="text"
                    value={formData.purpose}
                    onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
                    className="input-field"
                    placeholder="如: 防病、治病等"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    生产厂家
                  </label>
                  <input
                    type="text"
                    value={formData.manufacturer}
                    onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
                    className="input-field"
                    placeholder="生产厂家"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    药品批次号
                  </label>
                  <input
                    type="text"
                    value={formData.batch_number}
                    onChange={(e) => setFormData({ ...formData, batch_number: e.target.value })}
                    className="input-field"
                    placeholder="药品批次号"
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

export default MedicationRecords;
