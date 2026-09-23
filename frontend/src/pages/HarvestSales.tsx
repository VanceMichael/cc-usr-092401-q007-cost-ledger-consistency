import React, { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, X, Fish, TrendingUp } from 'lucide-react';
import { harvestSaleApi, batchApi } from '../services/api';
import type { HarvestSale, Batch } from '../types';

const HarvestSales: React.FC = () => {
  const [records, setRecords] = useState<HarvestSale[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HarvestSale | null>(null);
  const [formData, setFormData] = useState({
    batch_id: '',
    sale_date: '',
    weight: '',
    unit_price: '',
    total_amount: '',
    buyer: '',
    batch_number: '',
    quality_grade: '',
    notes: ''
  });

  const fetchData = async () => {
    try {
      const [recordsRes, batchesRes] = await Promise.all([
        harvestSaleApi.getAll(),
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
        weight: parseFloat(formData.weight),
        unit_price: parseFloat(formData.unit_price),
        total_amount: formData.total_amount ? parseFloat(formData.total_amount) : undefined
      };
      
      if (editingRecord) {
        await harvestSaleApi.update(editingRecord.id, data);
      } else {
        await harvestSaleApi.create(data);
      }
      
      setShowModal(false);
      setEditingRecord(null);
      setFormData({
        batch_id: '',
        sale_date: '',
        weight: '',
        unit_price: '',
        total_amount: '',
        buyer: '',
        batch_number: '',
        quality_grade: '',
        notes: ''
      });
      fetchData();
    } catch (error) {
      console.error('Error saving record:', error);
    }
  };

  const handleEdit = (record: HarvestSale) => {
    setEditingRecord(record);
    setFormData({
      batch_id: record.batch_id.toString(),
      sale_date: record.sale_date,
      weight: record.weight.toString(),
      unit_price: record.unit_price.toString(),
      total_amount: record.total_amount?.toString() || '',
      buyer: record.buyer || '',
      batch_number: record.batch_number || '',
      quality_grade: record.quality_grade || '',
      notes: record.notes || ''
    });
    setShowModal(true);
  };

  const handleDelete = async (id: number) => {
    if (window.confirm('确定要删除这条记录吗？')) {
      try {
        await harvestSaleApi.delete(id);
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

  const getTotalRevenue = () => {
    return records.reduce((sum, r) => sum + (r.total_amount || 0), 0);
  };

  const getTotalWeight = () => {
    return records.reduce((sum, r) => sum + r.weight, 0);
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
          <h1 className="text-2xl font-bold text-gray-900">出塘销售</h1>
          <p className="text-gray-600 mt-1">记录水产品出塘销售信息，支持批次追溯</p>
        </div>
        <button
          onClick={() => {
            setEditingRecord(null);
            setFormData({
              batch_id: '',
              sale_date: '',
              weight: '',
              unit_price: '',
              total_amount: '',
              buyer: '',
              batch_number: '',
              quality_grade: '',
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
        <div className="card bg-green-50">
          <div className="flex items-center space-x-3">
            <TrendingUp className="text-green-600" size={24} />
            <div>
              <p className="text-sm text-green-600">总营收</p>
              <p className="text-2xl font-bold text-green-700">
                ¥{getTotalRevenue().toLocaleString()}
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-blue-50">
          <div className="flex items-center space-x-3">
            <Fish className="text-blue-600" size={24} />
            <div>
              <p className="text-sm text-blue-600">总销量</p>
              <p className="text-2xl font-bold text-blue-700">
                {getTotalWeight().toLocaleString()} 公斤
              </p>
            </div>
          </div>
        </div>
        <div className="card bg-purple-50">
          <div className="flex items-center space-x-3">
            <Fish className="text-purple-600" size={24} />
            <div>
              <p className="text-sm text-purple-600">交易笔数</p>
              <p className="text-2xl font-bold text-purple-700">
                {records.length} 笔
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
                <th>养殖批次</th>
                <th>销售日期</th>
                <th>重量(公斤)</th>
                <th>单价(元/公斤)</th>
                <th>总金额(元)</th>
                <th>买家</th>
                <th>追溯批次</th>
                <th>质量等级</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record) => (
                <tr key={record.id}>
                  <td className="font-medium text-ocean-700">{getBatchNumber(record.batch_id)}</td>
                  <td>{record.sale_date}</td>
                  <td>{record.weight.toLocaleString()}</td>
                  <td>¥{record.unit_price}</td>
                  <td className="font-medium text-green-600">¥{(record.total_amount || 0).toLocaleString()}</td>
                  <td>{record.buyer || '-'}</td>
                  <td>
                    {record.batch_number && (
                      <span className="badge badge-info">{record.batch_number}</span>
                    )}
                    {!record.batch_number && '-'}
                  </td>
                  <td>{record.quality_grade || '-'}</td>
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
                    暂无出塘销售记录
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
                {editingRecord ? '编辑出塘销售记录' : '新增出塘销售记录'}
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
                    销售日期 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={formData.sale_date}
                    onChange={(e) => setFormData({ ...formData, sale_date: e.target.value })}
                    className="input-field"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    重量(公斤) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.weight}
                    onChange={(e) => {
                      const weight = parseFloat(e.target.value) || 0;
                      const unitPrice = parseFloat(formData.unit_price) || 0;
                      setFormData({
                        ...formData,
                        weight: e.target.value,
                        total_amount: (weight * unitPrice).toString()
                      });
                    }}
                    className="input-field"
                    placeholder="重量"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    单价(元/公斤) <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formData.unit_price}
                    onChange={(e) => {
                      const weight = parseFloat(formData.weight) || 0;
                      const unitPrice = parseFloat(e.target.value) || 0;
                      setFormData({
                        ...formData,
                        unit_price: e.target.value,
                        total_amount: (weight * unitPrice).toString()
                      });
                    }}
                    className="input-field"
                    placeholder="单价"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    总金额(元)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={formData.total_amount}
                    onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
                    className="input-field bg-gray-50"
                    placeholder="自动计算"
                    readOnly
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    买家
                  </label>
                  <input
                    type="text"
                    value={formData.buyer}
                    onChange={(e) => setFormData({ ...formData, buyer: e.target.value })}
                    className="input-field"
                    placeholder="买家名称"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    质量等级
                  </label>
                  <select
                    value={formData.quality_grade}
                    onChange={(e) => setFormData({ ...formData, quality_grade: e.target.value })}
                    className="select-field"
                  >
                    <option value="">请选择等级</option>
                    <option value="特级">特级</option>
                    <option value="一级">一级</option>
                    <option value="二级">二级</option>
                    <option value="三级">三级</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  追溯批次号
                </label>
                <input
                  type="text"
                  value={formData.batch_number}
                  onChange={(e) => setFormData({ ...formData, batch_number: e.target.value })}
                  className="input-field"
                  placeholder="用于批次追溯的销售批次号"
                />
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

export default HarvestSales;
