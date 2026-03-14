import { useEffect, useState } from 'react';
import { Card, Row, Col, Statistic, List, Button, Spin } from 'antd';
import { Link } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { getStats, type AdminStats } from '@/api/client';
import styles from './index.module.less';

const STATE_LABELS: Record<string, string> = {
  waiting_for_agent: '等待主机',
  waiting_for_mobile: '等待手机',
  paired: '已配对',
  agent_disconnected: '主机断开',
  mobile_disconnected: '手机断开',
  expired: '已过期',
  error: '错误',
};

export default function DashboardPage() {
  const { credentials } = useAuth();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!credentials) return;
    getStats(credentials)
      .then((r) => setStats(r.data))
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [credentials]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <Spin size="large" />
      </div>
    );
  }
  if (error) {
    return <div className={styles.error}>错误: {error}</div>;
  }
  if (!stats) return null;

  const stateList = Object.entries(stats.byState)
    .sort(([, a], [, b]) => b - a)
    .map(([state, count]) => ({
      key: state,
      label: STATE_LABELS[state] ?? state,
      count,
    }));

  return (
    <div className={styles.dashboard}>
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="总会话数" value={stats.total} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="活跃连接" value={stats.active} />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card>
            <Statistic title="已关闭" value={stats.closed} />
          </Card>
        </Col>
      </Row>

      <Card title="按状态分布" className={styles.stateCard}>
        <List
          size="small"
          dataSource={stateList}
          renderItem={(item) => (
            <List.Item>
              <span>{item.label}</span>
              <span>{item.count}</span>
            </List.Item>
          )}
        />
      </Card>

      <div className={styles.actions}>
        <Link to="/sessions">
          <Button type="primary">查看会话列表</Button>
        </Link>
      </div>
    </div>
  );
}
