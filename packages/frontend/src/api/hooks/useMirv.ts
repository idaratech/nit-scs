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
export function useMirvList(params?: ListParams) {
  return useQuery({
    queryKey: ['mirv', 'list', params],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<unknown[]>>('/mirv', { params });
      return data;
    },
  });
}

// ── Detail ──────────────────────────────────────────────────────────────────
export function useMirv(id: string | undefined) {
  return useQuery({
    queryKey: ['mirv', id],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<unknown>>(`/mirv/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ── Create ──────────────────────────────────────────────────────────────────
export function useCreateMirv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>('/mirv', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mirv'] }),
  });
}

// ── Update ──────────────────────────────────────────────────────────────────
export function useUpdateMirv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: string }) => {
      const { data } = await apiClient.put<ApiResponse<unknown>>(`/mirv/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mirv'] }),
  });
}

// ── Status Transitions ──────────────────────────────────────────────────────
export function useSubmitMirv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mirv/${id}/submit`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mirv'] }),
  });
}

export function useApproveMirv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mirv/${id}/approve`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mirv'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useIssueMirv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mirv/${id}/issue`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mirv'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
      qc.invalidateQueries({ queryKey: ['gate-passes'] });
    },
  });
}

export function useCancelMirv() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/mirv/${id}/cancel`);
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mirv'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}
