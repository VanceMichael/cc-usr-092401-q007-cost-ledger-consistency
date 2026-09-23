import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X } from 'lucide-react';
import { feedingRecordApi, batchApi } from '../services/api';
import type { FeedingRecord, Batch } from '../types';

const FeedingRecords: React.FC = () => {
  const [records, setRecords] = useState<FeedingRecord[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<FeedingRecord | null>(null);
  const [formData, setFormData] = useState({
    batch_id: '',
    feeding_date: '',
    feed_type: '',
    feed_quantity: '',
    feeding_time: '',
    weather: '',
    water_temperature: '',
    notes: ''
  });

  const fetchData = async () => {
    try {
      const [recordsRes, batchesRes] = await Promise.all([
        feedingRecordApi.getAll(),
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
        feed_quantity: parseFloat(formData.feed_quantity),
        water_temperature: formData.water_temperature ? parseFloat(formData.water_temperature) : undefined
      };
      
      if (editingRecord) {
        await feedingRecordApi.update(editingRecord.id, data);
      } else {
        await feedingRecordApi.create(data);
      }
      
      setShowModal(false);
      setEditingRecord(null);
      setFormData({
        batch_id: '',
        feeding_date: '',
        feed_type: '',
        feed_quantity: '',
        feeding_time: '',
        weather: '',
        water_temperature: '',
        notes: ''
      });
      fetchData();
    } catch (error) {
      console.error('Error saving record:', error);
    }
  };

  const handleEdit = (record: FeedingRecord) => {
    setEditingRecord(record);
    setFormData({
      batch_id: record.batch_id.toString(),
      feeding_date: record.feeding_date,
      feed_type: record.feed_type,
      feed_quantity: record.feed_quantity.toString(),
      feeding_time: record.feeding_time || '',
      weather: record.weather || '',
      water_temperature: record.water_temperature?.toString() || '',
      notes: record.notes || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除这条记录吗？')) {
      try {
        await feedingRecordApi.delete(id);
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
          <h1 className="text-2xl font-bold text-gray-900">投喂记录</h1>
          <p className="text-gray-600 mt-1">记录日常投喂信息</p>
        </div>
        <button
          onClick={() => {
            setEditingRecord(null);
            setFormData({
              batch_id: '',
              feeding_date: '',
              feed_type: '',
              feed_quantity: '',
              feeding_time: '',
              weather: '',
              water_temperature: '',
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
                <th>投喂日期</th>
                <th>饲料类型</th>
                <th>投喂量(公斤)</th>
                <th>投喂时间</th>
                <th>天气</th>
                <th>水温(℃)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="font-medium text-ocean-700">{getBatchNumber(record.batch_id)}</td>
                  <td>{record.feeding_date}</td>
                  <td>{record.feed_type}</td>
                  <td>{record.feed_quantity}</td>
                  <td>{record.feeding_time || '-'}</td>
                  <td>{record.weather || '-'}</td>
                  <td>{record.water_temperature || '-'}</td>
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
                  <td colSpan={8} className="text-center py-8 text-gray-500">
                    暂无投喂记录
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
                {editingRecord ? '编辑投喂记录' : '新增投喂记录'}
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
                    投喂日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.feeding_date}
                    onChange={(e) => setFormData({ ...formData, feeding_date: e.target.value })}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    饲料类型 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.feed_type}
                    onChange={(e) => setFormData({ ...formData, feed_type: e.target.value })}
                    className="input-field"
                    placeholder="如: 配合饲料"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    投喂量(公斤) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.feed_quantity}
                    onChange={(e) => setFormData({ ...formData, feed_quantity: e.target.value })}
                    className="input-field"
                    placeholder="投喂量"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    投喂时间
                  </label>
                  <input
                    type="time"
                    value={formData.feeding_time}
                    onChange={(e) => setFormData({ ...formData, feeding_time: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    天气
                  </label>
                  <input
                    type="text"
                    value={formData.weather}
                    onChange={(e) => setFormData({ ...formData, weather: e.target.value })}
                    className="input-field"
                    placeholder="如: 晴"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    水温(℃)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.water_temperature}
                    onChange={(e) => setFormData({ ...formData, water_temperature: e.target.value })}
                    className="input-field"
                    placeholder="水温"
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

export default FeedingRecords;
