import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X, Fish, Eye } from 'lucide-react';
import { batchApi, pondApi } from '../services/api';
import type { Batch, Pond } from '../types';

const Batches: React.FC = () => {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [ponds, setPonds] = useState<Pond[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [formData, setFormData] = useState({
    batch_number: '',
    pond_id: '',
    species: '',
    stocking_date: '',
    estimated_harvest_date: '',
    actual_harvest_date: '',
    status: 'active'
  });

  const fetchData = async () => {
    try {
      const [batchesRes, pondsRes] = await Promise.all([
        batchApi.getAll(),
        pondApi.getAll()
      ]);
      setBatches(batchesRes.data);
      setPonds(pondsRes.data);
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
        pond_id: parseInt(formData.pond_id),
        estimated_harvest_date: formData.estimated_harvest_date || undefined,
        actual_harvest_date: formData.actual_harvest_date || undefined
      };
      
      if (editingBatch) {
        await batchApi.update(editingBatch.id, data);
      } else {
        await batchApi.create(data);
      }
      
      setShowModal(false);
      setEditingBatch(null);
      setFormData({
        batch_number: '',
        pond_id: '',
        species: '',
        stocking_date: '',
        estimated_harvest_date: '',
        actual_harvest_date: '',
        status: 'active'
      });
      fetchData();
    } catch (error) {
      console.error('Error saving batch:', error);
    }
  };

  const handleEdit = (batch: Batch) => {
    setEditingBatch(batch);
    setFormData({
      batch_number: batch.batch_number,
      pond_id: batch.pond_id.toString(),
      species: batch.species,
      stocking_date: batch.stocking_date,
      estimated_harvest_date: batch.estimated_harvest_date || '',
      actual_harvest_date: batch.actual_harvest_date || '',
      status: batch.status
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除这个批次吗？')) {
      try {
        await batchApi.delete(id);
        fetchData();
      } catch (error) {
        console.error('Error deleting batch:', error);
      }
    }
  };

  const getPondName = (pondId: number) => {
    const pond = ponds.find(p => p.id === pondId);
    return pond ? pond.name : '未知塘口';
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      'active': 'badge-success',
      'harvested': 'badge-info',
      'closed': 'badge-warning'
    };
    const labels: Record<string, string> = {
      'active': '养殖中',
      'harvested': '已收获',
      'closed': '已关闭'
    };
    return (
      <span className={`badge ${styles[status] || 'badge-info'}`}>
        {labels[status] || status}
      </span>
    );
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
          <h1 className="text-2xl font-bold text-gray-900">批次管理</h1>
          <p className="text-gray-600 mt-1">管理养殖批次信息，支持批次追溯</p>
        </div>
        <button
          onClick={() => {
            setEditingBatch(null);
            setFormData({
              batch_number: '',
              pond_id: '',
              species: '',
              stocking_date: '',
              estimated_harvest_date: '',
              actual_harvest_date: '',
              status: 'active'
            });
            setShowModal(true);
          }}
          className="btn-primary flex items-center space-x-2"
        >
          <Plus size={20} />
          <span>新增批次</span>
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card bg-green-50">
          <div className="flex items-center space-x-3">
            <Fish className="text-green-600" size={24} />
            <div>
              <p className="text-sm text-green-600">养殖中</p>
              <p className="text-2xl font-bold text-green-700">
                {batches.filter(b => b.status === 'active').length}
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-blue-50">
          <div className="flex items-center space-x-3">
            <Eye className="text-blue-600" size={24} />
            <div>
              <p className="text-sm text-blue-600">已收获</p>
              <p className="text-2xl font-bold text-blue-700">
                {batches.filter(b => b.status === 'harvested').length}
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-gray-50">
          <div className="flex items-center space-x-3">
            <Eye className="text-gray-600" size={24} />
            <div>
              <p className="text-sm text-gray-600">总批次</p>
              <p className="text-2xl font-bold text-gray-700">
                {batches.length}
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
                <th>塘口</th>
                <th>养殖品种</th>
                <th>放苗日期</th>
                <th>预计收获</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((batch) => (
                <tr key={batch.id}>
                  <td className="font-medium text-ocean-700">{batch.batch_number}</td>
                  <td>{getPondName(batch.pond_id)}</td>
                  <td>{batch.species}</td>
                  <td>{batch.stocking_date}</td>
                  <td>{batch.estimated_harvest_date || '-'}</td>
                  <td>{getStatusBadge(batch.status)}</td>
                  <td>
                    <div className="flex items-center space-x-2">
                      <button
                        onClick={() => handleEdit(batch)}
                        className="p-2 text-ocean-600 hover:bg-ocean-50 rounded-lg transition-colors"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button
                        onClick={() => handleDelete(batch.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {batches.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-gray-500">
                    暂无批次数据
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
                {editingBatch ? '编辑批次' : '新增批次'}
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
                    批次号 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.batch_number}
                    onChange={(e) => setFormData({ ...formData, batch_number: e.target.value })}
                    className="input-field"
                    placeholder="如: 20240401-001"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    塘口 <span className="text-red-500">*</span>
                  </label>
                  <select
                    required
                    value={formData.pond_id}
                    onChange={(e) => setFormData({ ...formData, pond_id: e.target.value })}
                    className="select-field"
                  >
                    <option value="">请选择塘口</option>
                    {ponds.map((pond) => (
                      <option key={pond.id} value={pond.id}>
                        {pond.name} ({pond.area}亩)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  养殖品种 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.species}
                  onChange={(e) => setFormData({ ...formData, species: e.target.value })}
                  className="input-field"
                  placeholder="如: 草鱼、鲫鱼、虾等"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    放苗日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.stocking_date}
                    onChange={(e) => setFormData({ ...formData, stocking_date: e.target.value })}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    预计收获日期
                  </label>
                  <input
                    type="date"
                    value={formData.estimated_harvest_date}
                    onChange={(e) => setFormData({ ...formData, estimated_harvest_date: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    实际收获日期
                  </label>
                  <input
                    type="date"
                    value={formData.actual_harvest_date}
                    onChange={(e) => setFormData({ ...formData, actual_harvest_date: e.target.value })}
                    className="input-field"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    状态
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="select-field"
                  >
                    <option value="active">养殖中</option>
                    <option value="harvested">已收获</option>
                    <option value="closed">已关闭</option>
                  </select>
                </div>
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
                  {editingBatch ? '保存修改' : '创建'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Batches;
