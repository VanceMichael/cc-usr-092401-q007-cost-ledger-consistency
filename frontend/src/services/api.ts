import axios from 'axios';
import type {
  Pond, Batch, StockingRecord, FeedingRecord, WaterQualityRecord,
  MedicationRecord, CostRecord, CostSummary, CostAdjustmentInput,
  CostRepairIssue, CostRepairStatus,
  HarvestSale, CultureCycleAnalysis,
  FeedingSummary, BatchTraceability
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

export interface CostRecordQuery {
  batchId?: number;
  costType?: string;
  startDate?: string;
  endDate?: string;
  includeRevoked?: boolean;
}

export const costRecordApi = {
  getAll: (query: CostRecordQuery = {}) =>
    api.get<CostRecord[]>('/cost-records/', {
      params: {
        batch_id: query.batchId,
        cost_type: query.costType,
        start_date: query.startDate,
        end_date: query.endDate,
        include_revoked: query.includeRevoked || undefined,
      }
    }),
  getById: (id: number) => api.get<CostRecord>(`/cost-records/${id}/`),
  create: (data: Partial<CostRecord> & {
    batch_id: number; cost_date: string; cost_type: string;
    client_token?: string;
  }) =>
    api.post<CostRecord>('/cost-records/', data),
  // 更新必须携带 version 做乐观锁
  update: (id: number, data: Partial<Omit<CostRecord, 'id'>> & { version: number }) =>
    api.put<CostRecord>(`/cost-records/${id}/`, data),
  revoke: (id: number, reason?: string) =>
    api.post<CostRecord>(`/cost-records/${id}/revoke/`, { reason }),
  delete: (id: number) => api.delete(`/cost-records/${id}/`),
  addAdjustment: (id: number, data: CostAdjustmentInput) =>
    api.post<CostRecord>(`/cost-records/${id}/adjustments/`, data),
  summary: (query: CostRecordQuery = {}) =>
    api.get<CostSummary>('/cost-records/summary/', {
      params: {
        batch_id: query.batchId,
        cost_type: query.costType,
        start_date: query.startDate,
        end_date: query.endDate,
      }
    }),
  repairScan: (params: { after_id?: number; limit?: number; batch_id?: number } = {}) =>
    api.post<{ scanned_window: number; next_after_id: number; issues: CostRepairIssue[] }>(
      '/cost-records/repair/scan', null, { params }
    ),
  repairRun: (data: { run_key: string; batch_size?: number; max_batches?: number }) =>
    api.post<CostRepairStatus>('/cost-records/repair/run', data),
  repairStatus: (runKey: string) =>
    api.get<CostRepairStatus>(`/cost-records/repair/${runKey}/`),
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
