import { useEffect, useRef } from 'react';
import { useAuthStore } from '../store/auth';
import { useNavigate } from 'react-router-dom';
import apiClient from '../api/client';

const DEFAULT_IDLE_TIMEOUT = 3 * 60 * 60 * 1000; // 3 小时默认

export default function useIdleTimeout() {
  const logout = useAuthStore((s) => s.logout);
  const navigate = useNavigate();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeoutMsRef = useRef<number>(DEFAULT_IDLE_TIMEOUT);

  // 从后端获取配置的超时
  const refreshTimeout = async () => {
    try {
      const res: any = await apiClient.get('/settings/security');
      if (res.data?.idleTimeoutMinutes) {
        timeoutMsRef.current = res.data.idleTimeoutMinutes * 60 * 1000;
      }
    } catch {
      // 使用默认值
    }
  };

  useEffect(() => {
    let mounted = true;

    const resetTimer = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        logout();
        navigate('/login');
      }, timeoutMsRef.current);
    };

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    events.forEach(e => window.addEventListener(e, resetTimer));

    // 初始加载配置 + 监听配置更新事件
    refreshTimeout();

    const handleSettingsUpdate = (e: CustomEvent) => {
      if (e.detail?.idleTimeoutMinutes && mounted) {
        timeoutMsRef.current = e.detail.idleTimeoutMinutes * 60 * 1000;
        resetTimer(); // 重置计时器
      }
    };

    window.addEventListener('security-settings-updated', handleSettingsUpdate as EventListener);

    resetTimer();

    return () => {
      mounted = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      events.forEach(e => window.removeEventListener(e, resetTimer));
      window.removeEventListener('security-settings-updated', handleSettingsUpdate as EventListener);
    };
  }, [logout, navigate]);
}
