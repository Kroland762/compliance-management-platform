import { App } from 'antd';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from '../api/client';
import Login from './Login';

vi.mock('../api/client', () => ({ default: { get: vi.fn() } }));

describe('Login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(apiClient.get).mockResolvedValue({ data: { captchaId: 'captcha-1', svg: '<svg></svg>' } } as any);
  });

  it('exposes persistent form labels and a semantic captcha refresh button', async () => {
    render(<App><MemoryRouter><Login /></MemoryRouter></App>);

    expect(screen.getByLabelText('用户名')).toBeInTheDocument();
    expect(screen.getByLabelText('密码')).toBeInTheDocument();
    expect(screen.getByLabelText('验证码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '刷新验证码' })).toBeInTheDocument();
  });
});
