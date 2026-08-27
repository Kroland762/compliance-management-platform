import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import AssessmentWizard from './AssessmentWizard';

vi.mock('../api/client', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn() },
}));

vi.mock('../components/lookups', () => ({
  LookupSelect: ({ value, onChange, mode, placeholder, kind }: any) => (
    <select
      aria-label={placeholder || kind}
      multiple={mode === 'multiple'}
      value={value || (mode === 'multiple' ? [] : '')}
      onChange={(event) => onChange?.(mode === 'multiple'
        ? Array.from(event.currentTarget.selectedOptions).map((option) => option.value)
        : event.currentTarget.value)}
    >
      <option value="">请选择</option>
      <option value={`${kind}-1`}>{kind} 选项</option>
    </select>
  ),
  DepartmentSelect: ({ value, onChange }: any) => <select aria-label="归属部门" value={value || ''} onChange={(event) => onChange?.(event.currentTarget.value)}><option value="">请选择</option><option value="department-1">风险管理部</option></select>,
  PersonnelSelect: ({ value, onChange }: any) => <select aria-label="默认责任人" value={value || ''} onChange={(event) => onChange?.(event.currentTarget.value)}><option value="">请选择</option><option value="person-1">责任人甲</option></select>,
  AuditorSelect: ({ value, onChange }: any) => <select aria-label="审计员池" multiple value={value || []} onChange={(event) => onChange?.(Array.from(event.currentTarget.selectedOptions).map((option) => option.value))}><option value="auditor-1">审计员甲</option></select>,
}));

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/assessments/new']}>
      <Routes>
        <Route path="/assessments/new" element={<AssessmentWizard />} />
        <Route path="/assessments" element={<div>项目列表页</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssessmentWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false, media: query,
        addListener: vi.fn(), removeListener: vi.fn(),
        addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
      })),
    });
    vi.mocked(apiClient.get).mockResolvedValue({ data: { name: 'GDPR 模板', templateQuestions: [{ id: 'q-1' }] } } as any);
    vi.mocked(apiClient.post).mockResolvedValue({ data: { id: 'task-1' } } as any);
    vi.mocked(apiClient.put).mockResolvedValue({ data: {} } as any);
  });

  it('shows persistent feedback after creating a draft and can return to the project list', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.selectOptions(screen.getByLabelText('输入标准名称检索'), 'assessment-templates-1');
    await user.click(screen.getByRole('button', { name: '下一步' }));
    await user.type(screen.getByLabelText('评估名称'), '年度隐私评估');
    await user.selectOptions(screen.getByLabelText('归属部门'), 'department-1');
    await user.selectOptions(screen.getByLabelText('默认责任人'), 'person-1');
    await user.selectOptions(screen.getByLabelText('审计员池'), 'auditor-1');
    await user.click(screen.getByRole('button', { name: '下一步' }));

    const draftAlert = await screen.findByRole('alert');
    expect(draftAlert).toHaveTextContent('评估项目草稿已保存');
    expect(draftAlert).toHaveTextContent(/继续配置资产范围并发布/);
    expect(apiClient.post).toHaveBeenCalledWith('/tasks', expect.objectContaining({
      name: '年度隐私评估', templateId: 'assessment-templates-1',
    }));
    expect(apiClient.put).toHaveBeenCalledWith('/tasks/task-1/auditors', { auditorUserIds: ['auditor-1'] });

    await user.click(screen.getByRole('button', { name: '返回项目列表' }));
    expect(await screen.findByText('项目列表页')).toBeInTheDocument();
  });

  it('cancels before draft creation without writing a task', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: '取消创建' }));

    expect(await screen.findByText('项目列表页')).toBeInTheDocument();
    await waitFor(() => expect(apiClient.post).not.toHaveBeenCalled());
  });
});
