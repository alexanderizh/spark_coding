# Admin 前端应用 Docker 镜像
# 支持通过环境变量配置反向代理地址

# 构建阶段
FROM node:22.18.0-alpine AS builder

WORKDIR /workspace

# 复制依赖文件
COPY package.json yarn.lock ./
COPY tsconfig.base.json ./
COPY scripts ./scripts
COPY packages ./packages
COPY apps/admin ./apps/admin

# 安装依赖并构建
RUN yarn install --frozen-lockfile
RUN yarn build:admin

# 运行阶段 - 使用 Nginx 提供静态文件
FROM nginx:1.25-alpine

# 安装 envsubst 用于替换环境变量
RUN apk add --no-cache gettext

# 复制 Nginx 配置模板
COPY apps/admin/nginx.conf /etc/nginx/conf.d/default.conf.template

# 复制构建产物
COPY --from=builder /workspace/apps/admin/dist /usr/share/nginx/html

# 复制启动脚本
COPY apps/admin/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# 暴露端口
EXPOSE 80

# 使用自定义入口脚本启动
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
