import { useEffect, useState } from 'react';
import { Typography, Row, Col, Card, Progress } from 'antd';
import {
  DatabaseOutlined,
  UserOutlined,
  WarningOutlined,
  AlertOutlined,
  ClockCircleOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { dashboardApi, type DashboardOverview, type DashboardTrend, type DashboardDistribution, type DashboardRanking } from '../../api/account';
import { getApiErrorMessage } from '../../utils/error';
import { message } from 'antd';

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
      fontSize: 24, color, flexShrink: 0,
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

export default function AccountDashboard() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [trends, setTrends] = useState<DashboardTrend[]>([]);
  const [distribution, setDistribution] = useState<DashboardDistribution[]>([]);
  const [ranking, setRanking] = useState<DashboardRanking[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchData = async () => {
      try {
        const [overviewRes, trendsRes, distRes, rankRes] = await Promise.allSettled([
          dashboardApi.overview(),
          dashboardApi.trends({ period: '30d' }),
          dashboardApi.distribution(),
          dashboardApi.ranking({ top: 10 }),
        ]);
        if (cancelled) return;
        if (overviewRes.status === 'fulfilled') {
          setOverview((overviewRes.value as any).data);
        }
        if (trendsRes.status === 'fulfilled') {
          setTrends((trendsRes.value as any).data || []);
        }
        if (distRes.status === 'fulfilled') {
          const rawDist = (distRes.value as any).data || {};
          // API 返回 { HIGH: N, MEDIUM: N, LOW: N }，转数组
          const distArray = Object.entries(rawDist).map(([key, value]) => ({
            name: key === 'HIGH' ? '高' : key === 'MEDIUM' ? '中' : '低',
            value: value as number,
            color: key === 'HIGH' ? '#FF3B30' : key === 'MEDIUM' ? '#FF9500' : '#34C759',
          }));
          setDistribution(distArray);
        }
        if (rankRes.status === 'fulfilled') {
          const rawRank = (rankRes.value as any).data || [];
          // API 返回 [{ taskName, sourceName, problemCount }]，映射为图表字段
          const rankArray = rawRank.map((r: any) => ({
            name: r.sourceName || r.taskName || '未知',
            count: r.problemCount || 0,
          }));
          setRanking(rankArray);
        }
      } catch {
        message.error('获取概览数据失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchData();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      {/* Stat Cards */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={Math.floor(24 / 5)}>
          <StatCard
            icon={<DatabaseOutlined />} label="数据源" value={overview?.dataSourcesCount ?? '-'}
            color="#007AFF" onClick={() => navigate('/account-audit/data-sources')}
          />
        </Col>
        <Col xs={24} sm={12} lg={Math.floor(24 / 5)}>
          <StatCard
            icon={<UserOutlined />} label="账户总数" value={overview?.totalAccounts ?? '-'}
            color="#34C759"
          />
        </Col>
        <Col xs={24} sm={12} lg={Math.floor(24 / 5)}>
          <StatCard
            icon={<WarningOutlined />} label="问题总数" value={overview?.totalProblems ?? '-'}
            color="#FF9500" onClick={() => navigate('/account-audit/problems')}
          />
        </Col>
        <Col xs={24} sm={12} lg={Math.floor(24 / 5)}>
          <StatCard
            icon={<AlertOutlined />} label="高风险" value={overview?.highRiskCount ?? '-'}
            color="#FF9500"
          />
        </Col>
        <Col xs={24} sm={12} lg={Math.floor(24 / 5)}>
          <StatCard
            icon={<ClockCircleOutlined />} label="待处理" value={overview?.pendingCount ?? '-'}
            color="#5856D6"
          />
        </Col>
      </Row>

      {/* Charts Row */}
      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        {/* Risk Distribution Pie */}
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
            title={<Text strong style={{ fontSize: 15 }}>风险等级分布</Text>}
          >
            {distribution.length === 0 ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AEAEB2' }}>
                暂无数据
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={distribution} cx="50%" cy="50%" innerRadius={55} outerRadius={95} paddingAngle={3} dataKey="value">
                    {distribution.map((entry, i) => (
                      <Cell key={i} fill={entry.color} />
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
            )}
          </Card>
        </Col>

        {/* Ranking Bar */}
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
            title={<Text strong style={{ fontSize: 15 }}>数据源问题排行</Text>}
          >
            {ranking.length === 0 ? (
              <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AEAEB2' }}>
                暂无数据
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={ranking} layout="vertical" margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#8E8E93' }} />
                  <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11, fill: '#636366' }} />
                  <Tooltip
                    formatter={(value: any) => [value, '问题数']}
                    contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}
                  />
                  <Bar dataKey="count" fill="#007AFF" radius={[0, 6, 6, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>

      {/* Trends Chart */}
      <Row gutter={[16, 16]} style={{ marginTop: 24 }}>
        <Col span={24}>
          <Card
            loading={loading}
            style={{
              background: 'rgba(255,255,255,0.8)',
              backdropFilter: 'blur(20px)',
              borderRadius: 18,
              border: '0.5px solid rgba(0,0,0,0.04)',
              boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
            }}
            title={
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <RiseOutlined style={{ color: '#007AFF' }} />
                <Text strong style={{ fontSize: 15 }}>问题发现趋势 (近30天)</Text>
              </div>
            }
          >
            {trends.length === 0 ? (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#AEAEB2' }}>
                暂无数据
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#8E8E93' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#8E8E93' }} />
                  <Tooltip
                    formatter={(value: any) => [value, '问题数']}
                    contentStyle={{ borderRadius: 10, border: 'none', boxShadow: '0 2px 12px rgba(0,0,0,0.08)' }}
                  />
                  <Bar dataKey="count" fill="#007AFF" radius={[6, 6, 0, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
