import { useEffect, useState } from 'react';
import { Table, Select, Tag } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '@/contexts/AuthContext';
import { getSessions, connectionLink, type SessionItem } from '@/api/client';
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

const STATE_COLORS: Record<string, string> = {
  paired: 'green',
  waiting_for_agent: 'gold',
  waiting_for_mobile: 'gold',
  agent_disconnected: 'default',
  mobile_disconnected: 'default',
  expired: 'red',
  error: 'red',
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SessionsPage() {
  const { credentials } = useAuth();
  const [items, setItems] = useState<SessionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState<string>('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const limit = 20;

  useEffect(() => {
    if (!credentials) return;
    setLoading(true);
    getSessions(credentials, {
      page,
      limit,
      state: stateFilter || undefined,
    })
      .then((r) => {
        setItems(r.data.items);
        setTotal(r.data.total);
      })
      .catch((e) => setError(e instanceof Error ? e.message : '加载失败'))
      .finally(() => setLoading(false));
  }, [credentials, page, stateFilter]);

  const columns: ColumnsType<SessionItem> = [
    {
      title: '连接',
      key: 'connection',
      ellipsis: true,
      render: (_: unknown, record: SessionItem) => (
        <span className={styles.connectionLink} title={connectionLink(record)}>
          {connectionLink(record)}
        </span>
      ),
    },
    {
      title: '状态',
      dataIndex: 'state',
      key: 'state',
      width: 120,
      render: (state: string) => (
        <Tag color={STATE_COLORS[state] ?? 'default'}>
          {STATE_LABELS[state] ?? state}
        </Tag>
      ),
    },
    {
      title: '配对时间',
      dataIndex: 'pairedAt',
      key: 'pairedAt',
      width: 140,
      render: (v: number | null) => (v ? formatTime(v) : '—'),
    },
    {
      title: '最后活动',
      dataIndex: 'lastActivityAt',
      key: 'lastActivityAt',
      width: 140,
      render: (v: number) => formatTime(v),
    },
  ];

  return (
    <div className={styles.sessionsPage}>
      <div className={styles.header}>
        <h2>会话列表（主机-应用绑定）</h2>
        <Select
          value={stateFilter || undefined}
          placeholder="全部状态"
          allowClear
          style={{ width: 140 }}
          onChange={(v) => {
            setStateFilter(v ?? '');
            setPage(1);
          }}
          options={Object.entries(STATE_LABELS).map(([value, label]) => ({
            value,
            label,
          }))}
        />
      </div>

      {error && <div className={styles.error}>{error}</div>}

      <Table
        loading={loading}
        columns={columns}
        dataSource={items}
        rowKey="id"
        pagination={{
          current: page,
          pageSize: limit,
          total,
          showSizeChanger: false,
          showTotal: (t) => `共 ${t} 条`,
          onChange: setPage,
        }}
      />
    </div>
  );
}
