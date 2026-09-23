import React from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, Fish, Droplets, Pill, DollarSign, 
  TrendingUp, Plus, Search, Menu, X
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Ponds from './pages/Ponds';
import Batches from './pages/Batches';
import StockingRecords from './pages/StockingRecords';
import FeedingRecords from './pages/FeedingRecords';
import WaterQuality from './pages/WaterQuality';
import MedicationRecords from './pages/MedicationRecords';
import CostRecords from './pages/CostRecords';
import HarvestSales from './pages/HarvestSales';
import Analysis from './pages/Analysis';

const Sidebar: React.FC = () => {
  const location = useLocation();
  const [isOpen, setIsOpen] = React.useState(false);

  const menuItems = [
    { path: '/', icon: LayoutDashboard, label: '仪表盘' },
    { path: '/ponds', icon: Droplets, label: '塘口管理' },
    { path: '/batches', icon: Fish, label: '批次管理' },
    { path: '/stocking', icon: Plus, label: '投苗记录' },
    { path: '/feeding', icon: Search, label: '投喂记录' },
    { path: '/water-quality', icon: Droplets, label: '水质监测' },
    { path: '/medication', icon: Pill, label: '用药记录' },
    { path: '/costs', icon: DollarSign, label: '成本核算' },
    { path: '/harvest', icon: Fish, label: '出塘销售' },
    { path: '/analysis', icon: TrendingUp, label: '养殖分析' },
  ];

  return (
    <>
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="fixed top-4 left-4 z-50 p-2 bg-ocean-600 text-white rounded-lg md:hidden"
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      <div className={`fixed inset-y-0 left-0 z-40 w-64 bg-ocean-900 text-white transform transition-transform duration-300 ease-in-out md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="p-6">
          <h1 className="text-xl font-bold text-ocean-100">水产养殖管理系统</h1>
        </div>
        <nav className="mt-4">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsOpen(false)}
                className={`flex items-center px-6 py-3 text-sm font-medium transition-colors ${
                  isActive 
                    ? 'bg-ocean-700 text-white border-r-4 border-ocean-400' 
                    : 'text-ocean-200 hover:bg-ocean-800 hover:text-white'
                }`}
              >
                <Icon size={20} className="mr-3" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
      
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-30 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}
    </>
  );
};

const App: React.FC = () => {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Sidebar />
        <main className="md:ml-64 p-6">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/ponds" element={<Ponds />} />
            <Route path="/batches" element={<Batches />} />
            <Route path="/stocking" element={<StockingRecords />} />
            <Route path="/feeding" element={<FeedingRecords />} />
            <Route path="/water-quality" element={<WaterQuality />} />
            <Route path="/medication" element={<MedicationRecords />} />
            <Route path="/costs" element={<CostRecords />} />
            <Route path="/harvest" element={<HarvestSales />} />
            <Route path="/analysis" element={<Analysis />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
};

export default App;
