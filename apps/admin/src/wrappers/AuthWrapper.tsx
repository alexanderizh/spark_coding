import { useAuth } from '@/contexts/AuthContext';
import { Navigate, useLocation, Outlet } from 'react-router-dom';

export default function AuthWrapper() {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />; // 渲染子路由 (Layout)
}
