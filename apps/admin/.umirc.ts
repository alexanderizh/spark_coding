import { defineConfig } from '@umijs/max';

export default defineConfig({
  antd: {
    configProvider: {},
    style: 'less',
  },
  proxy: {
    '/api': {
      target: 'http://localhost:7001',
      changeOrigin: true,
    },
  },
  routes: [
    { path: '/login', component: '@/pages/Login', layout: false },
    {
      path: '/',
      component: '@/layouts/index',
      wrappers: ['@/wrappers/AuthWrapper'],
      routes: [
        { path: '/', redirect: '/dashboard' },
        { path: '/dashboard', component: '@/pages/Dashboard', name: '概览' },
        { path: '/sessions', component: '@/pages/Sessions', name: '会话列表' },
      ],
    },
  ],
  npmClient: 'yarn',
});
