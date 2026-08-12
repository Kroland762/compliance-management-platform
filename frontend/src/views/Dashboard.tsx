import { useEffect, useState } from 'react';
import { Typography, Row, Col, Card, message } from 'antd';
import {
  AuditOutlined, FileTextOutlined, CheckCircleOutlined, WarningOutlined,
  SafetyCertificateOutlined, ClockCircleOutlined, FundOutlined,
} from '@ant-design/icons';
import { useNavigate, Navigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend, LineChart, Line, XAxis, YAxis, CartesianGrid } from 'recharts';
import { useAuthStore } from '../store/auth';
import apiClient from '../api/client';
import { getApiErrorMessage } from '../utils/error';

const { Text } = Typography;

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
  const [stats, setStats] = useState({
    tasks: 0, templates: 0, qualifications: 0, completed: 0, risks: 0,
    highRisks: 0, unresolvedRisks: 0, overdueActions: 0, assessmentCompletionRate: 0,
    openFindings: 0, workItems: { fill: 0, review: 0, remediate: 0, verify: 0 },
  });
  const [taskPie, setTaskPie] = useState<any[]>([]);
  const [riskPie, setRiskPie] = useState<any[]>([]);
  const [riskTrend, setRiskTrend] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchStats = async () => {
      try {
        const statsRes: any = await apiClient.get('/stats');
        if (cancelled) return;
        const pieData = statsRes?.data || {};
        const summary = pieData.summary || {};

        setStats({
          tasks: summary.tasks || 0,
          templates: summary.templates || 0,
          qualifications: summary.qualifications || 0,
          completed: summary.completed || 0,
          risks: summary.risks || 0,
          highRisks: summary.highRisks || 0,
          unresolvedRisks: summary.unresolvedRisks || 0,
          overdueActions: summary.overdueActions || 0,
          assessmentCompletionRate: summary.assessmentCompletionRate || 0,
          openFindings: summary.openFindings || 0,
          workItems: summary.workItems || { fill: 0, review: 0, remediate: 0, verify: 0 },
        });
        setTaskPie(pieData.taskPie || []);
        setRiskPie(pieData.riskPie || []);
        setRiskTrend(pieData.riskTrend || []);
      } catch (error) {
        message.error(getApiErrorMessage(error, '工作台统计加载失败，请稍后重试'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchStats();
    return () => { cancelled = true; };
  }, []);

  const hasAnyPermission = can('tasks', 'read') || can('risks', 'read') || can('qualifications', 'read');
  if (!hasAnyPermission) {
    return <Navigate to="/work-items" replace />;
  }


  return (
    <div>
      {/* Stat Cards */}
      <Row gutter={[16, 16]}>
        {can('tasks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<AuditOutlined />} label="评估项目" value={stats.tasks}
              color="#007AFF" onClick={() => navigate('/assessments')}
            />
          </Col>
        )}
        {can('tasks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<CheckCircleOutlined />} label="已完成" value={stats.completed}
              color="#34C759" onClick={() => navigate('/assessments')}
            />
          </Col>
        )}
        {can('templates', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<FileTextOutlined />} label="合规标准" value={stats.templates}
              color="#5856D6" onClick={() => navigate('/templates')}
            />
          </Col>
        )}
        {can('qualifications', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<SafetyCertificateOutlined />} label="资质台账" value={stats.qualifications}
              color="#00A0A0" onClick={() => navigate('/qualifications')}
            />
          </Col>
        )}
        {can('risks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard
              icon={<WarningOutlined />} label="风险总数" value={stats.risks}
              color="#FF9500" onClick={() => navigate('/governance')}
            />
          </Col>
        )}
        {can('risks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard icon={<WarningOutlined />} label="高风险数量" value={stats.highRisks}
              color="#FF3B30" onClick={() => navigate('/governance')} />
          </Col>
        )}
        {can('risks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard icon={<FundOutlined />} label="未整改风险" value={stats.unresolvedRisks}
              color="#AF52DE" onClick={() => navigate('/governance')} />
          </Col>
        )}
        {can('remediation_actions', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard icon={<ClockCircleOutlined />} label="逾期行动" value={stats.overdueActions}
              color="#FF2D55" onClick={() => navigate('/governance?tab=remediation')} />
          </Col>
        )}
        {can('tasks', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard icon={<CheckCircleOutlined />} label="评估完成率" value={`${stats.assessmentCompletionRate}%`}
              color="#34C759" onClick={() => navigate('/assessments')} />
          </Col>
        )}
        {can('findings', 'read') && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard icon={<WarningOutlined />} label="未解决不符合项" value={stats.openFindings}
              color="#FF9500" onClick={() => navigate('/findings')} />
          </Col>
        )}
        {(can('evaluations', 'read') || can('remediation_actions', 'read')) && (
          <Col xs={24} sm={12} lg={6}>
            <StatCard icon={<ClockCircleOutlined />} label="我的待办"
              value={Object.values(stats.workItems).reduce((sum, value) => sum + Number(value), 0)}
              color="#007AFF" onClick={() => navigate('/work-items')} />
          </Col>
        )}
        {!can('tasks', 'read') && !can('templates', 'read') && !can('qualifications', 'read') && !can('risks', 'read') && (
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
                title={<Text strong style={{ fontSize: 15 }}>评估项目分布</Text>}
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
      {riskTrend.length > 0 && (
        <Card title="本月新增与关闭趋势" style={{ marginTop: 24, borderRadius: 18 }}>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={riskTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
              <XAxis dataKey="month" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="created" name="新增风险" stroke="#FF3B30" strokeWidth={2} />
              <Line type="monotone" dataKey="closed" name="关闭风险" stroke="#34C759" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}
    </div>
  );
}
