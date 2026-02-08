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
export function useOsdList(params?: ListParams) {
  return useQuery({
    queryKey: ['osd', 'list', params],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<unknown[]>>('/osd', { params });
      return data;
    },
  });
}

// ── Detail ──────────────────────────────────────────────────────────────────
export function useOsd(id: string | undefined) {
  return useQuery({
    queryKey: ['osd', id],
    queryFn: async () => {
      const { data } = await apiClient.get<ApiResponse<unknown>>(`/osd/${id}`);
      return data;
    },
    enabled: !!id,
  });
}

// ── Create ──────────────────────────────────────────────────────────────────
export function useCreateOsd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>('/osd', body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['osd'] }),
  });
}

// ── Update ──────────────────────────────────────────────────────────────────
export function useUpdateOsd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: string }) => {
      const { data } = await apiClient.put<ApiResponse<unknown>>(`/osd/${id}`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['osd'] }),
  });
}

// ── Status Transitions ──────────────────────────────────────────────────────
export function useSendClaimOsd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/osd/${id}/send-claim`);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['osd'] }),
  });
}

export function useResolveOsd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: Record<string, unknown> & { id: string }) => {
      const { data } = await apiClient.post<ApiResponse<unknown>>(`/osd/${id}/resolve`, body);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['osd'] }),
  });
}
