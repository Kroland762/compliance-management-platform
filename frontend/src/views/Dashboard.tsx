import { useEffect, useState } from 'react';
import { Typography, Row, Col, Card } from 'antd';
import {
  AuditOutlined, FileTextOutlined, CheckCircleOutlined, WarningOutlined,
} from '@ant-design/icons';
import { useNavigate, Navigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts';
import { useAuthStore } from '../store/auth';
import apiClient from '../api/client';

const { Title, Text } = Typography;

const StatCard = ({
  icon, label, value, color, onClick,
}: {
  icon: React.ReactNode; label: string; value: string | number; color: string; onClick?: () => void;
}) => (
  <div
    onClick={onClick}
    style={{
      background: 'rgba(255,255,255,0.8)',
      backdropFilter: 'blur(20px)',
      WebkitBackdropFilter: 'blur(20px)',
      borderRadius: 18,
      padding: '20px 24px',
      boxShadow: '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)',
      display: 'flex',
      alignItems: 'center',
      gap: 16,
      transition: 'all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)',
      cursor: onClick ? 'pointer' : 'default',
      border: '0.5px solid transparent',
    }}
    onMouseEnter={e => {
      if (!onClick) return;
      e.currentTarget.style.transform = 'translateY(-2px)';
      e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.08), 0 0 0 0.5px rgba(0,0,0,0.06)';
      e.currentTarget.style.borderColor = color + '30';
    }}
    onMouseLeave={e => {
      if (!onClick) return;
      e.currentTarget.style.transform = 'translateY(0)';
      e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04), 0 0 0 0.5px rgba(0,0,0,0.04)';
      e.currentTarget.style.borderColor = 'transparent';
    }}
  >
    <div style={{
      width: 48, height: 48, borderRadius: 14,
      background: `${color}14`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 22, color, flexShrink: 0,
    }}>
      {icon}
    </div>
    <div>
      <div style={{ fontSize: 13, color: '#8E8E93', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, color: '#1D1D1F', letterSpacing: '-0.02em', lineHeight: 1 }}>
        {value}
      </div>
    </div>
  </div>
);

export default function Dashboard() {
  const user = useAuthStore((s) => s.user);
  const can = useAuthStore((s) => s.hasPermission);
  const navigate = useNavigate();
  const [stats, setStats] = useState({ tasks: 0, templates: 0, completed: 0, risks: 0 });
  const [taskPie, setTaskPie] = useState<any[]>([]);
  const [riskPie, setRiskPie] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const results: PromiseSettledResult<any>[] = [];
        const promises: Promise<any>[] = [];

        if (can('tasks', 'read')) promises.push(apiClient.get('/tasks'));
        if (can('templates', 'read')) promises.push(apiClient.get('/templates'));
        if (can('risks', 'read')) promises.push(apiClient.get('/risks'));
        promises.push(apiClient.get('/stats'));

        const settled = await Promise.allSettled(promises);
        if (cancelled) return;

        let idx = 0;
        const tasksRes = can('tasks', 'read') ? settled[idx++] : null;
        const templatesRes = can('templates', 'read') ? settled[idx++] : null;
        const risksRes = can('risks', 'read') ? settled[idx++] : null;
        const statsRes = settled[idx++];

        const tasks = tasksRes?.status === 'fulfilled' ? tasksRes.value?.data?.items || [] : [];
        const templates = templatesRes?.status === 'fulfilled' ? templatesRes.value?.data?.items || [] : [];
        const risks = risksRes?.status === 'fulfilled' ? risksRes.value?.data?.items || [] : [];
        const pieData = statsRes?.status === 'fulfilled' ? statsRes.value?.data : {};

        setStats({
          tasks: tasks.length,
          templates: templates.length,
          completed: tasks.filter((t: any) => t.status === 'completed').length,
          risks: risks.length,
        });
        setTaskPie(pieData.taskPie || []);
        setRiskPie(pieData.riskPie || []);
      } catch {} finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  const hasAnyPermission = can('tasks', 'read') || can('risks', 'read');
  if (!hasAnyPermission) {
    return <Navigate to="/my-tasks" replace />;
  }


  return (
    <div>
      <Title level={3} style={{ fontWeight: 600, letterSpacing: '-0.02em', marginBottom: 24 }}>
        工作台
      </Title>

      {/* Stat Cards */}
      <Row gutter={[16, 16]}>
        {can('tasks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<AuditOutlined />} label="审计任务" value={stats.tasks}
              color="#007AFF" onClick={() => navigate('/tasks/review')}
            />
          </Col>
        )}
        {can('tasks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<CheckCircleOutlined />} label="已完成" value={stats.completed}
              color="#34C759" onClick={() => navigate('/tasks/review')}
            />
          </Col>
        )}
        {can('templates', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<FileTextOutlined />} label="问卷模版" value={stats.templates}
              color="#5856D6" onClick={() => navigate('/templates')}
            />
          </Col>
        )}
        {can('risks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<WarningOutlined />} label="风险项" value={stats.risks}
              color="#FF9500" onClick={() => navigate('/risks')}
            />
          </Col>
        )}
        {!can('tasks', 'read') && !can('templates', 'read') && !can('risks', 'read') && (
          <Col span={24}>
            <Text type="secondary">暂无权限查看统计数据</Text>
          </Col>
        )}
      </Row>

      {/* Charts Row */}
      {(taskPie.length > 0 || riskPie.length > 0) && (
        <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
          {taskPie.length > 0 && (
            <Col xs={24} lg={12}>
              <Card
                loading={loading}
                style={{
                  background: 'rgba(255,255,255,0.8)',
                  backdropFilter: 'blur(20px)',
                  borderRadius: 18,
                  border: '0.5px solid rgba(0,0,0,0.04)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                title={<Text strong style={{ fontSize: 15 }}>审计任务分布</Text>}
              >
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={taskPie} cx="50%" cy="50%" innerRadius={55} outerRadius={95}
                      paddingAngle={3} dataKey="value">
                      {taskPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color || ['#007AFF', '#34C759', '#FF9500', '#5856D6', '#FF3B30'][i % 5]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any) => [value, '数量']}
                      contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(value: string) => <span style={{ fontSize: 12, color: '#636366' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          )}
          {riskPie.length > 0 && (
            <Col xs={24} lg={12}>
              <Card
                loading={loading}
                style={{
                  background: 'rgba(255,255,255,0.8)',
                  backdropFilter: 'blur(20px)',
                  borderRadius: 18,
                  border: '0.5px solid rgba(0,0,0,0.04)',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                }}
                title={<Text strong style={{ fontSize: 15 }}>风险级别分布</Text>}
              >
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={riskPie} cx="50%" cy="50%" innerRadius={55} outerRadius={95}
                      paddingAngle={3} dataKey="value">
                      {riskPie.map((entry, i) => (
                        <Cell key={i} fill={entry.color || ['#FF3B30', '#FF9500', '#34C759'][i % 3]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: any) => [value, '数量']}
                      contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}
                    />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(value: string) => <span style={{ fontSize: 12, color: '#636366' }}>{value}</span>}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          )}
        </Row>
      )}
    </div>
  );
}
