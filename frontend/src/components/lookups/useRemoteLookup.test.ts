import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../../api/client';
import { useRemoteLookup } from './useRemoteLookup';

vi.mock('../../api/client', () => ({ default: { get: vi.fn() } }));

const page = (items: any[], current = 1, hasMore = false, selectedItems: any[] = []) => ({
  data: {
    items,
    selectedItems,
    pagination: { page: current, pageSize: 20, total: items.length, totalPages: hasMore ? current + 1 : current, hasMore },
  },
});

describe('useRemoteLookup', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('debounces a name query and sends the selected ids and context', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockResolvedValue(page([]) as any);
    const { result } = renderHook(() => useRemoteLookup({
      kind: 'departments', purpose: 'asset-owner', selectedIds: ['selected-1'], contextId: 'asset-1',
    }));

    act(() => {
      result.current.search('风');
      result.current.search('风险管理部');
      vi.advanceTimersByTime(249);
    });
    expect(apiClient.get).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });

    expect(apiClient.get).toHaveBeenCalledTimes(1);
    expect(apiClient.get).toHaveBeenCalledWith('/lookup/options/departments', expect.objectContaining({
      params: expect.objectContaining({ purpose: 'asset-owner', q: '风险管理部', selectedIds: 'selected-1', contextId: 'asset-1' }),
      signal: expect.any(AbortSignal),
    }));
  });

  it('ignores an older response that arrives after the latest search', async () => {
    vi.useFakeTimers();
    let resolveOld!: (value: any) => void;
    let resolveNew!: (value: any) => void;
    vi.mocked(apiClient.get)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }) as any)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNew = resolve; }) as any);
    const { result } = renderHook(() => useRemoteLookup({ kind: 'personnel', purpose: 'asset-owner' }));

    act(() => result.current.open());
    act(() => { result.current.search('新'); vi.advanceTimersByTime(250); });
    await act(async () => { resolveNew(page([{ value: 'new', label: '新结果', disabled: false }])); await Promise.resolve(); });
    expect(result.current.options.map((item) => item.value)).toEqual(['new']);
    await act(async () => { resolveOld(page([{ value: 'old', label: '旧结果', disabled: false }])); await Promise.resolve(); });
    expect(result.current.options.map((item) => item.value)).toEqual(['new']);
  });

  it('deduplicates paged results and permanently retains selected options', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(page([{ value: 'a', label: '甲', disabled: false }], 1, true, [{ value: 'selected', label: '历史项', disabled: true }]) as any)
      .mockResolvedValueOnce(page([
        { value: 'a', label: '甲', disabled: false },
        { value: 'b', label: '乙', disabled: false },
      ], 2, false, [{ value: 'selected', label: '历史项', disabled: true }]) as any);
    const { result } = renderHook(() => useRemoteLookup({ kind: 'roles', purpose: 'user-membership', selectedIds: ['selected'] }));

    await act(async () => result.current.open());
    await waitFor(() => expect(result.current.options.map((item) => item.value)).toEqual(['a', 'selected']));
    await act(async () => result.current.loadMore());
    await waitFor(() => expect(result.current.options.map((item) => item.value)).toEqual(['a', 'b', 'selected']));
    expect(result.current.options.find((item) => item.value === 'selected')?.disabled).toBe(true);
  });

  it('places current search matches before retained selections for keyboard choice', async () => {
    vi.useFakeTimers();
    vi.mocked(apiClient.get).mockResolvedValue(page(
      [{ value: 'match', label: '当前匹配', disabled: false }],
      1,
      false,
      [{ value: 'selected', label: '已选项', disabled: false }],
    ) as any);
    const { result } = renderHook(() => useRemoteLookup({
      kind: 'assets', purpose: 'evaluation-assignment', selectedIds: ['selected'],
    }));

    await act(async () => {
      result.current.search('当前匹配');
      vi.advanceTimersByTime(250);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.options.map((item) => item.value)).toEqual(['match', 'selected']);
  });

  it('keeps existing options after failure and can retry in place', async () => {
    vi.mocked(apiClient.get)
      .mockResolvedValueOnce(page([{ value: 'a', label: '甲', disabled: false }], 1, true) as any)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(page([{ value: 'b', label: '乙', disabled: false }], 2) as any);
    const { result } = renderHook(() => useRemoteLookup({ kind: 'roles', purpose: 'user-membership' }));

    act(() => result.current.open());
    await waitFor(() => expect(result.current.options).toHaveLength(1));
    act(() => result.current.loadMore());
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.options.map((item) => item.value)).toEqual(['a']);
    await act(async () => result.current.retry());
    await waitFor(() => expect(result.current.options.map((item) => item.value)).toEqual(['a', 'b']));
    expect(result.current.error).toBeNull();
  });
});
