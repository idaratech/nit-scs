import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '../client';

interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: string;
  [key: string]: unknown;
}

interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: { page: number; pageSize: number; total: number; totalPages: number };
  message?: string;
}

// ── List ────────────────────────────────────────────────────────────────────
export function useMrrvList(params?: ListParams) {
  return useQuery({
    queryKey: ['mrrv', 'list', params],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<unknown[]>>('/mrrv', { params });
      return data;
    },
  });
}

// ── Detail ──────────────────────────────────────────────────────────────────
export function useMrrv(id: string | undefined) {
  return useQuery({
    queryKey: ['mrrv', id],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<unknown>>(`/mrrv/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ── Create ──────────────────────────────────────────────────────────────────
export function useCreateMrrv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>('/mrrv', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrrv'] }),
  });
}

// ── Update ──────────────────────────────────────────────────────────────────
export function useUpdateMrrv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: string }) => {
      const { data } = await apiClient.put<ApiResponse<unknown>>(`/mrrv/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrrv'] }),
  });
}

// ── Status Transitions ──────────────────────────────────────────────────────
export function useSubmitMrrv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mrrv/${id}/submit`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrrv'] }),
  });
}

export function useApproveQcMrrv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mrrv/${id}/approve-qc`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrrv'] }),
  });
}

export function useReceiveMrrv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mrrv/${id}/receive`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mrrv'] }),
  });
}

export function useStoreMrrv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mrrv/${id}/store`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mrrv'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
