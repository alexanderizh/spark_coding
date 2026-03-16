import { useEffect, useState } from 'react';
import { Table, Tabs, Button, Modal, Form, Input, Select, Space, Popconfirm, message } from 'antd';
import { PlusOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import type { ColumnsType } from 'antd/es/table';
import { useAuth } from '@/contexts/AuthContext';
import {
  getVersions,
  createVersion,
  updateVersion,
  deleteVersion,
  type VersionItem,
  type VersionType,
  type VersionPlatform,
} from '@/api/client';
import styles from './index.module.less';

const PLATFORM_OPTIONS: Record<VersionType, { value: VersionPlatform; label: string }[]> = {
  app: [{ value: 'android', label: '安卓' }],
  desktop: [
    { value: 'macos', label: 'macOS' },
    { value: 'windows', label: 'Windows' },
  ],
};

const PLATFORM_LABELS: Record<VersionPlatform, string> = {
  android: '安卓',
  macos: 'macOS',
  windows: 'Windows',
};

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

interface FormValues {
  version: string;
  platform: VersionPlatform;
  downloadUrl: string;
  releaseNotes?: string;
}

export default function VersionsPage() {
  const { credentials } = useAuth();
  const [activeTab, setActiveTab] = useState<VersionType>('app');
  const [items, setItems] = useState<VersionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<VersionItem | null>(null);
  const [form] = Form.useForm<FormValues>();

  const limit = 20;

  const fetchData = async () => {
    if (!credentials) return;
    setLoading(true);
    try {
      const r = await getVersions(credentials, { type: activeTab, page, limit });
      setItems(r.data.items);
      setTotal(r.data.total);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [credentials, activeTab, page]);

  useEffect(() => {
    setPage(1);
  }, [activeTab]);

  const handleCreate = () => {
    setEditingItem(null);
    form.resetFields();
    setModalOpen(true);
  };

  const handleEdit = (record: VersionItem) => {
    setEditingItem(record);
    form.setFieldsValue({
      version: record.version,
      platform: record.platform,
      downloadUrl: record.downloadUrl,
      releaseNotes: record.releaseNotes ?? undefined,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!credentials) return;
    try {
      const r = await deleteVersion(credentials, id);
      if (r.success) {
        message.success('删除成功');
        fetchData();
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '删除失败');
    }
  };

  const handleSubmit = async (values: FormValues) => {
    if (!credentials) return;
    try {
      if (editingItem) {
        const r = await updateVersion(credentials, editingItem.id, values);
        if (r.success) {
          message.success('更新成功');
          setModalOpen(false);
          fetchData();
        }
      } else {
        const r = await createVersion(credentials, { ...values, type: activeTab });
        if (r.success) {
          message.success('创建成功');
          setModalOpen(false);
          fetchData();
        }
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    }
  };

  const columns: ColumnsType<VersionItem> = [
    {
      title: '版本号',
      dataIndex: 'version',
      key: 'version',
      width: 120,
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 100,
      render: (p: VersionPlatform) => PLATFORM_LABELS[p] ?? p,
    },
    {
      title: '下载链接',
      dataIndex: 'downloadUrl',
      key: 'downloadUrl',
      ellipsis: true,
      render: (url: string) => (
        <a href={url} target="_blank" rel="noopener noreferrer" className={styles.link}>
          {url}
        </a>
      ),
    },
    {
      title: '发布说明',
      dataIndex: 'releaseNotes',
      key: 'releaseNotes',
      ellipsis: true,
      render: (v: string | null) => v || '—',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 150,
      render: (v: number) => formatTime(v),
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      render: (_: unknown, record: VersionItem) => (
        <Space size="small">
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => handleEdit(record)}>
            编辑
          </Button>
          <Popconfirm title="确定删除此版本？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className={styles.versionsPage}>
      <div className={styles.header}>
        <h2>版本管理</h2>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
          新增版本
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as VersionType)}
        items={[
          { key: 'app', label: 'App 版本' },
          { key: 'desktop', label: 'Desktop 版本' },
        ]}
      />

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

      <Modal
        title={editingItem ? '编辑版本' : '新增版本'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form form={form} layout="vertical" onFinish={handleSubmit}>
          <Form.Item
            name="version"
            label="版本号"
            rules={[{ required: true, message: '请输入版本号' }]}
          >
            <Input placeholder="如：1.0.0" />
          </Form.Item>
          <Form.Item
            name="platform"
            label="平台"
            rules={[{ required: true, message: '请选择平台' }]}
          >
            <Select
              placeholder="请选择平台"
              options={PLATFORM_OPTIONS[activeTab]}
            />
          </Form.Item>
          <Form.Item
            name="downloadUrl"
            label="下载链接"
            rules={[
              { required: true, message: '请输入下载链接' },
              { type: 'url', message: '请输入有效的 URL' },
            ]}
          >
            <Input placeholder="https://..." />
          </Form.Item>
          <Form.Item name="releaseNotes" label="发布说明">
            <Input.TextArea rows={4} placeholder="版本更新内容..." />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: 'right' }}>
            <Space>
              <Button onClick={() => setModalOpen(false)}>取消</Button>
              <Button type="primary" htmlType="submit">
                {editingItem ? '保存' : '创建'}
              </Button>
            </Space>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
