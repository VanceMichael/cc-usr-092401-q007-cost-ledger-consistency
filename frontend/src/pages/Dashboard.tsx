import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  Fish, Droplets, DollarSign, TrendingUp, 
  Plus, CheckCircle, AlertCircle
} from 'lucide-react';
import { pondApi, batchApi, costRecordApi, harvestSaleApi } from '../services/api';
import type { Pond, Batch, CostRecord, HarvestSale } from '../types';

const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const [ponds, setPonds] = useState<Pond[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [costs, setCosts] = useState<CostRecord[]>([]);
  const [sales, setSales] = useState<HarvestSale[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [pondsRes, batchesRes, costsRes, salesRes] = await Promise.all([
          pondApi.getAll(),
          batchApi.getAll(),
          costRecordApi.getAll(),
          harvestSaleApi.getAll(),
        ]);
        setPonds(pondsRes.data);
        setBatches(batchesRes.data);
        setCosts(costsRes.data);
        setSales(salesRes.data);
      } catch (error) {
        console.error('Error fetching data:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const activeBatches = batches.filter(b => b.status === 'active');
  const totalArea = ponds.reduce((sum, p) => sum + p.area, 0);
  const totalCost = costs.reduce((sum, c) => sum + c.amount, 0);
  const totalRevenue = sales.reduce((sum, s) => sum + (s.total_amount || 0), 0);

  const stats = [
    { 
      title: '塘口总数', 
      value: ponds.length, 
      subtitle: `${totalArea.toFixed(1)} 亩`,
      icon: Droplets, 
      color: 'bg-ocean-500' 
    },
    { 
      title: '活跃批次', 
      value: activeBatches.length, 
      subtitle: '养殖中',
      icon: Fish, 
      color: 'bg-green-500' 
    },
    { 
      title: '总成本', 
      value: `¥${totalCost.toLocaleString()}`, 
      subtitle: '饲料、药品、人工等',
      icon: DollarSign, 
      color: 'bg-red-500' 
    },
    { 
      title: '总营收', 
      value: `¥${totalRevenue.toLocaleString()}`, 
      subtitle: totalRevenue - totalCost >= 0 ? `盈利 ¥${(totalRevenue - totalCost).toLocaleString()}` : `亏损 ¥${(totalCost - totalRevenue).toLocaleString()}`,
      icon: TrendingUp, 
      color: totalRevenue - totalCost >= 0 ? 'bg-green-500' : 'bg-red-500'
    },
  ];

  const recentBatches = batches.slice(-5).reverse();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-gray-500">加载中...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">仪表盘</h1>
        <p className="text-gray-600 mt-1">水产养殖管理系统概览</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, index) => {
          const Icon = stat.icon;
          return (
            <div key={index} className="card">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">{stat.title}</p>
                  <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
                  <p className="text-sm text-gray-500 mt-1">{stat.subtitle}</p>
                </div>
                <div className={`${stat.color} p-3 rounded-lg`}>
                  <Icon className="text-white" size={24} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">塘口状态</h2>
          <div className="space-y-3">
            {ponds.slice(0, 5).map((pond) => (
              <div key={pond.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${pond.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <div>
                    <p className="font-medium text-gray-900">{pond.name}</p>
                    <p className="text-sm text-gray-500">{pond.area}亩 · {pond.species || '未养殖'}</p>
                  </div>
                </div>
                <span className={`badge ${pond.status === 'active' ? 'badge-success' : 'badge-info'}`}>
                  {pond.status === 'active' ? '使用中' : '闲置'}
                </span>
              </div>
            ))}
            {ponds.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Droplets className="mx-auto mb-2" size={48} />
                <p>暂无塘口数据</p>
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">最近批次</h2>
          <div className="space-y-3">
            {recentBatches.map((batch) => (
              <div key={batch.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center space-x-3">
                  <div className={`w-3 h-3 rounded-full ${batch.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`} />
                  <div>
                    <p className="font-medium text-gray-900">{batch.batch_number}</p>
                    <p className="text-sm text-gray-500">{batch.species} · 放苗: {batch.stocking_date}</p>
                  </div>
                </div>
                <span className={`badge ${batch.status === 'active' ? 'badge-success' : batch.status === 'harvested' ? 'badge-info' : 'badge-warning'}`}>
                  {batch.status === 'active' ? '养殖中' : batch.status === 'harvested' ? '已收获' : '已关闭'}
                </span>
              </div>
            ))}
            {batches.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <Fish className="mx-auto mb-2" size={48} />
                <p>暂无批次数据</p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">快速操作</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <button 
            onClick={() => navigate('/ponds')}
            className="flex flex-col items-center justify-center p-4 bg-ocean-50 rounded-lg hover:bg-ocean-100 transition-colors cursor-pointer group"
          >
            <Plus className="text-ocean-600 mb-2 group-hover:scale-110 transition-transform" size={24} />
            <span className="text-sm font-medium text-ocean-700">新增塘口</span>
          </button>
          <button 
            onClick={() => navigate('/batches')}
            className="flex flex-col items-center justify-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors cursor-pointer group"
          >
            <Fish className="text-green-600 mb-2 group-hover:scale-110 transition-transform" size={24} />
            <span className="text-sm font-medium text-green-700">新增批次</span>
          </button>
          <button 
            onClick={() => navigate('/feeding')}
            className="flex flex-col items-center justify-center p-4 bg-yellow-50 rounded-lg hover:bg-yellow-100 transition-colors cursor-pointer group"
          >
            <CheckCircle className="text-yellow-600 mb-2 group-hover:scale-110 transition-transform" size={24} />
            <span className="text-sm font-medium text-yellow-700">记录投喂</span>
          </button>
          <button 
            onClick={() => navigate('/medication')}
            className="flex flex-col items-center justify-center p-4 bg-red-50 rounded-lg hover:bg-red-100 transition-colors cursor-pointer group"
          >
            <AlertCircle className="text-red-600 mb-2 group-hover:scale-110 transition-transform" size={24} />
            <span className="text-sm font-medium text-red-700">记录用药</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
