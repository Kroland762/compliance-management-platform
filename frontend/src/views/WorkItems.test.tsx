import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import WorkItems from './WorkItems';

vi.mock('../api/client', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('WorkItems', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows a retryable error instead of an empty business state when loading fails', async () => {
    vi.mocked(apiClient.get)
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockResolvedValueOnce({ data: { fill: [], review: [], remediate: [], verify: [], counts: {} } } as any);

    render(<MemoryRouter><WorkItems /></MemoryRouter>);

    expect(await screen.findByText('待办加载失败')).toBeInTheDocument();
    expect(screen.queryByText('暂无待办')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
    await waitFor(() => expect(apiClient.get).toHaveBeenCalledTimes(2));
    expect(await screen.findAllByText('暂无待办')).toHaveLength(1);
  });
});
