import { useAuth } from '@/contexts/AuthContext';
import { Navigate, useLocation } from 'umi';

export default function AuthWrapper(props: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <>{props.children}</>;
}
