import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import {
  Button,
  Empty,
  Input,
  message,
  Modal,
  Pagination,
  Popover,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  Upload,
} from 'antd';
import { ClearOutlined, FileSearchOutlined, HistoryOutlined, SaveOutlined, SearchOutlined, SplitCellsOutlined, SyncOutlined, UploadOutlined } from '@ant-design/icons';
import { useParams, useSearchParams } from 'react-router-dom';
import apiClient from '../api/client';
import FilePreviewModal, { type PreviewableEvidenceFile } from '../components/FilePreviewModal';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';
import { COMPLIANCE_STATUS } from '../constants/status';
import {
  normalizeEvaluationColumnSchema,
  type EvaluationColumnDefinition,
} from '../utils/evaluationColumns';
import {
  compactEvaluationFilters,
  hasEvaluationFilters,
  parseEvaluationFilters,
  type DynamicEvaluationFilter,
  type EvaluationFilterOptions,
  type EvaluationFilters,
} from '../utils/evaluationFilters';
import { AuditorSelect, PersonnelSelect } from '../components/lookups';
import {
  ColumnFilterButton,
  DynamicColumnFilterControl,
  MultiColumnFilter,
  PresenceColumnFilter,
  TextColumnFilter,
} from '../components/EvaluationFilterControls';

const workflow: Record<string, { text: string; color: string }> = {
  pending: { text: '待填写', color: 'default' },
  in_progress: { text: '填写中', color: 'processing' },
  submitted: { text: '待复核', color: 'orange' },
  returned: { text: '已退回', color: 'red' },
  reviewed: { text: '已复核', color: 'green' },
};

const editableStatuses = ['pending', 'in_progress', 'returned'];
const workflowOptions = Object.entries(workflow).map(([value, item]) => ({ value, label: item.text }));
const complianceOptions = Object.entries(COMPLIANCE_STATUS).map(([value, item]) => ({ value, label: item.text }));
const severityOptions = [
  { value: 'critical', label: '严重' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' },
];
const emptyFilterOptions: EvaluationFilterOptions = { controlDomains: [], dynamicColumns: {} };
const MIN_COLUMN_WIDTH = 80;
const MAX_COLUMN_WIDTH = 1000;

type ResizableHeaderCellProps = HTMLAttributes<HTMLTableCellElement> & {
  width?: number;
  resizeLabel?: string;
  onResize?: (width: number) => void;
  onReset?: () => void;
};

function clampColumnWidth(width: number) {
  if (!Number.isFinite(width)) return MIN_COLUMN_WIDTH;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, Math.round(width)));
}

function columnWidthStorageKey(taskId?: string, userId?: string) {
  return `evaluation-workbench:column-widths:${userId || 'anonymous'}:${taskId || 'unknown'}`;
}

function loadColumnWidths(storageKey: string) {
  if (typeof window === 'undefined') return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value)
      .filter(([key, width]) => key && typeof width === 'number' && Number.isFinite(width))
      .map(([key, width]) => [key, clampColumnWidth(width as number)]));
  } catch {
    return {};
  }
}

function ResizableHeaderCell({
  width,
  resizeLabel,
  onResize,
  onReset,
  className,
  style,
  children,
  ...rest
}: ResizableHeaderCellProps) {
  const cleanupRef = useRef<((updateHandle?: boolean) => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(false), []);

  const startResize = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!width || !onResize) return;
    event.preventDefault();
    event.stopPropagation();
    cleanupRef.current?.();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = width;
    let nextWidth = startWidth;
    let animationFrame: number | undefined;

    const applyResize = () => {
      animationFrame = undefined;
      onResize(nextWidth);
    };
    const move = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      if (!Number.isFinite(delta)) return;
      nextWidth = clampColumnWidth(startWidth + delta);
      if (animationFrame === undefined) animationFrame = window.requestAnimationFrame(applyResize);
    };
    const cleanup = (updateHandle = true) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
        onResize(nextWidth);
      }
      document.body.classList.remove('evaluation-column-resizing');
      if (updateHandle) handle.classList.remove('is-resizing');
      cleanupRef.current = null;
    };
    const finish = () => cleanup();

    cleanupRef.current = cleanup;
    handle.classList.add('is-resizing');
    document.body.classList.add('evaluation-column-resizing');
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', finish);
    document.addEventListener('pointercancel', finish);
  };

  return <th
    {...rest}
    className={[className, onResize ? 'evaluation-resizable-header' : ''].filter(Boolean).join(' ')}
    style={{ ...style, width }}
  >
    {children}
    {width && onResize && <span
      role="separator"
      aria-label={`调整${resizeLabel || '当前'}列宽`}
      aria-orientation="vertical"
      aria-valuemin={MIN_COLUMN_WIDTH}
      aria-valuemax={MAX_COLUMN_WIDTH}
      aria-valuenow={width}
      className="evaluation-column-resize-handle"
      title="拖动调整列宽，双击恢复默认"
      tabIndex={0}
      onPointerDown={startResize}
      onDoubleClick={(event) => { event.preventDefault(); event.stopPropagation(); onReset?.(); }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          onResize(clampColumnWidth(width + (event.key === 'ArrowRight' ? 10 : -10)));
        } else if (event.key === 'Home') {
          event.preventDefault();
          onReset?.();
        }
      }}
    />}
  </th>;
}

type AnswerDraftCellProps = {
  itemId: string;
  sequenceNumber: string;
  initialValue: string;
  onDraftChange: (value: string) => void;
};

type ReviewDraft = {
  complianceStatus?: string;
  findingDescription?: string;
  findingSeverity?: string;
};

const AnswerDraftCell = memo(function AnswerDraftCell({
  itemId,
  sequenceNumber,
  initialValue,
  onDraftChange,
}: AnswerDraftCellProps) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => setValue(initialValue), [itemId, initialValue]);

  return <Input.TextArea
    aria-label={`填写 ${sequenceNumber} 的现状说明`}
    autoSize={{ minRows: 3, maxRows: 8 }}
    value={value}
    placeholder="请填写当前实际情况；点击提交后保存"
    onChange={(event) => {
      const nextValue = event.target.value;
      setValue(nextValue);
      onDraftChange(nextValue);
    }}
  />;
});

function templateValue(item: any, key: string) {
  const snapshot = item.templateDataSnapshot || {};
  if (key.startsWith('extraData.')) return snapshot.extraData?.[key.slice('extraData.'.length)] ?? '—';
  return snapshot[key] ?? item[key] ?? '—';
}

export default function EvaluationWorkbench() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const can = useAuthStore((state) => state.hasPermission);
  const user = useAuthStore((state) => state.user);
  const [task, setTask] = useState<any>();
  const [scopeAssets, setScopeAssets] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [reviewErrors, setReviewErrors] = useState<Record<string, string>>({});
  const [reopening, setReopening] = useState<any>();
  const [reopenReason, setReopenReason] = useState('');
  const [transferring, setTransferring] = useState<any>();
  const [transferTo, setTransferTo] = useState<string>();
  const [splitting, setSplitting] = useState<any>();
  const [splitAssetIds, setSplitAssetIds] = useState<string[]>([]);
  const [historyFor, setHistoryFor] = useState<any>();
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [syncingColumns, setSyncingColumns] = useState(false);
  const [previewFile, setPreviewFile] = useState<PreviewableEvidenceFile | null>(null);
  const initialPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const initialPageSize = [20, 50, 100].includes(Number(searchParams.get('pageSize'))) ? Number(searchParams.get('pageSize')) : 100;
  const initialFilters = compactEvaluationFilters(parseEvaluationFilters(searchParams.get('filters')));
  const initialQuery = searchParams.get('q') || '';
  const [queryDraft, setQueryDraft] = useState(initialQuery);
  const [filterDraft, setFilterDraft] = useState<EvaluationFilters>(initialFilters);
  const [filterOptions, setFilterOptions] = useState<EvaluationFilterOptions>(emptyFilterOptions);
  const [unfilteredTotal, setUnfilteredTotal] = useState(0);
  const [pagination, setPagination] = useState({ page: initialPage, pageSize: initialPageSize, total: 0 });
  const answerDrafts = useRef(new Map<string, string>());
  const [dirtyItemIds, setDirtyItemIds] = useState<Set<string>>(() => new Set());
  const filterApplyTimer = useRef<ReturnType<typeof setTimeout>>();
  const requestController = useRef<AbortController>();
  const itemsRef = useRef<any[]>([]);
  const queryDraftRef = useRef(initialQuery);
  const filterDraftRef = useRef<EvaluationFilters>(initialFilters);
  const appliedQueryRef = useRef(initialQuery);
  const appliedFiltersRef = useRef<EvaluationFilters>(initialFilters);
  const widthPreferenceKey = columnWidthStorageKey(id, user?.id);
  const [widthPreference, setWidthPreference] = useState(() => ({
    storageKey: widthPreferenceKey,
    widths: loadColumnWidths(widthPreferenceKey),
  }));
  const columnWidths = widthPreference.storageKey === widthPreferenceKey ? widthPreference.widths : {};
  const historyRecords = history.filter((record) => (
    String(record.currentStatusDescription || '').trim()
    || (record.evidenceFiles || []).length > 0
  ));

  useEffect(() => {
    setWidthPreference((current) => current.storageKey === widthPreferenceKey
      ? current
      : { storageKey: widthPreferenceKey, widths: loadColumnWidths(widthPreferenceKey) });
  }, [widthPreferenceKey]);

  useEffect(() => {
    if (widthPreference.storageKey !== widthPreferenceKey) return undefined;
    const timer = window.setTimeout(() => {
      if (Object.keys(widthPreference.widths).length) {
        window.localStorage.setItem(widthPreferenceKey, JSON.stringify(widthPreference.widths));
      } else {
        window.localStorage.removeItem(widthPreferenceKey);
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [widthPreference, widthPreferenceKey]);

  const requestParams = (page: number, pageSize: number, q: string, filters: EvaluationFilters) => {
    const compact = compactEvaluationFilters(filters);
    return {
      page,
      pageSize,
      ...(q.trim() ? { q: q.trim() } : {}),
      ...(hasEvaluationFilters(compact) ? { filters: JSON.stringify(compact) } : {}),
    };
  };

  const syncUrl = (page: number, pageSize: number, q: string, filters: EvaluationFilters) => {
    const params: Record<string, string> = { page: String(page), pageSize: String(pageSize) };
    if (q.trim()) params.q = q.trim();
    const compact = compactEvaluationFilters(filters);
    if (hasEvaluationFilters(compact)) params.filters = JSON.stringify(compact);
    setSearchParams(params, { replace: true });
  };

  const loadPage = async (
    page = pagination.page,
    pageSize = pagination.pageSize,
    q = appliedQueryRef.current,
    filters = appliedFiltersRef.current,
  ) => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setLoading(true);
    try {
      const evaluationResponse: any = await apiClient.get(`/tasks/${id}/evaluations`, {
        params: requestParams(page, pageSize, q, filters),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setItems(evaluationResponse.data?.items || []);
      itemsRef.current = evaluationResponse.data?.items || [];
      setPagination({
        page: evaluationResponse.data?.pagination?.page || page,
        pageSize,
        total: evaluationResponse.data?.pagination?.total || 0,
      });
      setUnfilteredTotal(evaluationResponse.data?.summary?.unfilteredTotal ?? evaluationResponse.data?.pagination?.total ?? 0);
    } catch (error: any) {
      if (error?.code !== 'ERR_CANCELED' && error?.name !== 'CanceledError') message.error(getApiErrorMessage(error, '评估表加载失败'));
    } finally {
      if (requestController.current === controller) setLoading(false);
    }
  };

  const loadFilterOptions = async () => {
    const response: any = await apiClient.get(`/tasks/${id}/evaluations/filter-options`);
    setFilterOptions(response.data || emptyFilterOptions);
    return response.data || emptyFilterOptions;
  };

  const load = async (page = pagination.page, pageSize = pagination.pageSize) => {
    await loadPage(page, pageSize);
  };

  useEffect(() => {
    void Promise.all([
      apiClient.get(`/tasks/${id}`),
      apiClient.get(`/tasks/${id}/assets`),
      loadFilterOptions(),
    ]).then(([taskResponse, scopeResponse]: any[]) => {
      setTask(taskResponse.data);
      setScopeAssets(scopeResponse.data?.items || []);
    }).catch((error) => message.error(getApiErrorMessage(error, '评估表配置加载失败')));
    void loadPage(initialPage, initialPageSize, initialQuery, initialFilters);
    return () => {
      if (filterApplyTimer.current) clearTimeout(filterApplyTimer.current);
      requestController.current?.abort();
    };
  }, [id]);

  useEffect(() => {
    const warnAboutUnsavedDrafts = (event: BeforeUnloadEvent) => {
      if (!answerDrafts.current.size && !Object.keys(reviewDrafts).length) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnAboutUnsavedDrafts);
    return () => window.removeEventListener('beforeunload', warnAboutUnsavedDrafts);
  }, [reviewDrafts]);

  const replaceItem = (updated: any) => setItems((current) => {
    const next = current.map((item) => item.id === updated.id ? updated : item);
    itemsRef.current = next;
    return next;
  });

  const updateAnswerDraft = (item: any, description: string) => {
    const savedDescription = item.currentStatusDescription || '';
    const dirty = description !== savedDescription;
    if (dirty) answerDrafts.current.set(item.id, description);
    else answerDrafts.current.delete(item.id);
    setDirtyItemIds((current) => {
      if (current.has(item.id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
  };

  const clearAnswerDraft = (itemId: string) => {
    answerDrafts.current.delete(itemId);
    setDirtyItemIds((current) => {
      if (!current.has(itemId)) return current;
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
  };

  const answerValue = (item: any) => answerDrafts.current.get(item.id) ?? item.currentStatusDescription ?? '';

  const reviewDraft = (item: any): ReviewDraft => ({
    complianceStatus: reviewDrafts[item.id]?.complianceStatus
      ?? (item.complianceStatus === 'not_assessed' ? undefined : item.complianceStatus),
    findingDescription: reviewDrafts[item.id]?.findingDescription ?? item.finding?.description ?? '',
    findingSeverity: reviewDrafts[item.id]?.findingSeverity ?? item.finding?.severity,
  });

  const updateReviewDraft = (item: any, patch: Partial<ReviewDraft>) => {
    setReviewErrors((current) => current[item.id] ? { ...current, [item.id]: '' } : current);
    setReviewDrafts((current) => ({
      ...current,
      [item.id]: { ...reviewDraft(item), ...current[item.id], ...patch },
    }));
  };

  const clearReviewDraft = (itemId: string) => setReviewDrafts((current) => {
    if (!current[itemId]) return current;
    const next = { ...current };
    delete next[itemId];
    return next;
  });

  const persistAnswerDraft = async (item: any) => {
    if (!answerDrafts.current.has(item.id)) return item;
    const response: any = await apiClient.put(`/evaluations/${item.id}/answer`, {
      currentStatusDescription: answerValue(item),
      lockVersion: item.lockVersion,
    });
    clearAnswerDraft(item.id);
    replaceItem(response.data);
    return response.data;
  };

  const applyFilters = async (q: string, filters: EvaluationFilters) => {
    const compact = compactEvaluationFilters(filters);
    appliedQueryRef.current = q.trim();
    appliedFiltersRef.current = compact;
    setSelected([]);
    syncUrl(1, pagination.pageSize, q, compact);
    await loadPage(1, pagination.pageSize, q, compact);
  };

  const queueFilterApply = (q: string, filters: EvaluationFilters, delay: number) => {
    if (filterApplyTimer.current) clearTimeout(filterApplyTimer.current);
    filterApplyTimer.current = setTimeout(() => { void applyFilters(q, filters); }, delay);
  };

  const updateFilters = (next: EvaluationFilters) => {
    const compact = compactEvaluationFilters(next);
    filterDraftRef.current = compact;
    setFilterDraft(compact);
    queueFilterApply(queryDraftRef.current, compact, 100);
  };

  const updateDynamicFilter = (key: string, value?: DynamicEvaluationFilter) => {
    const columns = { ...(filterDraftRef.current.columns || {}) };
    if (value) columns[key] = value;
    else delete columns[key];
    const next = compactEvaluationFilters({
      ...filterDraftRef.current,
      columns: Object.keys(columns).length ? columns : undefined,
    });
    filterDraftRef.current = next;
    setFilterDraft(next);
    queueFilterApply(queryDraftRef.current, next, value?.operator === 'contains' ? 300 : 100);
  };

  const updateAssets = async (item: any, assetIds: string[]) => {
    try {
      const response: any = await apiClient.put(`/evaluations/${item.id}/assets`, { assetIds }, {
        headers: { 'If-Match': `"${item.lockVersion}"` },
      });
      replaceItem(response.data);
      message.success('关联资产已更新');
    } catch (error) { message.error(getApiErrorMessage(error, '资产关联更新失败')); }
  };

  const updateAssignee = async (item: any, assigneeUserId: string) => {
    if (answerDrafts.current.has(item.id)) {
      message.warning('该行有未提交的填写内容，请先提交后再改派责任人');
      return;
    }
    const currentItem = itemsRef.current.find((row) => row.id === item.id) || item;
    setSaving((current) => ({ ...current, [item.id]: true }));
    try {
      const response: any = await apiClient.put(`/evaluations/${item.id}/assignee`, { assigneeUserId }, {
        headers: { 'If-Match': `"${currentItem.lockVersion}"` },
      });
      replaceItem(response.data);
      message.success('责任人已更新并通知新责任人');
    } catch (error) { message.error(getApiErrorMessage(error, '责任人改派失败')); }
    finally { setSaving((current) => ({ ...current, [item.id]: false })); }
  };

  const split = async () => {
    if (!splitting || !splitAssetIds.length) return;
    if (answerDrafts.current.has(splitting.id)) {
      message.warning('该行有未提交的填写内容，请先提交后再拆分资产');
      return;
    }
    try {
      await apiClient.post(`/evaluations/${splitting.id}/split`, { assetIds: splitAssetIds }, {
        headers: { 'If-Match': `"${splitting.lockVersion}"` },
      });
      message.success('已拆分为新的评估行，回答草稿已复制，证据未复制');
      setSplitting(undefined);
      setSplitAssetIds([]);
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '拆分失败')); }
  };

  const submit = async (item: any) => {
    const currentItem = itemsRef.current.find((row) => row.id === item.id) || item;
    if (!String(answerValue(currentItem)).trim()) {
      message.warning('请先填写现状说明');
      return;
    }
    setSaving((current) => ({ ...current, [item.id]: true }));
    try {
      const savedItem = await persistAnswerDraft(currentItem);
      await apiClient.post(`/evaluations/${item.id}/submit`, {}, { headers: { 'If-Match': `"${savedItem.lockVersion}"` } });
      message.success('评估行已提交复核');
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '提交失败')); }
    finally { setSaving((current) => ({ ...current, [item.id]: false })); }
  };

  const bulkSubmit = async () => {
    const rows = items.filter((item) => selected.includes(item.id));
    const incomplete = rows.find((item) => !String(answerValue(item)).trim());
    if (incomplete) {
      message.warning(`评估行 ${incomplete.sequenceNumber} 尚未填写现状说明`);
      return;
    }
    setBulkSubmitting(true);
    setSaving((current) => ({ ...current, ...Object.fromEntries(rows.map((item) => [item.id, true])) }));
    try {
      await apiClient.post(`/tasks/${id}/evaluations/bulk-submit`, {
        items: rows.map((item) => ({
          id: item.id,
          lockVersion: item.lockVersion,
          ...(answerDrafts.current.has(item.id)
            ? { currentStatusDescription: answerValue(item) }
            : {}),
        })),
      });
      rows.forEach((item) => clearAnswerDraft(item.id));
      message.success(`已提交 ${rows.length} 个评估行`);
      setSelected([]);
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '批量提交失败，所有行均未提交')); }
    finally {
      setSaving((current) => {
        const next = { ...current };
        rows.forEach((item) => { next[item.id] = false; });
        return next;
      });
      setBulkSubmitting(false);
    }
  };

  const upload = async (item: any, file: File) => {
    const data = new FormData();
    data.append('file', file);
    try {
      await apiClient.post(`/evaluations/${item.id}/evidence`, data, { headers: { 'Content-Type': 'multipart/form-data' } });
      message.success('证据已上传');
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '上传失败')); }
    return false;
  };

  const openHistory = async (item: any) => {
    setHistoryFor(item);
    setHistory([]);
    setHistoryLoading(true);
    try {
      const response: any = await apiClient.get(`/evaluations/${item.id}/history`);
      setHistory(response.data || []);
    } catch (error) { message.error(getApiErrorMessage(error, '历史回答与证据加载失败')); }
    finally { setHistoryLoading(false); }
  };

  const syncColumnSchema = async () => {
    setSyncingColumns(true);
    try {
      const response: any = await apiClient.put(`/tasks/${id}/column-schema/sync`);
      const nextSchema = response.data.columnSchemaSnapshot || [];
      setTask((current: any) => ({ ...current, columnSchemaSnapshot: nextSchema }));
      await loadFilterOptions();
      const visibleExtraKeys = new Set(normalizeEvaluationColumnSchema(nextSchema)
        .filter((column) => column.visible !== false && column.source === 'extra')
        .map((column) => column.key));
      const previousColumns = filterDraftRef.current.columns || {};
      const columns = Object.fromEntries(Object.entries(previousColumns)
        .filter(([key]) => visibleExtraKeys.has(key)));
      if (Object.keys(columns).length !== Object.keys(previousColumns).length) {
        updateFilters({ ...filterDraftRef.current, columns: Object.keys(columns).length ? columns : undefined });
      }
      message.success('模板列配置已同步，已有回答、资产和证据未改变');
    } catch (error) { message.error(getApiErrorMessage(error, '同步模板列配置失败')); }
    finally { setSyncingColumns(false); }
  };

  const claim = async (item: any) => {
    try { await apiClient.post(`/evaluations/${item.id}/review-claim`); message.success('已认领该评估行'); await load(); }
    catch (error) { message.error(getApiErrorMessage(error, '认领失败，该行可能已被其他审计员认领')); await load(); }
  };
  const returnReview = async (item: any) => {
    setReviewErrors((current) => ({ ...current, [item.id]: '' }));
    setSaving((current) => ({ ...current, [item.id]: true }));
    try {
      await apiClient.post(`/evaluations/${item.id}/review`, { return: true }, { headers: { 'If-Match': `"${item.lockVersion}"` } });
      clearReviewDraft(item.id);
      message.success('已退回填写人');
      await load();
    } catch (error) {
      const detail = getApiErrorMessage(error, '退回失败');
      setReviewErrors((current) => ({ ...current, [item.id]: detail }));
      message.error(detail);
    }
    finally { setSaving((current) => ({ ...current, [item.id]: false })); }
  };
  const review = async (item: any) => {
    const currentItem = itemsRef.current.find((row) => row.id === item.id) || item;
    const draft = reviewDraft(currentItem);
    if (!draft.complianceStatus) {
      setReviewErrors((current) => ({ ...current, [item.id]: '请先选择符合性结论' }));
      message.warning('请先选择符合性结论');
      return;
    }
    const requiresFinding = ['partial', 'non_compliant'].includes(draft.complianceStatus);
    if (requiresFinding && (!draft.findingDescription?.trim() || !draft.findingSeverity)) {
      setReviewErrors((current) => ({ ...current, [item.id]: '请填写不符合项描述和严重度' }));
      message.warning('部分符合或不符合时，请填写不符合项描述和严重度');
      return;
    }
    if (editableStatuses.includes(currentItem.workflowStatus) && !String(answerValue(currentItem)).trim()) {
      setReviewErrors((current) => ({ ...current, [item.id]: '请先填写现状说明' }));
      message.warning('请先填写现状说明');
      return;
    }
    if (currentItem.workflowStatus === 'submitted' && currentItem.reviewClaimedBy !== user?.id) {
      setReviewErrors((current) => ({ ...current, [item.id]: '请先认领该评估行' }));
      message.warning('请先认领该评估行');
      return;
    }
    setSaving((current) => ({ ...current, [item.id]: true }));
    setReviewErrors((current) => ({ ...current, [item.id]: '' }));
    try {
      const savedItem = editableStatuses.includes(currentItem.workflowStatus)
        ? await persistAnswerDraft(currentItem)
        : currentItem;
      await apiClient.post(`/evaluations/${item.id}/review`, {
        complianceStatus: draft.complianceStatus,
        return: false,
        ...(requiresFinding ? { finding: { description: draft.findingDescription?.trim(), severity: draft.findingSeverity } } : {}),
      }, { headers: { 'If-Match': `"${savedItem.lockVersion}"` } });
      clearReviewDraft(item.id);
      message.success('复核完成');
      await load();
    } catch (error) {
      const detail = getApiErrorMessage(error, '复核失败');
      setReviewErrors((current) => ({ ...current, [item.id]: detail }));
      message.error(detail);
    }
    finally { setSaving((current) => ({ ...current, [item.id]: false })); }
  };
  const reopenReview = async () => {
    if (!reopening || !reopenReason.trim()) return;
    setSaving((current) => ({ ...current, [reopening.id]: true }));
    try {
      await apiClient.post(`/evaluations/${reopening.id}/reopen`, { reason: reopenReason.trim() }, {
        headers: { 'If-Match': `"${reopening.lockVersion}"` },
      });
      clearReviewDraft(reopening.id);
      setReopening(undefined);
      setReopenReason('');
      message.success('已撤销复核，可重新编辑');
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '撤销复核失败')); }
    finally { setSaving((current) => ({ ...current, [reopening.id]: false })); }
  };
  const transfer = async () => {
    if (!transferring || !transferTo) return;
    try {
      await apiClient.put(`/evaluations/${transferring.id}/review-claim`, { auditorUserId: transferTo });
      message.success('已转派复核');
      setTransferring(undefined);
      setTransferTo(undefined);
      await load();
    } catch (error) { message.error(getApiErrorMessage(error, '转派失败')); }
  };

  const columnSchema = useMemo(() => {
    return normalizeEvaluationColumnSchema(task?.columnSchemaSnapshot || [])
      .filter((column) => column.visible !== false);
  }, [task?.columnSchemaSnapshot]);

  const canReopenReviewed = Boolean(user?.isGlobalAdmin
    || (can('tasks', 'update') && user?.permissionScopes?.tasks?.update === 'all'));

  const hasSeparateRequirementColumn = columnSchema.some((column) => column.key === 'extraData.检查内容');

  const renderTemplateColumn = (column: EvaluationColumnDefinition) => {
    const requirement = column.key === 'extraData.检查内容';
    const label = column.key === 'controlPoint'
      ? (hasSeparateRequirementColumn ? '评估点' : '评估点与要求')
      : requirement ? '评估要求' : column.label;
    let title: ReactNode = label;
    if (column.key === 'sequenceNumber') title = <ColumnFilterButton label={label} active={Boolean(filterDraft.sequenceNumber)}>
      <TextColumnFilter exact value={filterDraft.sequenceNumber} placeholder="输入完整序号" onChange={(value) => {
        const next = compactEvaluationFilters({ ...filterDraftRef.current, sequenceNumber: value });
        filterDraftRef.current = next;
        setFilterDraft(next);
        queueFilterApply(queryDraftRef.current, next, 300);
      }} />
    </ColumnFilterButton>;
    else if (column.key === 'controlPoint') title = <ColumnFilterButton label={label} active={Boolean(filterDraft.controlPoint)}>
      <TextColumnFilter value={filterDraft.controlPoint} placeholder="搜索评估点" onChange={(value) => {
        const next = { ...filterDraftRef.current, controlPoint: value };
        filterDraftRef.current = compactEvaluationFilters(next);
        setFilterDraft(filterDraftRef.current);
        queueFilterApply(queryDraftRef.current, filterDraftRef.current, 300);
      }} />
    </ColumnFilterButton>;
    else if (column.key === 'controlDomain') title = <ColumnFilterButton label={label} active={Boolean(filterDraft.controlDomains?.length)}>
      <MultiColumnFilter value={filterDraft.controlDomains}
        options={filterOptions.controlDomains.map((value) => ({ value, label: value }))}
        placeholder="选择控制域" onChange={(value) => updateFilters({ ...filterDraftRef.current, controlDomains: value })} />
    </ColumnFilterButton>;
    else if (requirement) {
      const condition = filterDraft.columns?.[column.key];
      title = <ColumnFilterButton label={label} active={Boolean(condition)}>
        <TextColumnFilter value={condition?.operator === 'contains' ? condition.value : undefined}
          placeholder="搜索评估要求"
          onChange={(value) => updateDynamicFilter(column.key, value ? { operator: 'contains', value } : undefined)} />
      </ColumnFilterButton>;
    }
    else if (column.source === 'extra') {
      const definition = filterOptions.dynamicColumns[column.key] || { mode: 'text' as const, hasEmpty: false };
      title = <ColumnFilterButton label={label} active={Boolean(filterDraft.columns?.[column.key])}>
        <DynamicColumnFilterControl definition={definition} value={filterDraft.columns?.[column.key]}
          onChange={(value) => updateDynamicFilter(column.key, value)} />
      </ColumnFilterButton>;
    }
    return {
      title,
      key: column.key,
      width: Number(column.width) || 180,
      ellipsis: column.key === 'controlPoint' || requirement ? false : true,
      render: (_: unknown, item: any) => column.key === 'controlPoint'
        ? <Space direction="vertical" size={4}>
            <Typography.Text>{String(templateValue(item, column.key))}</Typography.Text>
            {!hasSeparateRequirementColumn && String(templateValue(item, 'extraData.检查内容')) !== '—' && (
              <Typography.Text type="secondary" style={{ whiteSpace: 'normal', lineHeight: 1.55 }}>
                要求：{String(templateValue(item, 'extraData.检查内容'))}
              </Typography.Text>
            )}
          </Space>
        : requirement
          ? <Typography.Paragraph style={{ margin: 0, whiteSpace: 'normal', lineHeight: 1.55 }}>{String(templateValue(item, column.key))}</Typography.Paragraph>
          : <Tooltip title={String(templateValue(item, column.key))}><span>{String(templateValue(item, column.key))}</span></Tooltip>,
    };
  };

  const answerColumn = {
    title: <ColumnFilterButton label="现状说明" active={Boolean(filterDraft.answer)}>
      <Select allowClear style={{ width: 220 }} value={filterDraft.answer} placeholder="全部"
        options={[{ value: 'answered', label: '已填写' }, { value: 'unanswered', label: '未填写' }]}
        onChange={(value) => updateFilters({ ...filterDraftRef.current, answer: value })} />
    </ColumnFilterButton>, key: 'answer', width: 320,
    render: (_: unknown, item: any) => editableStatuses.includes(item.workflowStatus) && can('evaluations', 'answer') ? (
      <AnswerDraftCell
        itemId={item.id}
        sequenceNumber={item.sequenceNumber}
        initialValue={answerValue(item)}
        onDraftChange={(value) => updateAnswerDraft(item, value)}
      />
    ) : <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.currentStatusDescription || '—'}</Typography.Paragraph>,
  };

  const systemColumns: Record<string, any> = {
    answer: answerColumn,
    assets: {
      title: <ColumnFilterButton label="关联资产" active={Boolean(filterDraft.assetIds?.length)}>
        <MultiColumnFilter value={filterDraft.assetIds}
          options={scopeAssets.map((asset) => ({ value: asset.assetId, label: asset.assetNameSnapshot }))}
          placeholder="选择关联资产" onChange={(value) => updateFilters({ ...filterDraftRef.current, assetIds: value })} />
      </ColumnFilterButton>, key: 'assets', width: 260, className: 'evaluation-assets-cell',
      render: (_: unknown, item: any) => editableStatuses.includes(item.workflowStatus) && can('evaluations', 'answer') ? (
        <Space.Compact style={{ width: '100%' }}>
          <Select
            mode="multiple"
            showSearch
            optionFilterProp="label"
            disabled={saving[item.id]}
            maxTagCount="responsive"
            value={(item.assets || []).map((asset: any) => asset.id)}
            onChange={(value) => void updateAssets(item, value)}
            options={scopeAssets.map((asset) => ({ value: asset.assetId, label: asset.assetNameSnapshot }))}
            style={{ width: '100%' }}
            aria-label="关联资产"
          />
          {(item.assets || []).length > 1 && <Button disabled={saving[item.id]} icon={<SplitCellsOutlined />} title="拆分资产为新行" onClick={() => { setSplitting(item); setSplitAssetIds([]); }} />}
        </Space.Compact>
      ) : <Space wrap>{(item.assets || []).map((asset: any) => <Tag key={asset.id}>{asset.name}</Tag>)}</Space>,
    },
    assignee: {
      title: '责任人', key: 'assignee', width: 180,
      render: (_: unknown, item: any) => can('tasks', 'update') && editableStatuses.includes(item.workflowStatus) ? (
        <PersonnelSelect
          purpose="evaluation-assignment"
          contextId={item.id}
          aria-label={`设置 ${item.sequenceNumber} 的责任人`}
          value={item.assignedTo || undefined}
          loading={saving[item.id]}
          disabled={saving[item.id]}
          style={{ width: '100%' }}
          onChange={(value) => void updateAssignee(item, value)}
        />
      ) : <Typography.Text>{item.assignee?.displayName || item.responsiblePerson || '未分配'}</Typography.Text>,
    },
    history: {
      title: <ColumnFilterButton label="历史回答与证据" active={Boolean(filterDraft.history)}>
        <PresenceColumnFilter value={filterDraft.history} presentLabel="有历史记录" absentLabel="无历史记录"
          onChange={(value) => updateFilters({ ...filterDraftRef.current, history: value })} />
      </ColumnFilterButton>, key: 'history', width: 120,
      render: (_: unknown, item: any) => <Button size="small" icon={<HistoryOutlined />} onClick={() => openHistory(item)}>
        查看
      </Button>,
    },
    evidence: {
      title: <ColumnFilterButton label="本次证据" active={Boolean(filterDraft.evidence)}>
        <PresenceColumnFilter value={filterDraft.evidence} presentLabel="有本次证据" absentLabel="无本次证据"
          onChange={(value) => updateFilters({ ...filterDraftRef.current, evidence: value })} />
      </ColumnFilterButton>, key: 'evidence', width: 220,
      render: (_: unknown, item: any) => <Space direction="vertical" size={4}>
        <Space wrap>{(item.evidenceFiles || []).map((file: any) => <Button key={file.id} size="small" type="link" icon={<FileSearchOutlined />} onClick={() => setPreviewFile(file)}>{file.originalFilename}</Button>)}</Space>
        {editableStatuses.includes(item.workflowStatus) && can('evaluations', 'answer') && <Upload showUploadList={false} beforeUpload={(file) => upload(item, file)}><Button size="small" icon={<UploadOutlined />}>上传证据</Button></Upload>}
      </Space>,
    },
    compliance: {
      title: <ColumnFilterButton label="符合性结论" active={Boolean(filterDraft.complianceStatuses?.length)}>
        <MultiColumnFilter value={filterDraft.complianceStatuses} options={complianceOptions} placeholder="选择符合性结论"
          onChange={(value) => updateFilters({ ...filterDraftRef.current, complianceStatuses: value })} />
      </ColumnFilterButton>, key: 'compliance', width: 150,
      render: (_: unknown, item: any) => {
        const canDirectReview = Boolean(user?.isGlobalAdmin || can('evaluations', 'review'));
        const canReviewWhileFilling = canDirectReview
          && can('evaluations', 'answer')
          && editableStatuses.includes(item.workflowStatus);
        const claimedByOther = Boolean(item.reviewClaimedBy && item.reviewClaimedBy !== user?.id);
        const waitingForClaim = item.workflowStatus === 'submitted' && !item.reviewClaimedBy;
        if ((canDirectReview && item.workflowStatus === 'submitted') || canReviewWhileFilling) return <Tooltip title={claimedByOther
          ? '已由其他审计员认领'
          : waitingForClaim ? '请先认领该评估行' : '选择结论后点击复核'}>
          <span>
            <Select
              aria-label={`设置 ${item.sequenceNumber} 的符合性结论`}
              placeholder="选择结论"
              value={reviewDraft(item).complianceStatus}
              options={complianceOptions}
              disabled={claimedByOther || waitingForClaim || saving[item.id]}
              style={{ width: '100%' }}
              onChange={(value) => updateReviewDraft(item, { complianceStatus: value })}
            />
          </span>
        </Tooltip>;
        return item.complianceStatus === 'not_assessed'
          ? <Typography.Text type="secondary">未评估</Typography.Text>
          : <Tag color={COMPLIANCE_STATUS[item.complianceStatus]?.color}>{COMPLIANCE_STATUS[item.complianceStatus]?.text || item.complianceStatus}</Tag>;
      },
    },
    findingDescription: {
      title: '不符合项描述', key: 'findingDescription', width: 260,
      render: (_: unknown, item: any) => {
        const draft = reviewDraft(item);
        const requiresFinding = ['partial', 'non_compliant'].includes(draft.complianceStatus || '');
        const canEdit = (editableStatuses.includes(item.workflowStatus)
          && Boolean(user?.isGlobalAdmin || (can('evaluations', 'answer') && can('evaluations', 'review'))))
          || (item.workflowStatus === 'submitted' && item.reviewClaimedBy === user?.id && can('evaluations', 'review'));
        if (canEdit) return <Input.TextArea
          aria-label={`填写 ${item.sequenceNumber} 的不符合项描述`}
          autoSize={{ minRows: 2, maxRows: 5 }}
          placeholder={requiresFinding ? '请描述不符合情况' : '仅部分符合或不符合时填写'}
          value={draft.findingDescription}
          disabled={!requiresFinding || saving[item.id]}
          onChange={(event) => updateReviewDraft(item, { findingDescription: event.target.value })}
        />;
        return <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{item.finding?.description || '—'}</Typography.Paragraph>;
      },
    },
    findingSeverity: {
      title: '严重度', key: 'findingSeverity', width: 130,
      render: (_: unknown, item: any) => {
        const draft = reviewDraft(item);
        const requiresFinding = ['partial', 'non_compliant'].includes(draft.complianceStatus || '');
        const canEdit = (editableStatuses.includes(item.workflowStatus)
          && Boolean(user?.isGlobalAdmin || (can('evaluations', 'answer') && can('evaluations', 'review'))))
          || (item.workflowStatus === 'submitted' && item.reviewClaimedBy === user?.id && can('evaluations', 'review'));
        if (canEdit) return <Select
          aria-label={`设置 ${item.sequenceNumber} 的严重度`}
          placeholder="选择严重度"
          value={draft.findingSeverity}
          options={severityOptions}
          disabled={!requiresFinding || saving[item.id]}
          style={{ width: '100%' }}
          onChange={(value) => updateReviewDraft(item, { findingSeverity: value })}
        />;
        return item.finding?.severity
          ? <Tag>{severityOptions.find((option) => option.value === item.finding.severity)?.label || item.finding.severity}</Tag>
          : <Typography.Text type="secondary">—</Typography.Text>;
      },
    },
    status: {
      title: <ColumnFilterButton label="状态" active={Boolean(filterDraft.workflowStatuses?.length)}>
        <MultiColumnFilter value={filterDraft.workflowStatuses} options={workflowOptions} placeholder="选择流程状态"
          onChange={(value) => updateFilters({ ...filterDraftRef.current, workflowStatuses: value })} />
      </ColumnFilterButton>, key: 'status', width: 120,
      render: (_: unknown, item: any) => <Space direction="vertical" size={2}>
        <Tag color={workflow[item.workflowStatus]?.color}>{workflow[item.workflowStatus]?.text || item.workflowStatus}</Tag>
        {saving[item.id] && <Typography.Text type="secondary"><SaveOutlined /> 保存中</Typography.Text>}
      </Space>,
    },
    actions: {
      title: '流程操作', key: 'actions', width: 180,
      render: (_: unknown, item: any) => <Space direction="vertical" size={4}>
        <Space wrap>
        {can('evaluations', 'submit') && editableStatuses.includes(item.workflowStatus) && <Button
          size="small"
          type="primary"
          loading={saving[item.id]}
          disabled={!String(answerValue(item)).trim()}
          onClick={() => submit(item)}
        >提交</Button>}
        {can('evaluations', 'claim') && item.workflowStatus === 'submitted' && !item.reviewClaimedBy && item.assignedTo !== user?.id && <Button size="small" onClick={() => claim(item)}>认领</Button>}
        {can('evaluations', 'review') && item.workflowStatus === 'submitted' && item.reviewClaimedBy === user?.id && <Button size="small" onClick={() => returnReview(item)}>退回</Button>}
        {can('evaluations', 'review') && item.workflowStatus === 'submitted' && item.reviewClaimedBy === user?.id && <Button size="small" type="primary" onClick={() => review(item)}>复核</Button>}
        {can('tasks', 'update') && item.workflowStatus === 'submitted' && <Button size="small" onClick={() => { setTransferring(item); setTransferTo(item.reviewClaimedBy || undefined); }}>转派</Button>}
        {(user?.isGlobalAdmin || (can('evaluations', 'answer') && can('evaluations', 'review')))
          && editableStatuses.includes(item.workflowStatus)
          && <Button size="small" type="primary" onClick={() => review(item)}>复核</Button>}
        {canReopenReviewed && item.workflowStatus === 'reviewed' && <Button size="small" onClick={() => {
          setReopening(item);
          setReopenReason('');
        }}>撤销复核</Button>}
        </Space>
        {reviewErrors[item.id] && <Typography.Text type="danger" role="alert">{reviewErrors[item.id]}</Typography.Text>}
      </Space>,
    },
  };

  const columns: any[] = columnSchema.map((column) => {
    const systemColumn = systemColumns[column.key];
    const rendered = systemColumn ? { ...systemColumn, width: column.width } : renderTemplateColumn(column);
    const defaultWidth = Number(rendered.width) || 160;
    const width = clampColumnWidth(columnWidths[column.key] ?? defaultWidth);
    return {
      ...rendered,
      width,
      onHeaderCell: () => ({
        width,
        resizeLabel: column.label,
        onResize: (nextWidth: number) => setWidthPreference((current) => ({
          storageKey: widthPreferenceKey,
          widths: {
            ...(current.storageKey === widthPreferenceKey ? current.widths : {}),
            [column.key]: clampColumnWidth(nextWidth),
          },
        })),
        onReset: () => setWidthPreference((current) => {
          const widths = { ...(current.storageKey === widthPreferenceKey ? current.widths : {}) };
          delete widths[column.key];
          return { storageKey: widthPreferenceKey, widths };
        }),
      }),
    };
  });

  const clearAllFilters = () => {
    queryDraftRef.current = '';
    filterDraftRef.current = {};
    setQueryDraft('');
    setFilterDraft({});
    queueFilterApply('', {}, 100);
  };

  const dynamicLabels = new Map(columnSchema.map((column) => [column.key, column.label]));
  const activeFilterTags: Array<{ key: string; label: string; clear: () => void }> = [];
  if (queryDraft) activeFilterTags.push({ key: 'q', label: `关键词：${queryDraft}`, clear: () => {
    queryDraftRef.current = ''; setQueryDraft(''); queueFilterApply('', filterDraftRef.current, 300);
  } });
  const addArrayTag = (key: keyof EvaluationFilters, label: string, values?: string[]) => {
    if (values?.length) activeFilterTags.push({ key: String(key), label: `${label}：${values.join('、')}`, clear: () => updateFilters({ ...filterDraftRef.current, [key]: undefined }) });
  };
  addArrayTag('assetIds', '资产', filterDraft.assetIds?.map((assetId) => scopeAssets.find((asset) => asset.assetId === assetId)?.assetNameSnapshot || assetId));
  addArrayTag('controlDomains', '控制域', filterDraft.controlDomains);
  addArrayTag('workflowStatuses', '流程状态', filterDraft.workflowStatuses?.map((value) => workflow[value]?.text || value));
  addArrayTag('complianceStatuses', '符合性', filterDraft.complianceStatuses?.map((value) => COMPLIANCE_STATUS[value]?.text || value));
  if (filterDraft.mine) activeFilterTags.push({ key: 'mine', label: '仅看待我处理', clear: () => updateFilters({ ...filterDraftRef.current, mine: undefined }) });
  if (filterDraft.answer) activeFilterTags.push({ key: 'answer', label: filterDraft.answer === 'answered' ? '已填写' : '未填写', clear: () => updateFilters({ ...filterDraftRef.current, answer: undefined }) });
  if (filterDraft.evidence) activeFilterTags.push({ key: 'evidence', label: filterDraft.evidence === 'present' ? '有本次证据' : '无本次证据', clear: () => updateFilters({ ...filterDraftRef.current, evidence: undefined }) });
  if (filterDraft.history) activeFilterTags.push({ key: 'history', label: filterDraft.history === 'present' ? '有历史记录' : '无历史记录', clear: () => updateFilters({ ...filterDraftRef.current, history: undefined }) });
  if (filterDraft.sequenceNumber) activeFilterTags.push({ key: 'sequenceNumber', label: `序号：${filterDraft.sequenceNumber}`, clear: () => updateFilters({ ...filterDraftRef.current, sequenceNumber: undefined }) });
  if (filterDraft.controlPoint) activeFilterTags.push({ key: 'controlPoint', label: `评估点：${filterDraft.controlPoint}`, clear: () => updateFilters({ ...filterDraftRef.current, controlPoint: undefined }) });
  for (const [key, condition] of Object.entries(filterDraft.columns || {})) {
    const value = condition.operator === 'contains' ? condition.value
      : condition.operator === 'empty' ? (condition.value ? '空值' : '非空值')
        : [...condition.values, ...(condition.includeEmpty ? ['空值'] : [])].join('、');
    activeFilterTags.push({ key: `column:${key}`, label: `${dynamicLabels.get(key) || key}：${value}`, clear: () => updateDynamicFilter(key, undefined) });
  }

  return <div>
    <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
      <div>
        <Typography.Title level={3} style={{ margin: 0 }}>{task?.name || '评估表'}</Typography.Title>
        <Typography.Text type="secondary">
          填写内容仅在点击提交时保存；每行可关联多个资产，历史回答和证据仅作为参考。
          {dirtyItemIds.size > 0 && <Typography.Text type="warning"> 当前有 {dirtyItemIds.size} 行未提交。</Typography.Text>}
          {Object.keys(reviewDrafts).length > 0 && <Typography.Text type="warning"> 当前有 {Object.keys(reviewDrafts).length} 行复核结论未提交。</Typography.Text>}
        </Typography.Text>
      </div>
      <Space>
        {can('tasks', 'update') && <Popconfirm
          title="同步模板列配置？"
          description="只更新列顺序、名称和显示状态，不影响已有回答、资产、证据或复核记录。"
          okText="确认同步"
          cancelText="取消"
          onConfirm={syncColumnSchema}
        >
          <Button icon={<SyncOutlined />} loading={syncingColumns}>同步模板列配置</Button>
        </Popconfirm>}
        <Button type="primary" loading={bulkSubmitting} disabled={!selected.length} onClick={bulkSubmit}>批量提交（{selected.length}）</Button>
      </Space>
    </Space>
    <Space wrap size={[8, 8]} style={{ width: '100%', marginBottom: 10 }}>
      <Input
        allowClear
        prefix={<SearchOutlined />}
        aria-label="搜索评估点和要求"
        placeholder="搜索序号、评估点或评估要求"
        value={queryDraft}
        style={{ width: 280 }}
        onChange={(event) => {
          const value = event.target.value;
          queryDraftRef.current = value;
          setQueryDraft(value);
          queueFilterApply(value, filterDraftRef.current, 300);
        }}
      />
      <Select mode="multiple" allowClear showSearch maxTagCount="responsive" aria-label="筛选关联资产"
        optionFilterProp="label"
        placeholder="关联资产" style={{ minWidth: 180, maxWidth: 300 }} value={filterDraft.assetIds || []}
        options={scopeAssets.map((asset) => ({ value: asset.assetId, label: asset.assetNameSnapshot }))}
        onChange={(value) => updateFilters({ ...filterDraftRef.current, assetIds: value.length ? value : undefined })} />
      <Select mode="multiple" allowClear showSearch maxTagCount="responsive" aria-label="筛选控制域"
        placeholder="控制域" style={{ minWidth: 160, maxWidth: 280 }} value={filterDraft.controlDomains || []}
        options={filterOptions.controlDomains.map((value) => ({ value, label: value }))}
        onChange={(value) => updateFilters({ ...filterDraftRef.current, controlDomains: value.length ? value : undefined })} />
      <Select mode="multiple" allowClear maxTagCount="responsive" aria-label="筛选流程状态"
        placeholder="流程状态" style={{ minWidth: 150 }} value={filterDraft.workflowStatuses || []} options={workflowOptions}
        onChange={(value) => updateFilters({ ...filterDraftRef.current, workflowStatuses: value.length ? value : undefined })} />
      <Select mode="multiple" allowClear maxTagCount="responsive" aria-label="筛选符合性结论"
        placeholder="符合性结论" style={{ minWidth: 160 }} value={filterDraft.complianceStatuses || []} options={complianceOptions}
        onChange={(value) => updateFilters({ ...filterDraftRef.current, complianceStatuses: value.length ? value : undefined })} />
      <Button type={filterDraft.mine ? 'primary' : 'default'} onClick={() => updateFilters({ ...filterDraftRef.current, mine: !filterDraft.mine || undefined })}>仅看待我处理</Button>
      <Popover trigger="click" placement="bottomRight" content={<Space direction="vertical" size={10} style={{ width: 240 }}>
        <Typography.Text type="secondary">现状说明</Typography.Text>
        <Select allowClear value={filterDraft.answer} placeholder="全部" style={{ width: '100%' }}
          options={[{ value: 'answered', label: '已填写' }, { value: 'unanswered', label: '未填写' }]}
          onChange={(value) => updateFilters({ ...filterDraftRef.current, answer: value })} />
        <Typography.Text type="secondary">本次证据</Typography.Text>
        <PresenceColumnFilter value={filterDraft.evidence} presentLabel="有本次证据" absentLabel="无本次证据"
          onChange={(value) => updateFilters({ ...filterDraftRef.current, evidence: value })} />
        <Typography.Text type="secondary">历史回答与证据</Typography.Text>
        <PresenceColumnFilter value={filterDraft.history} presentLabel="有历史记录" absentLabel="无历史记录"
          onChange={(value) => updateFilters({ ...filterDraftRef.current, history: value })} />
      </Space>}><Button>更多筛选</Button></Popover>
      {(queryDraft || hasEvaluationFilters(filterDraft)) && <Button icon={<ClearOutlined />} onClick={clearAllFilters}>清除全部</Button>}
    </Space>
    {activeFilterTags.length > 0 && <Space wrap size={[4, 6]} style={{ marginBottom: 10 }} aria-label="已生效筛选条件">
      <Typography.Text type="secondary">已筛选：</Typography.Text>
      {activeFilterTags.map((item) => <Tag key={item.key} closable onClose={(event) => { event.preventDefault(); item.clear(); }}>{item.label}</Tag>)}
    </Space>}
    <Table
      className="evaluation-workbench-table"
      components={{ header: { cell: ResizableHeaderCell } }}
      rowKey="id"
      size="small"
      sticky
      loading={loading}
      pagination={false}
      dataSource={items}
      columns={columns}
      scroll={{ x: Math.max(1500, columns.reduce((sum, column) => sum + Number(column.width || 160), 0)), y: 'calc(100vh - 300px)' }}
      rowSelection={{
        selectedRowKeys: selected,
        onChange: setSelected,
        getCheckboxProps: (item: any) => ({ disabled: !editableStatuses.includes(item.workflowStatus) || !String(answerValue(item)).trim() }),
      }}
    />
    <Pagination
      style={{ marginTop: 16 }} current={pagination.page} pageSize={pagination.pageSize} total={pagination.total}
      showSizeChanger pageSizeOptions={[20, 50, 100]} showTotal={(total) => `筛选后 ${total} 条 / 全部 ${unfilteredTotal} 条`}
      onChange={(page, pageSize) => { void (async () => {
        setSelected([]);
        syncUrl(page, pageSize, appliedQueryRef.current, appliedFiltersRef.current);
        await loadPage(page, pageSize);
      })(); }}
    />

    <Modal title="拆分资产为新评估行" open={Boolean(splitting)} onCancel={() => setSplitting(undefined)} onOk={split} okButtonProps={{ disabled: !splitAssetIds.length }}>
      <Typography.Paragraph type="secondary">新行会复制已保存的回答，但不会复制本次证据。若当前行有未提交内容，请先提交。至少为原行保留一个资产。</Typography.Paragraph>
      <Select mode="multiple" showSearch optionFilterProp="label" style={{ width: '100%' }} value={splitAssetIds} onChange={setSplitAssetIds}
        options={(splitting?.assets || []).map((asset: any) => ({ value: asset.id, label: asset.name }))} />
    </Modal>

    <Modal title={`历史回答与证据${historyFor ? ` · ${historyFor.sequenceNumber}` : ''}`} open={Boolean(historyFor)} onCancel={() => setHistoryFor(undefined)} footer={null} width={760} loading={historyLoading}>
      {!historyLoading && !historyRecords.length ? <Empty description="暂无匹配的历史回答或证据" /> : <Timeline items={historyRecords.map((record) => ({
        children: <div>
          <Typography.Text strong>{record.task?.name}</Typography.Text>
          <Typography.Text type="secondary"> · 标准版本 {record.task?.version || '—'} · {record.task?.reviewedAt ? new Date(record.task.reviewedAt).toLocaleDateString('zh-CN') : '—'}</Typography.Text>
          <Space wrap style={{ margin: '8px 0' }}>{(record.assets || []).filter((asset: any) => record.matchedAssetIds?.includes(asset.id)).map((asset: any) => <Tag key={asset.id}>{asset.name}</Tag>)}</Space>
          <Typography.Text type="secondary">历史回答</Typography.Text>
          <Typography.Paragraph style={{ margin: '4px 0 8px', whiteSpace: 'pre-wrap' }}>{record.currentStatusDescription || '无历史回答'}</Typography.Paragraph>
          <Typography.Text type="secondary">历史证据</Typography.Text>
          <Space wrap style={{ marginTop: 4 }}>
            {(record.evidenceFiles || []).length
              ? record.evidenceFiles.map((file: any) => <Button key={file.id} size="small" type="link" icon={<FileSearchOutlined />} onClick={() => setPreviewFile(file)}>{file.originalFilename}</Button>)
              : <Typography.Text type="secondary">无历史证据</Typography.Text>}
          </Space>
        </div>,
      }))} />}
    </Modal>

    <Modal
      title="撤销复核"
      open={Boolean(reopening)}
      okText="确认撤销"
      cancelText="取消"
      okButtonProps={{ disabled: !reopenReason.trim(), loading: Boolean(reopening && saving[reopening.id]) }}
      onCancel={() => { setReopening(undefined); setReopenReason(''); }}
      onOk={reopenReview}
    >
      <Typography.Paragraph type="secondary">
        撤销后该评估项回到填写中；如果已经进入整改或风险流程，系统将阻止操作。
      </Typography.Paragraph>
      <div style={{ paddingBottom: 22 }}>
        <Input.TextArea
          aria-label="撤销复核原因"
          rows={4}
          maxLength={500}
          showCount
          placeholder="请填写撤销原因"
          value={reopenReason}
          onChange={(event) => setReopenReason(event.target.value)}
        />
      </div>
    </Modal>

    <Modal title="强制转派复核" open={Boolean(transferring)} onCancel={() => setTransferring(undefined)} onOk={transfer} okButtonProps={{ disabled: !transferTo }}>
      <AuditorSelect
        purpose="review-transfer"
        contextId={id}
        aria-label="按姓名搜索复核人"
        placeholder="搜索姓名"
        style={{ width: '100%' }}
        value={transferTo}
        onChange={setTransferTo}
      />
    </Modal>
    <FilePreviewModal file={previewFile} open={Boolean(previewFile)} onClose={() => setPreviewFile(null)} />
  </div>;
}
