import { AuthProvider } from './contexts/AuthContext';
import type { ReactNode } from 'react';

export function rootContainer(container: ReactNode) {
  return <AuthProvider>{container}</AuthProvider>;
}
