import { useState, useEffect } from 'react';
import { Input, Button, Typography, App } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined, ReloadOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { getApiErrorMessage } from '../utils/error';
import apiClient from '../api/client';

const { Text } = Typography;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = App.useApp();
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [captchaCode, setCaptchaCode] = useState('');
  const [captchaId, setCaptchaId] = useState('');
  const [captchaSvg, setCaptchaSvg] = useState('');
  const [captchaLoading, setCaptchaLoading] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchCaptcha = async () => {
    setCaptchaLoading(true);
    try {
      const res: any = await apiClient.get('/auth/captcha', { _skipRefresh: true } as any);
      setCaptchaId(res.data.captchaId);
      setCaptchaSvg(res.data.svg);
      setCaptchaCode('');
    } catch {
      message.error('验证码加载失败');
    } finally {
      setCaptchaLoading(false);
    }
  };

  useEffect(() => { fetchCaptcha(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      message.error('请输入用户名和密码');
      return;
    }
    if (!captchaCode) {
      message.error('请输入验证码');
      return;
    }
    setLoading(true);
    try {
      const status = await login(username, password, captchaId, captchaCode);
      message.success('登录成功');
      const requestedPath = typeof location.state?.from === 'string' && location.state.from.startsWith('/')
        ? location.state.from
        : null;
      if (status === 'password_change_required') navigate('/change-password');
      else if (requestedPath) navigate(requestedPath);
      else if (status === 'tenant_selection_required') navigate('/tenant-select');
      else {
        const state = useAuthStore.getState();
        navigate(state.user?.tenantId ? '/dashboard' : '/tenants');
      }
    } catch (err: any) {
      message.error(getApiErrorMessage(err, '登录失败'));
      fetchCaptcha(); // 登录失败刷新验证码
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #F5F5F7 0%, #E8E8ED 50%, #F5F5F7 100%)',
    }}>
      <div style={{
        width: 400,
        padding: '48px 40px 40px',
        background: 'rgba(255,255,255,0.8)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        borderRadius: 24,
        boxShadow: '0 4px 30px rgba(0,0,0,0.06), 0 0 0 0.5px rgba(0,0,0,0.04)',
      }}>
        {/* Logo / Title */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 56, height: 56, borderRadius: 16,
            background: 'linear-gradient(135deg, #007AFF, #5856D6)',
            margin: '0 auto 20px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 12px rgba(0,122,255,0.3)',
          }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          </div>
          <div style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.02em', color: '#1D1D1F', marginBottom: 4 }}>
            合规管理平台
          </div>
          <Text style={{ fontSize: 14, color: '#636366' }}>
            Compliance Management Platform
          </Text>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="login-username" style={{ display: 'block', marginBottom: 6, color: '#3A3A3C', fontSize: 13, fontWeight: 500 }}>用户名</label>
            <Input
              id="login-username"
              autoComplete="username"
              size="large"
              prefix={<UserOutlined style={{ color: '#636366' }} />}
              placeholder="请输入用户名"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={{
                height: 48,
                borderRadius: 12,
                border: '0.5px solid rgba(0,0,0,0.1)',
                background: 'rgba(0,0,0,0.02)',
                fontSize: 15,
              }}
            />
          </div>
          <div style={{ marginBottom: 16 }}>
            <label htmlFor="login-password" style={{ display: 'block', marginBottom: 6, color: '#3A3A3C', fontSize: 13, fontWeight: 500 }}>密码</label>
            <Input.Password
              id="login-password"
              autoComplete="current-password"
              size="large"
              prefix={<LockOutlined style={{ color: '#636366' }} />}
              placeholder="请输入密码"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                height: 48,
                borderRadius: 12,
                border: '0.5px solid rgba(0,0,0,0.1)',
                background: 'rgba(0,0,0,0.02)',
                fontSize: 15,
              }}
            />
          </div>

          {/* Captcha */}
          <div style={{ marginBottom: 24 }}>
            <label htmlFor="login-captcha" style={{ display: 'block', marginBottom: 6, color: '#3A3A3C', fontSize: 13, fontWeight: 500 }}>验证码</label>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <Input
                id="login-captcha"
                autoComplete="off"
                size="large"
                prefix={<SafetyOutlined style={{ color: '#636366' }} />}
                placeholder="请输入验证码"
                value={captchaCode}
                onChange={(e) => setCaptchaCode(e.target.value)}
                maxLength={4}
                style={{
                  flex: 1,
                  height: 48,
                  borderRadius: 12,
                  border: '0.5px solid rgba(0,0,0,0.1)',
                  background: 'rgba(0,0,0,0.02)',
                  fontSize: 15,
                }}
              />
              <button
                type="button"
                disabled={captchaLoading}
                onClick={() => void fetchCaptcha()}
                aria-label="刷新验证码"
                style={{
                  width: 130,
                  height: 48,
                  borderRadius: 12,
                  border: '0.5px solid rgba(0,0,0,0.1)',
                  cursor: captchaLoading ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  background: '#fff',
                  opacity: captchaLoading ? 0.6 : 1,
                  position: 'relative',
                  padding: 0,
                }}
                title="点击刷新验证码"
              >
                {captchaSvg ? (
                  <div dangerouslySetInnerHTML={{ __html: captchaSvg }} style={{ lineHeight: 0 }} />
                ) : (
                  <Text type="secondary" style={{ fontSize: 12 }}>加载中</Text>
                )}
                <div style={{
                  position: 'absolute',
                  top: 2,
                  right: 4,
                  color: '#636366',
                  fontSize: 12,
                  lineHeight: 1,
                }}>
                  <ReloadOutlined spin={captchaLoading} />
                </div>
              </button>
            </div>
          </div>

          <Button
            type="primary"
            htmlType="submit"
            loading={loading}
            block
            style={{
              height: 48,
              borderRadius: 12,
              fontSize: 16,
              fontWeight: 500,
              letterSpacing: '-0.01em',
              background: '#007AFF',
              border: 'none',
              boxShadow: '0 2px 8px rgba(0,122,255,0.25)',
            }}
          >
            登录
          </Button>
        </form>

      </div>

      {/* Fixed watermark */}
      <div style={{
        position: 'fixed',
        bottom: 12,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 11,
        color: 'rgba(0,0,0,0.12)',
        letterSpacing: '0.02em',
        pointerEvents: 'none',
        userSelect: 'none',
        zIndex: 0,
      }}>
        Powered by Deepseek
      </div>
    </div>
  );
}
