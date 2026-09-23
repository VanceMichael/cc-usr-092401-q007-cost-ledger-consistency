import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X, Droplets, Thermometer, Gauge } from 'lucide-react';
import { waterQualityRecordApi, batchApi } from '../services/api';
import type { WaterQualityRecord, Batch } from '../types';

const WaterQuality: React.FC = () => {
  const [records, setRecords] = useState<WaterQualityRecord[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<WaterQualityRecord | null>(null);
  const [formData, setFormData] = useState({
    batch_id: '',
    record_date: '',
    record_time: '',
    water_temperature: '',
    ph_value: '',
    dissolved_oxygen: '',
    ammonia_nitrogen: '',
    nitrite: '',
    transparency: '',
    notes: ''
  });

  const fetchData = async () => {
    try {
      const [recordsRes, batchesRes] = await Promise.all([
        waterQualityRecordApi.getAll(),
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
        water_temperature: formData.water_temperature ? parseFloat(formData.water_temperature) : undefined,
        ph_value: formData.ph_value ? parseFloat(formData.ph_value) : undefined,
        dissolved_oxygen: formData.dissolved_oxygen ? parseFloat(formData.dissolved_oxygen) : undefined,
        ammonia_nitrogen: formData.ammonia_nitrogen ? parseFloat(formData.ammonia_nitrogen) : undefined,
        nitrite: formData.nitrite ? parseFloat(formData.nitrite) : undefined,
        transparency: formData.transparency ? parseFloat(formData.transparency) : undefined
      };
      
      if (editingRecord) {
        await waterQualityRecordApi.update(editingRecord.id, data);
      } else {
        await waterQualityRecordApi.create(data);
      }
      
      setShowModal(false);
      setEditingRecord(null);
      setFormData({
        batch_id: '',
        record_date: '',
        record_time: '',
        water_temperature: '',
        ph_value: '',
        dissolved_oxygen: '',
        ammonia_nitrogen: '',
        nitrite: '',
        transparency: '',
        notes: ''
      });
      fetchData();
    } catch (error) {
      console.error('Error saving record:', error);
    }
  };

  const handleEdit = (record: WaterQualityRecord) => {
    setEditingRecord(record);
    setFormData({
      batch_id: record.batch_id.toString(),
      record_date: record.record_date,
      record_time: record.record_time || '',
      water_temperature: record.water_temperature?.toString() || '',
      ph_value: record.ph_value?.toString() || '',
      dissolved_oxygen: record.dissolved_oxygen?.toString() || '',
      ammonia_nitrogen: record.ammonia_nitrogen?.toString() || '',
      nitrite: record.nitrite?.toString() || '',
      transparency: record.transparency?.toString() || '',
      notes: record.notes || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除这条记录吗？')) {
      try {
        await waterQualityRecordApi.delete(id);
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
          <h1 className="text-2xl font-bold text-gray-900">水质监测</h1>
          <p className="text-gray-600 mt-1">记录和监控水质参数</p>
        </div>
        <button
          onClick={() => {
            setEditingRecord(null);
            setFormData({
              batch_id: '',
              record_date: '',
              record_time: '',
              water_temperature: '',
              ph_value: '',
              dissolved_oxygen: '',
              ammonia_nitrogen: '',
              nitrite: '',
              transparency: '',
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
        <div className="card bg-blue-50">
          <div className="flex items-center space-x-3">
            <Thermometer className="text-blue-600" size={24} />
            <div>
              <p className="text-sm text-blue-600">水温监测</p>
              <p className="text-lg font-bold text-blue-700">
                {records.length > 0 ? `${records[records.length - 1].water_temperature || '-'}℃` : '-'}
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-green-50">
          <div className="flex items-center space-x-3">
            <Droplets className="text-green-600" size={24} />
            <div>
              <p className="text-sm text-green-600">pH值</p>
              <p className="text-lg font-bold text-green-700">
                {records.length > 0 ? records[records.length - 1].ph_value || '-' : '-'}
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-purple-50">
          <div className="flex items-center space-x-3">
            <Gauge className="text-purple-600" size={24} />
            <div>
              <p className="text-sm text-purple-600">溶解氧</p>
              <p className="text-lg font-bold text-purple-700">
                {records.length > 0 ? `${records[records.length - 1].dissolved_oxygen || '-'} mg/L` : '-'}
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
                <th>检测日期</th>
                <th>时间</th>
                <th>水温(℃)</th>
                <th>pH值</th>
                <th>溶解氧(mg/L)</th>
                <th>氨氮(mg/L)</th>
                <th>亚硝酸盐(mg/L)</th>
                <th>透明度(cm)</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="font-medium text-ocean-700">{getBatchNumber(record.batch_id)}</td>
                  <td>{record.record_date}</td>
                  <td>{record.record_time || '-'}</td>
                  <td>{record.water_temperature || '-'}</td>
                  <td>{record.ph_value || '-'}</td>
                  <td>{record.dissolved_oxygen || '-'}</td>
                  <td>{record.ammonia_nitrogen || '-'}</td>
                  <td>{record.nitrite || '-'}</td>
                  <td>{record.transparency || '-'}</td>
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
                    暂无水质监测记录
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
                {editingRecord ? '编辑水质监测记录' : '新增水质监测记录'}
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
                    检测日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.record_date}
                    onChange={(e) => setFormData({ ...formData, record_date: e.target.value })}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    检测时间
                  </label>
                  <input
                    type="time"
                    value={formData.record_time}
                    onChange={(e) => setFormData({ ...formData, record_time: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
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

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    pH值
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.ph_value}
                    onChange={(e) => setFormData({ ...formData, ph_value: e.target.value })}
                    className="input-field"
                    placeholder="pH值"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    溶解氧(mg/L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.dissolved_oxygen}
                    onChange={(e) => setFormData({ ...formData, dissolved_oxygen: e.target.value })}
                    className="input-field"
                    placeholder="溶解氧"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    氨氮(mg/L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.ammonia_nitrogen}
                    onChange={(e) => setFormData({ ...formData, ammonia_nitrogen: e.target.value })}
                    className="input-field"
                    placeholder="氨氮"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    亚硝酸盐(mg/L)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.nitrite}
                    onChange={(e) => setFormData({ ...formData, nitrite: e.target.value })}
                    className="input-field"
                    placeholder="亚硝酸盐"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    透明度(cm)
                  </label>
                  <input
                    type="number"
                    step="1"
                    value={formData.transparency}
                    onChange={(e) => setFormData({ ...formData, transparency: e.target.value })}
                    className="input-field"
                    placeholder="透明度"
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

export default WaterQuality;
