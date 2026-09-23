import axios from 'axios';
import type {
  Pond, Batch, StockingRecord, FeedingRecord, WaterQualityRecord,
  MedicationRecord, CostRecord, HarvestSale, CultureCycleAnalysis,
  CostSummary, FeedingSummary, BatchTraceability
} from '../types';

const API_BASE_URL = '/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const pondApi = {
  getAll: () => api.get<Pond[]>('/ponds/'),
  getById: (id: number) => api.get<Pond>(`/ponds/${id}/`),
  create: (data: Omit<Pond, 'id' | 'created_at' | 'updated_at'>) => 
    api.post<Pond>('/ponds/', data),
  update: (id: number, data: Partial<Pond>) => 
    api.put<Pond>(`/ponds/${id}/`, data),
  delete: (id: number) => api.delete(`/ponds/${id}/`),
};

export const batchApi = {
  getAll: () => api.get<Batch[]>('/batches/'),
  getById: (id: number) => api.get<Batch>(`/batches/${id}/`),
  getByNumber: (batchNumber: string) => 
    api.get<Batch>(`/batches/by-number/${batchNumber}/`),
  create: (data: Omit<Batch, 'id' | 'created_at' | 'updated_at'>) => 
    api.post<Batch>('/batches/', data),
  update: (id: number, data: Partial<Batch>) => 
    api.put<Batch>(`/batches/${id}/`, data),
  delete: (id: number) => api.delete(`/batches/${id}/`),
};

export const stockingRecordApi = {
  getAll: (batchId?: number) => 
    api.get<StockingRecord[]>('/stocking-records/', { 
      params: batchId ? { batch_id: batchId } : {} 
    }),
  getById: (id: number) => api.get<StockingRecord>(`/stocking-records/${id}/`),
  create: (data: Omit<StockingRecord, 'id' | 'created_at'>) => 
    api.post<StockingRecord>('/stocking-records/', data),
  update: (id: number, data: Partial<StockingRecord>) => 
    api.put<StockingRecord>(`/stocking-records/${id}/`, data),
  delete: (id: number) => api.delete(`/stocking-records/${id}/`),
};

export const feedingRecordApi = {
  getAll: (batchId?: number) => 
    api.get<FeedingRecord[]>('/feeding-records/', { 
      params: batchId ? { batch_id: batchId } : {} 
    }),
  getById: (id: number) => api.get<FeedingRecord>(`/feeding-records/${id}/`),
  create: (data: Omit<FeedingRecord, 'id' | 'created_at'>) => 
    api.post<FeedingRecord>('/feeding-records/', data),
  update: (id: number, data: Partial<FeedingRecord>) => 
    api.put<FeedingRecord>(`/feeding-records/${id}/`, data),
  delete: (id: number) => api.delete(`/feeding-records/${id}/`),
};

export const waterQualityRecordApi = {
  getAll: (batchId?: number) => 
    api.get<WaterQualityRecord[]>('/water-quality-records/', { 
      params: batchId ? { batch_id: batchId } : {} 
    }),
  getById: (id: number) => api.get<WaterQualityRecord>(`/water-quality-records/${id}/`),
  create: (data: Omit<WaterQualityRecord, 'id' | 'created_at'>) => 
    api.post<WaterQualityRecord>('/water-quality-records/', data),
  update: (id: number, data: Partial<WaterQualityRecord>) => 
    api.put<WaterQualityRecord>(`/water-quality-records/${id}/`, data),
  delete: (id: number) => api.delete(`/water-quality-records/${id}/`),
};

export const medicationRecordApi = {
  getAll: (batchId?: number) => 
    api.get<MedicationRecord[]>('/medication-records/', { 
      params: batchId ? { batch_id: batchId } : {} 
    }),
  getById: (id: number) => api.get<MedicationRecord>(`/medication-records/${id}/`),
  create: (data: Omit<MedicationRecord, 'id' | 'created_at'>) => 
    api.post<MedicationRecord>('/medication-records/', data),
  update: (id: number, data: Partial<MedicationRecord>) => 
    api.put<MedicationRecord>(`/medication-records/${id}/`, data),
  delete: (id: number) => api.delete(`/medication-records/${id}/`),
};

export const costRecordApi = {
  getAll: (batchId?: number, costType?: string) => 
    api.get<CostRecord[]>('/cost-records/', { 
      params: { batch_id: batchId, cost_type: costType } 
    }),
  getById: (id: number) => api.get<CostRecord>(`/cost-records/${id}/`),
  create: (data: Omit<CostRecord, 'id' | 'created_at'>) => 
    api.post<CostRecord>('/cost-records/', data),
  update: (id: number, data: Partial<CostRecord>) => 
    api.put<CostRecord>(`/cost-records/${id}/`, data),
  delete: (id: number) => api.delete(`/cost-records/${id}/`),
};

export const harvestSaleApi = {
  getAll: (batchId?: number) => 
    api.get<HarvestSale[]>('/harvest-sales/', { 
      params: batchId ? { batch_id: batchId } : {} 
    }),
  getById: (id: number) => api.get<HarvestSale>(`/harvest-sales/${id}/`),
  create: (data: Omit<HarvestSale, 'id' | 'created_at'>) => 
    api.post<HarvestSale>('/harvest-sales/', data),
  update: (id: number, data: Partial<HarvestSale>) => 
    api.put<HarvestSale>(`/harvest-sales/${id}/`, data),
  delete: (id: number) => api.delete(`/harvest-sales/${id}/`),
};

export const analysisApi = {
  analyzeCycle: (batchId: number) => 
    api.get<CultureCycleAnalysis>(`/analysis/cycle/${batchId}/`),
  batchTraceability: (batchId: number) => 
    api.get<BatchTraceability>(`/analysis/traceability/${batchId}/`),
  traceByBatchNumber: (batchNumber: string) => 
    api.get<BatchTraceability>(`/analysis/trace-by-number/${batchNumber}/`),
};

export default api;
