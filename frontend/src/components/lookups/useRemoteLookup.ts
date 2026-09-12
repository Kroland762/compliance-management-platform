import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import apiClient from '../../api/client';
import { getApiErrorMessage } from '../../utils/error';
import type { LookupKind, LookupOption, LookupPage } from './types';

interface Params {
  kind: LookupKind;
  purpose: string;
  selectedIds?: string[];
  contextId?: string;
  pageSize?: number;
  debounceMs?: number;
}

export function useRemoteLookup({ kind, purpose, selectedIds = [], contextId, pageSize = 20, debounceMs = 250 }: Params) {
  const [options, setOptions] = useState<LookupOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const controller = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const cache = useRef(new Map<string, LookupOption>());
  const failedRequest = useRef<{ page: number; append: boolean } | null>(null);
  const selectedKey = selectedIds.slice(0, 50).join(',');

  const request = useCallback(async (q: string, nextPage: number, append = false) => {
    controller.current?.abort();
    const current = ++sequence.current;
    const nextController = new AbortController();
    controller.current = nextController;
    setLoading(true);
    setError(null);
    try {
      const response: any = await apiClient.get(`/lookup/options/${kind}`, {
        params: {
          purpose,
          q: q || undefined,
          page: nextPage,
          pageSize,
          selectedIds: selectedKey || undefined,
          contextId: contextId || undefined,
        },
        signal: nextController.signal,
      });
      if (current !== sequence.current) return;
      const data = response.data as LookupPage;
      [...(data.items || []), ...(data.selectedItems || [])].forEach((item) => cache.current.set(item.value, item));
      setOptions((previous) => {
        const selectedSet = new Set(selectedIds);
        const results = new Map<string, LookupOption>();
        if (append) previous.forEach((item) => {
          if (!selectedSet.has(item.value)) results.set(item.value, item);
        });
        (data.items || []).forEach((item) => {
          if (!selectedSet.has(item.value)) results.set(item.value, item);
        });
        const retained = new Map<string, LookupOption>();
        selectedIds.forEach((id) => {
          const selected = cache.current.get(id);
          if (selected) retained.set(id, selected);
        });
        return [...results.values(), ...retained.values()];
      });
      setPage(data.pagination.page);
      setHasMore(data.pagination.hasMore);
      failedRequest.current = null;
    } catch (requestError: any) {
      if (requestError?.code !== 'ERR_CANCELED' && current === sequence.current) {
        failedRequest.current = { page: nextPage, append };
        setError(getApiErrorMessage(requestError, '加载选项失败'));
      }
    } finally {
      if (current === sequence.current) setLoading(false);
    }
  }, [contextId, kind, pageSize, purpose, selectedKey]);

  const search = useCallback((value: string) => {
    const q = value.trim();
    setKeyword(q);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => request(q, 1), q ? debounceMs : 0);
  }, [debounceMs, request]);

  const open = useCallback(() => {
    if (!page && !loading) request(keyword, 1);
  }, [keyword, loading, page, request]);

  const loadMore = useCallback(() => {
    if (!loading && hasMore) request(keyword, page + 1, true);
  }, [hasMore, keyword, loading, page, request]);

  const retry = useCallback(() => {
    const failed = failedRequest.current;
    request(keyword, failed?.page || page || 1, failed?.append ?? page > 1);
  }, [keyword, page, request]);

  useEffect(() => {
    setOptions((previous) => previous.filter((item) => selectedIds.includes(item.value)));
    setPage(0);
    setHasMore(true);
    failedRequest.current = null;
    return () => {
      clearTimeout(timer.current);
      controller.current?.abort();
      sequence.current += 1;
    };
  }, [kind, purpose, contextId]);

  useEffect(() => {
    let missingSelection = false;
    selectedIds.forEach((id) => {
      const selected = cache.current.get(id);
      if (selected) setOptions((previous) => previous.some((item) => item.value === id) ? previous : [selected, ...previous]);
      else missingSelection = true;
    });
    if (missingSelection) void request('', 1);
  }, [request, selectedKey]);

  return useMemo(() => ({ options, loading, error, search, open, loadMore, retry }), [error, loadMore, loading, open, options, retry, search]);
}
