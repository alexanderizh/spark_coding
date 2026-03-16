#!/bin/sh
# Admin 容器入口脚本
# 用于替换环境变量到 Nginx 配置

set -e

# 默认反向代理地址（后端服务）
export API_BASE_URL="${API_BASE_URL:-http://localhost:7001}"

echo "=========================================="
echo "Admin 前端服务启动配置"
echo "=========================================="
echo "API_BASE_URL: $API_BASE_URL"
echo "=========================================="

# 使用环境变量替换 Nginx 配置模板
envsubst '\$API_BASE_URL' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf

# 输出最终配置（调试用）
echo "生成的 Nginx 配置:"
cat /etc/nginx/conf.d/default.conf

# 执行传入的命令
exec "$@"
