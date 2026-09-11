import { Alert, Button, Badge, Typography, Dropdown, Space, Avatar, Popover, List, Tag, Menu, Layout, Select, message, Spin } from 'antd';
import {
  DashboardOutlined, FileTextOutlined, UserOutlined,
  AuditOutlined, FormOutlined, WarningOutlined,
  BellOutlined, LogoutOutlined, FileSearchOutlined,
  MenuFoldOutlined, DatabaseOutlined, ScheduleOutlined,
  SecurityScanOutlined, SafetyCertificateOutlined, HomeOutlined, ApartmentOutlined,
  AppstoreOutlined, ToolOutlined,
} from '@ant-design/icons';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { useEffect, useState } from 'react';
import apiClient from '../api/client';
import ProfileModal from '../views/Profile';
import useIdleTimeout from '../hooks/useIdleTimeout';

const { Sider, Content } = Layout;
const { Text } = Typography;

const SIDEBAR_WIDE = 200;
const SIDEBAR_NARROW = 80;

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const can = useAuthStore((s) => s.hasPermission);
  const selectedTenant = useAuthStore((s) => s.selectedTenant);
  const contexts = useAuthStore((s) => s.contexts);
  const selectContext = useAuthStore((s) => s.selectContext);
  const clearContext = useAuthStore((s) => s.clearContext);
  const isPlatformMode = Boolean(user?.isGlobalAdmin && !selectedTenant);
  useIdleTimeout();
  const [collapsed, setCollapsed] = useState(false);
  const [activeNav, setActiveNav] = useState<'compliance' | 'product-compliance' | 'account-audit' | 'system'>('compliance');
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [notificationError, setNotificationError] = useState('');
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [isCompact, setIsCompact] = useState(false);
  const tenantOptions = [
    ...(user?.isGlobalAdmin ? [{ label: '平台管理', value: '__control__' }] : []),
    ...contexts.map((tenant) => ({ label: tenant.name, value: tenant.id })),
  ];

  const handleTenantChange = async (tenantId: string) => {
    if (tenantId === '__control__') {
      try {
        await clearContext();
        navigate('/tenants');
        message.success('已切换到平台管理');
      } catch {
        message.error('退出租户上下文失败');
      }
      return;
    }
    const option = tenantOptions.find((item) => item.value === tenantId);
    if (!option) return;
    try {
      await selectContext(tenantId);
      navigate('/dashboard');
      message.success(`已切换到${option.label}`);
    } catch {
      message.error('租户上下文切换失败');
    }
  };

  useEffect(() => {
    const updateCompact = () => setIsCompact(window.innerWidth <= 900);
    updateCompact();
    window.addEventListener('resize', updateCompact);
    return () => window.removeEventListener('resize', updateCompact);
  }, []);

  const effectiveCollapsed = collapsed || isCompact;
  const sidebarWidth = effectiveCollapsed ? SIDEBAR_NARROW : SIDEBAR_WIDE;

  const fetchUnread = async () => {
    try {
      const res: any = await apiClient.get('/notifications/unread-count');
      setUnreadCount(res.data?.count || 0);
      setNotificationError('');
    } catch {
      setNotificationError('通知状态暂时无法更新');
    }
  };

  const fetchNotifications = async () => {
    setNotificationsLoading(true);
    try {
      const res: any = await apiClient.get('/notifications?pageSize=20');
      setNotifications(res.data?.items || []);
      setNotificationError('');
    } catch {
      setNotificationError('通知加载失败，请重试');
    } finally {
      setNotificationsLoading(false);
    }
  };

  useEffect(() => {
    if (isPlatformMode) {
      setUnreadCount(0);
      return undefined;
    }
    fetchUnread();
    const timer = setInterval(fetchUnread, 30000);
    return () => clearInterval(timer);
  }, [isPlatformMode, selectedTenant?.id]);

  useEffect(() => {
    if (location.pathname.startsWith('/product-compliance')) {
      setActiveNav('product-compliance');
    } else if (location.pathname.startsWith('/account-audit')) {
      setActiveNav('account-audit');
    } else if (
      location.pathname.startsWith('/users') ||
      location.pathname.startsWith('/roles') ||
      location.pathname.startsWith('/organization') ||
      location.pathname.startsWith('/audit-logs') ||
      location.pathname.startsWith('/tenants') ||
      location.pathname.startsWith('/settings')
    ) {
      setActiveNav('system');
    } else {
      setActiveNav('compliance');
    }
  }, [location.pathname]);

  const handleLogout = () => { logout(); navigate('/login'); };

  const complianceMenuItems = [
    ...(can('dashboard', 'read') ? [
      { key: '/dashboard', icon: <DashboardOutlined />, label: '工作台' },
    ] : []),
    ...(can('templates', 'read') ? [
      { key: '/templates', icon: <FileTextOutlined />, label: '合规标准' },
    ] : []),
    ...(can('assets', 'read') ? [
      { key: '/assets', icon: <AppstoreOutlined />, label: '资产台账' },
    ] : []),
    ...(can('qualifications', 'read') ? [
      { key: '/qualifications', icon: <SafetyCertificateOutlined />, label: '资质台账' },
    ] : []),
    ...(can('tasks', 'read') ? [
      { key: '/assessments', icon: <AuditOutlined />, label: '评估项目' },
    ] : []),
    ...((can('evaluations', 'read') || can('remediation_actions', 'read')) ? [
      { key: '/work-items', icon: <FormOutlined />, label: '我的待办' },
    ] : []),
    ...(can('findings', 'read') ? [
      { key: '/findings', icon: <FileSearchOutlined />, label: '不符合项' },
    ] : []),
    ...((can('risks', 'read') || can('remediation_actions', 'read')) ? [
      { key: '/governance', icon: <ToolOutlined />, label: '风险与整改' },
    ] : []),
    ...(can('assessment_plans', 'read') ? [
      { key: '/assessment-plans', icon: <ScheduleOutlined />, label: '周期评估' },
    ] : []),
  ];

  const accountAuditMenuItems: any[] = [
    ...(can('account_dashboard', 'read') ? [
      { key: '/account-audit/dashboard', icon: <DashboardOutlined />, label: '概览' },
    ] : []),
    ...(can('data_sources', 'read') ? [
      { key: '/account-audit/data-sources', icon: <DatabaseOutlined />, label: '数据源' },
    ] : []),
    ...(can('rules', 'read') ? [
      { key: '/account-audit/rules', icon: <AuditOutlined />, label: '规则' },
    ] : []),
    ...(can('account_tasks', 'read') ? [
      { key: '/account-audit/tasks', icon: <ScheduleOutlined />, label: '任务' },
    ] : []),
    ...(can('problems', 'read') ? [
      { key: '/account-audit/problems', icon: <WarningOutlined />, label: '问题' },
    ] : []),
  ];

  const productComplianceMenuItems: any[] = [
    ...(can('products', 'read') ? [
      { key: '/product-compliance/products', icon: <AppstoreOutlined />, label: '产品台账' },
    ] : []),
    ...(can('product_dossiers', 'review') ? [
      { key: '/product-compliance/review', icon: <AuditOutlined />, label: '待复核' },
    ] : []),
    ...(can('product_compliance_config', 'read') ? [
      { key: '/product-compliance/config', icon: <ToolOutlined />, label: '配置管理' },
    ] : []),
  ];

  const systemMenuItems: any[] = [
    ...(can('tenants', 'read') ? [
      { key: '/tenants', icon: <HomeOutlined />, label: '租户管理' },
    ] : []),
    ...(can('users', 'read') ? [
      { key: '/roles', icon: <SafetyCertificateOutlined />, label: '角色管理' },
    ] : []),
    ...(can('users', 'read') ? [
      { key: '/users', icon: <UserOutlined />, label: '成员管理' },
    ] : []),
    ...(can('organization', 'read') ? [
      { key: '/organization', icon: <ApartmentOutlined />, label: '组织管理' },
    ] : []),
    ...(can('audit_logs', 'read') ? [
      { key: '/audit-logs', icon: <FileSearchOutlined />, label: '操作日志' },
    ] : []),
    { type: 'divider' as any },
    { key: '/settings', icon: <SecurityScanOutlined />, label: '安全设置' },
  ];

  const platformMenuItems: any[] = [
    ...(can('tenants', 'read') ? [
      { key: '/tenants', icon: <HomeOutlined />, label: '租户管理' },
    ] : []),
  ];

  const firstSystemPath = systemMenuItems.find((item) => item?.key)?.key || '/settings';
  const firstProductCompliancePath = productComplianceMenuItems.find((item) => item?.key)?.key || '/product-compliance/products';

  const sideMenuItems = isPlatformMode
    ? platformMenuItems
    : activeNav === 'compliance' ? complianceMenuItems
      : activeNav === 'product-compliance' ? productComplianceMenuItems
      : activeNav === 'account-audit' ? accountAuditMenuItems
        : systemMenuItems;

  const userMenuItems = [
    { key: 'profile', icon: <UserOutlined />, label: '个人信息' },
    { key: 'role', label: <Text type="secondary" style={{ fontSize: 12 }}>{user?.role || ''}</Text>, disabled: true },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
  ];

  const navTabStyle = (active: boolean): React.CSSProperties => ({
    padding: '8px 18px',
    borderRadius: 8,
    border: 'none',
    background: active ? 'rgba(0,122,255,0.08)' : 'transparent',
    color: active ? '#007AFF' : '#1D1D1F',
    fontSize: 14,
    fontWeight: active ? 600 : 400,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease',
    fontFamily: 'inherit',
    letterSpacing: '-0.01em',
  });

  const activeSideKey = (() => {
    if (location.pathname.startsWith('/tasks/review') || location.pathname.startsWith('/tasks/configure')) return '/assessments';
    if (location.pathname.startsWith('/assessments')) return '/assessments';
    if (location.pathname.startsWith('/assets')) return '/assets';
    if (location.pathname.startsWith('/remediation-actions') || location.pathname.startsWith('/governance') || location.pathname.startsWith('/risks')) return '/governance';
    if (location.pathname.startsWith('/assessment-plans')) return '/assessment-plans';
    if (location.pathname.startsWith('/my-tasks') || location.pathname.startsWith('/work-items')) return '/work-items';
    if (location.pathname.startsWith('/findings')) return '/findings';
    if (location.pathname.startsWith('/qualifications')) return '/qualifications';
    if (location.pathname.startsWith('/dashboard')) return '/dashboard';
    if (location.pathname.startsWith('/product-compliance/review')) return '/product-compliance/review';
    if (location.pathname.startsWith('/product-compliance/config')) return '/product-compliance/config';
    if (location.pathname.startsWith('/product-compliance')) return '/product-compliance/products';
    if (location.pathname.startsWith('/account-audit')) {
      if (location.pathname.startsWith('/account-audit/data-sources')) return '/account-audit/data-sources';
      if (location.pathname.startsWith('/account-audit/rules')) return '/account-audit/rules';
      if (location.pathname.startsWith('/account-audit/tasks')) return '/account-audit/tasks';
      if (location.pathname.startsWith('/account-audit/problems')) return '/account-audit/problems';
      return '/account-audit/dashboard';
    }
    if (location.pathname.startsWith('/users')) return '/users';
    if (location.pathname.startsWith('/roles')) return '/roles';
    if (location.pathname.startsWith('/organization')) return '/organization';
    if (location.pathname.startsWith('/audit-logs')) return '/audit-logs';
    if (location.pathname.startsWith('/tenants')) return '/tenants';
    if (location.pathname.startsWith('/settings')) return '/settings';
    return '/' + location.pathname.split('/').filter(Boolean)[0];
  })();

  const useFullWidthContent = /^\/assessments\/[^/]+\/workbench\/?$/.test(location.pathname);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#F5F5F7' }}>
      {/* Top Header */}
      <div style={{
        position: 'sticky', top: 0, zIndex: 100,
        display: 'flex', height: 52,
        background: 'rgba(255,255,255,0.72)',
        backdropFilter: 'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        borderBottom: '0.5px solid rgba(0,0,0,0.08)',
      }}>
        <div style={{
          flex: `0 0 ${sidebarWidth}px`, height: 52,
          display: 'flex', alignItems: 'center',
          justifyContent: effectiveCollapsed ? 'center' : 'space-between',
          paddingLeft: effectiveCollapsed ? 0 : 20, paddingRight: effectiveCollapsed ? 0 : 12,
          borderRight: '0.5px solid rgba(0,0,0,0.06)', boxSizing: 'border-box',
          cursor: effectiveCollapsed && !isCompact ? 'pointer' : 'default', transition: 'all 0.2s', overflow: 'hidden',
        }} onClick={effectiveCollapsed && !isCompact ? () => setCollapsed(false) : undefined}>
          <Text strong style={{ fontSize: 15, letterSpacing: '-0.02em', whiteSpace: 'nowrap', color: '#1D1D1F' }}>
            {effectiveCollapsed ? '合规' : '合规管理平台'}
          </Text>
          {!effectiveCollapsed && (
            <Button type="text" icon={<MenuFoldOutlined />}
              onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}
              style={{ fontSize: 14, width: 28, height: 28, flexShrink: 0 }} />
          )}
        </div>
        <div className="app-topbar-main" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', minWidth: 0 }}>
          <nav className="app-topnav" style={{ display: 'flex', gap: 4 }}>
            {isPlatformMode ? (
              <button style={navTabStyle(true)} onClick={() => navigate('/tenants')}>平台管理</button>
            ) : (
              <>
                <button style={navTabStyle(activeNav === 'compliance')}
                  onClick={() => { setActiveNav('compliance'); navigate('/dashboard'); }}>合规评估</button>
                {(can('products', 'read') || can('product_dossiers', 'review') || can('product_compliance_config', 'read')) && (
                  <button style={navTabStyle(activeNav === 'product-compliance')}
                    onClick={() => { setActiveNav('product-compliance'); navigate(firstProductCompliancePath); }}>产品合规</button>
                )}
                {(can('account_dashboard', 'read') || can('data_sources', 'read') || can('rules', 'read') || can('account_tasks', 'read') || can('problems', 'read')) && <button style={navTabStyle(activeNav === 'account-audit')}
                  onClick={() => { setActiveNav('account-audit'); navigate('/account-audit'); }}>账户审计</button>
                }
                <button style={navTabStyle(activeNav === 'system')}
                  onClick={() => { setActiveNav('system'); navigate(firstSystemPath); }}>系统设置</button>
              </>
            )}
          </nav>
          <Space size={16} className="app-topbar-actions">
            {tenantOptions.length > 1 && (
              <Select
                aria-label="选择租户"
                placeholder="选择租户"
                value={selectedTenant?.id || (user?.isGlobalAdmin ? '__control__' : undefined)}
                options={tenantOptions}
                onChange={handleTenantChange}
                style={{ width: 160 }}
                showSearch
                optionFilterProp="label"
              />
            )}
            {!isPlatformMode && <Popover open={notifOpen} onOpenChange={(open) => { setNotifOpen(open); if (open) fetchNotifications(); }}
              trigger="click" placement="bottomRight"
              content={
                <div style={{ width: 360, maxHeight: 400, overflow: 'auto' }}>
                  {notificationError ? (
                    <Alert type="warning" showIcon message={notificationError} action={<Button size="small" onClick={() => void fetchNotifications()}>重试</Button>} />
                  ) : notificationsLoading ? (
                    <div style={{ textAlign: 'center', padding: 28 }}><Spin /><div style={{ marginTop: 8 }}>正在加载通知</div></div>
                  ) : notifications.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 20, color: '#636366' }}>暂无通知</div>
                  ) : (
                    <List dataSource={notifications} renderItem={(item: any) => (
                      <List.Item
                        style={{
                          padding: '10px 0',
                          borderBottom: '0.5px solid rgba(0,0,0,0.06)',
                          opacity: item.isRead ? 0.6 : 1,
                          transition: 'opacity 0.3s ease',
                          cursor: item.isRead ? 'default' : 'pointer',
                        }}
                        onClick={() => {
                          if (!item.isRead) {
                            setNotifications(prev => prev.map(n => n.id === item.id ? { ...n, isRead: true } : n));
                            setUnreadCount(prev => Math.max(0, prev - 1));
                            apiClient.put(`/notifications/${item.id}/read`).catch(() => {
                              message.error('通知状态更新失败');
                              void fetchNotifications();
                              void fetchUnread();
                            });
                          }
                        }}>
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <Tag color={item.notificationType.includes('rejected') || item.notificationType === 'task_returned' ? 'red' : item.notificationType.includes('pending') || item.notificationType.includes('submitted') ? 'orange' : item.notificationType.includes('assigned') ? 'blue' : 'green'}
                              style={{ fontSize: 11, lineHeight: '18px' }}>
                              {{ task_assigned: '任务分配', task_returned: '退回', task_submitted: '任务提交', risk_assigned: '风险分配', risk_pending_confirmation: '风险待确认', risk_review_due: '复查到期', remediation_assigned: '整改分配', remediation_submitted: '整改待验证', remediation_approved: '验证通过', remediation_rejected: '验证驳回' }[item.notificationType as string] || '通知'}
                            </Tag>
                            <Text strong style={{ fontSize: 13 }}>{item.title}</Text>
                            {!item.isRead && (
                              <span style={{
                                width: 6, height: 6, borderRadius: 3,
                                background: '#FF3B30', flexShrink: 0,
                                transition: 'opacity 0.3s ease, transform 0.3s ease',
                              }} />
                            )}
                            {item.isRead && (
                              <span style={{ fontSize: 11, color: '#34C759', flexShrink: 0 }}>✓</span>
                            )}
                          </div>
                          <Text style={{ fontSize: 12, color: '#636366' }}>{item.content}</Text>
                          <div style={{ fontSize: 11, color: '#636366', marginTop: 2 }}>
                            {new Date(item.createdAt).toLocaleString('zh-CN')}
                          </div>
                        </div>
                      </List.Item>
                    )} />
                  )}
                </div>
              }>
              <Button type="text" aria-label={unreadCount ? `通知，${unreadCount} 条未读` : '通知'} icon={<Badge count={unreadCount} size="small" offset={[-2, 2]}><BellOutlined style={{ fontSize: 18, color: '#1D1D1F' }} /></Badge>} />
            </Popover>}
            <Dropdown menu={{
              items: userMenuItems,
              onClick: ({ key }) => {
                if (key === 'logout') handleLogout();
                if (key === 'profile') setProfileOpen(true);
              },
            }} placement="bottomRight">
              <button type="button" aria-label="打开账户菜单" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, border: 0, background: 'transparent', padding: 0, font: 'inherit' }}>
                <Avatar size={28} style={{ backgroundColor: '#007AFF', fontSize: 13 }}>
                  {user?.username?.[0]?.toUpperCase()}
                </Avatar>
                <Text className="app-username" style={{ fontSize: 14, fontWeight: 500, color: '#1D1D1F' }}>{user?.username}</Text>
              </button>
            </Dropdown>
          </Space>
        </div>
      </div>

      {/* Body */}
      <div className="app-body" style={{ flex: 1, display: 'flex', alignItems: 'flex-start', minWidth: 0 }}>
        <Sider collapsible collapsed={effectiveCollapsed} onCollapse={setCollapsed} trigger={null}
          width={SIDEBAR_WIDE} collapsedWidth={SIDEBAR_NARROW}
          style={{
            position: 'sticky', top: 52, height: 'calc(100vh - 52px)', overflowY: 'auto',
            background: 'rgba(255,255,255,0.8)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            borderRight: '0.5px solid rgba(0,0,0,0.06)', transition: 'all 0.2s',
          }}>
          <Menu mode="inline" selectedKeys={[activeSideKey]} items={sideMenuItems}
            onClick={({ key }) => navigate(key)}
            style={{ background: 'transparent', borderInlineEnd: 'none', marginTop: 8, fontSize: 14 }} />
        </Sider>
        <Content
          className="app-content"
          style={{
            padding: '28px 32px',
            maxWidth: useFullWidthContent ? 'none' : 1280,
            margin: '0 auto',
            width: '100%',
            minWidth: 0,
            minHeight: 'calc(100vh - 52px)',
          }}
        >
          <Outlet />
        </Content>
      </div>

      <div style={{
        position: 'fixed', bottom: 12, left: '50%', transform: 'translateX(-50%)',
        fontSize: 11, color: 'rgba(0,0,0,0.12)', letterSpacing: '0.02em',
        pointerEvents: 'none', userSelect: 'none', zIndex: 0,
      }}>Powered by Deepseek</div>

      <ProfileModal open={profileOpen} onClose={() => setProfileOpen(false)} />
    </div>
  );
}
