import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Layout as AntLayout, Menu, Button } from 'antd';
import { DashboardOutlined, UnorderedListOutlined, AppstoreOutlined, LogoutOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import styles from './Layout.module.less';

const { Header, Content } = AntLayout;

const menuItems = [
  { key: '/dashboard', icon: <DashboardOutlined />, label: '概览' },
  { key: '/sessions', icon: <UnorderedListOutlined />, label: '会话列表' },
  { key: '/versions', icon: <AppstoreOutlined />, label: '版本管理' },
];

export default function Layout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

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
