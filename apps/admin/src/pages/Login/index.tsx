import { useState } from 'react';
import { Form, Input, Button, Card, message } from 'antd';
import { useNavigate } from 'umi';
import { useAuth } from '@/contexts/AuthContext';
import { getStats } from '@/api/client';
import styles from './index.less';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form] = Form.useForm();

  async function handleSubmit(values: { username: string; password: string }) {
    setLoading(true);
    try {
      await getStats(values);
      login(values.username, values.password);
      message.success('登录成功');
      navigate('/');
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message === 'UNAUTHORIZED'
            ? '用户名或密码错误'
            : err.message === 'ADMIN_NOT_CONFIGURED'
              ? '管理后台未配置'
              : err.message
          : '登录失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.loginPage}>
      <Card className={styles.card} title="管理后台" size="small">
        <p className={styles.subtitle}>Remote Claude 控制台</p>
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          autoComplete="off"
        >
          <Form.Item
            name="username"
            label="用户名"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input placeholder="请输入用户名" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password placeholder="请输入密码" />
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" loading={loading} block>
              登录
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
