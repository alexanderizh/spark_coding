import { Outlet, useNavigate, useLocation } from 'umi';
import { Layout as AntLayout, Menu, Button } from 'antd';
import { DashboardOutlined, UnorderedListOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import styles from './index.less';

const { Header, Content } = AntLayout;

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
    { key: '/sessions', icon: <UnorderedListOutlined />, label: '会话列表' },
  ];

  return (
    <AntLayout className={styles.layout}>
      <Header className={styles.header}>
        <div className={styles.logo}>Remote Claude 管理后台</div>
        <Menu
          theme="dark"
          mode="horizontal"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          className={styles.menu}
        />
        <Button
          type="text"
          icon={<LogoutOutlined />}
          onClick={logout}
          className={styles.logout}
        >
          退出
        </Button>
      </Header>
      <Content className={styles.content}>
        <Outlet />
      </Content>
    </AntLayout>
  );
}
