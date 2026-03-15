#!/bin/bash
# Server 服务端 Docker 镜像构建脚本
# 运行环境：本机（macOS/Linux）
# 目标部署环境：CentOS 云服务器 Docker
# 构建架构：linux/amd64（兼容 CentOS x86_64）
# 说明：仅构建并推送镜像，不生成本地 tar 包

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-coding-server}"

# 默认镜像仓库（需提前 docker login，推送时使用）
DEFAULT_REGISTRY="ccr.ccs.tencentyun.com/spark_ai"

# 解析参数（默认推送，可通过 --no-push 或环境变量 PUSH=0 禁用）
BRANCH="${BRANCH:-$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'master')}"
IMAGE_TAG=""
PUSH="${PUSH:-1}"
REGISTRY=""
NO_CACHE=""

usage() {
  cat <<EOF
用法: $0 [选项]

构建 Server 服务端 Docker 镜像（linux/amd64，兼容 CentOS）

选项:
  -b, --branch BRANCH    分支名，默认从 git 获取
  -t, --tag TAG          自定义镜像标签，默认: 分支-时间戳-SHA
  --no-push              仅构建不推送（默认会推送）
  -r, --registry URL     覆盖镜像仓库地址
  -n, --no-cache         禁用 Docker 构建缓存
  -h, --help             显示此帮助

推送标签格式：版本号 与 分支名-latest
示例:
  $0                          # 构建并推送到默认仓库（默认行为）
  $0 -t v1.0.0                # 指定标签构建并推送
  $0 --no-push                # 仅构建不推送
  $0 -r 自定义仓库地址         # 构建并推送到指定仓库
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    -b|--branch)
      BRANCH="$2"
      shift 2
      ;;
    -t|--tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --no-push)
      PUSH=""
      shift
      ;;
    -r|--registry)
      REGISTRY="$2"
      shift 2
      ;;
    -n|--no-cache)
      NO_CACHE="--no-cache"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1"
      usage
      exit 1
      ;;
  esac
done

# 生成镜像标签
if [ -z "$IMAGE_TAG" ]; then
  TIMESTAMP=$(date +%Y%m%d-%H%M%S)
  SHORT_SHA=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "local")
  IMAGE_TAG="${BRANCH}-${TIMESTAMP}-${SHORT_SHA}"
fi

FULL_IMAGE_NAME="${IMAGE_NAME}:${IMAGE_TAG}"
PLATFORM="linux/amd64"

echo "=========================================="
echo "构建 Server 服务端镜像"
echo "=========================================="
echo "项目根目录: $PROJECT_ROOT"
echo "镜像名称: $FULL_IMAGE_NAME"
echo "目标平台: $PLATFORM (CentOS x86_64)"
echo "=========================================="

# 验证必要文件（Dockerfile 在 apps/server 下，构建上下文为项目根目录）
if [ ! -f "$PROJECT_ROOT/apps/server/Dockerfile" ]; then
  echo "错误: 缺少 Dockerfile $PROJECT_ROOT/apps/server/Dockerfile"
  exit 1
fi

# 构建镜像（指定 linux/amd64 以兼容 CentOS，--load 加载到本地）
# 构建上下文为项目根目录，Dockerfile 需要 monorepo 完整结构
docker buildx build \
  --platform "$PLATFORM" \
  --load \
  --tag "$FULL_IMAGE_NAME" \
  $NO_CACHE \
  -f "$PROJECT_ROOT/apps/server/Dockerfile" \
  "$PROJECT_ROOT"
docker tag "$FULL_IMAGE_NAME" "${IMAGE_NAME}:${BRANCH}-latest"

echo ""
echo "✓ 镜像构建完成: $FULL_IMAGE_NAME"

# 推送到镜像仓库（每次推送：当前版本号 + 分支名-latest）
if [ "$PUSH" = "1" ]; then
  if ! docker image inspect "$FULL_IMAGE_NAME" &>/dev/null; then
    echo "错误: 镜像 $FULL_IMAGE_NAME 不存在，无法推送（构建可能已失败）"
    exit 1
  fi
  REGISTRY="${REGISTRY:-$DEFAULT_REGISTRY}"
  REMOTE_BASE="${REGISTRY%/}/coding-server"
  REMOTE_VERSION="${REMOTE_BASE}:${IMAGE_TAG}"
  REMOTE_LATEST="${REMOTE_BASE}:${BRANCH}-latest"
  echo "正在推送 coding-server 镜像到腾讯云..."
  docker tag "$FULL_IMAGE_NAME" "$REMOTE_VERSION"
  docker tag "$FULL_IMAGE_NAME" "$REMOTE_LATEST"
  if ! docker push "$REMOTE_VERSION"; then
    echo "错误: 推送 $REMOTE_VERSION 失败，请检查 docker login 及腾讯云 CCR 权限"
    exit 1
  fi
  if ! docker push "$REMOTE_LATEST"; then
    echo "错误: 推送 $REMOTE_LATEST 失败"
    exit 1
  fi
  echo "✓ 已推送: $REMOTE_VERSION"
  echo "✓ 已推送: $REMOTE_LATEST"
fi

REMOTE_IMAGE="${DEFAULT_REGISTRY%/}/coding-server"
echo ""
echo "部署到 CentOS 服务器:"
echo "  1. docker pull $REMOTE_IMAGE:${BRANCH}-latest"
echo "  2. docker run -d -p 7001:7001 -e NODE_ENV=production -e PORT=7001 $REMOTE_IMAGE:${BRANCH}-latest"
echo ""
