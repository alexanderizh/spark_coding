#!/bin/bash
# Admin 前端 Docker 镜像构建脚本
# 运行环境：本机（macOS/Linux）
# 目标部署环境：CentOS 云服务器 Docker
# 构建架构：linux/amd64（兼容 CentOS x86_64）
# 说明：支持自定义 API 反向代理地址环境变量

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IMAGE_NAME="${IMAGE_NAME:-coding-admin}"

# 默认镜像仓库（需提前 docker login，推送时使用）
DEFAULT_REGISTRY="ccr.ccs.tencentyun.com/spark_ai"

# 默认 API 反向代理地址
DEFAULT_API_BASE_URL="http://localhost:7001"

# 解析参数
BRANCH="${BRANCH:-$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'master')}"
IMAGE_TAG=""
PUSH="${PUSH:-1}"
REGISTRY=""
NO_CACHE=""
API_BASE_URL="${API_BASE_URL:-$DEFAULT_API_BASE_URL}"

usage() {
  cat <<EOF
用法: $0 [选项]

构建 Admin 前端 Docker 镜像（linux/amd64，兼容 CentOS）
支持通过环境变量配置 API 反向代理地址

选项:
  -b, --branch BRANCH      分支名，默认从 git 获取
  -t, --tag TAG            自定义镜像标签，默认: 分支-时间戳-SHA
  -a, --api-url URL        API 基础地址（反向代理目标），默认: $DEFAULT_API_BASE_URL
  --no-push                仅构建不推送（默认会推送）
  -r, --registry URL       覆盖镜像仓库地址
  -n, --no-cache           禁用 Docker 构建缓存
  -h, --help               显示此帮助

环境变量:
  API_BASE_URL             设置 API 反向代理地址
  IMAGE_NAME               设置镜像名称，默认: coding-admin

示例:
  $0                                    # 构建并推送到默认仓库
  $0 -a http://192.168.1.100:7001       # 指定后端 API 地址
  $0 -t v1.0.0 --no-push                # 指定标签构建但不推送
  API_BASE_URL=http://api.example.com $0 # 通过环境变量设置 API 地址
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
    -a|--api-url)
      API_BASE_URL="$2"
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
echo "构建 Admin 前端镜像"
echo "=========================================="
echo "项目根目录: $PROJECT_ROOT"
echo "镜像名称: $FULL_IMAGE_NAME"
echo "目标平台: $PLATFORM (CentOS x86_64)"
echo "API 代理地址: $API_BASE_URL"
echo "=========================================="

# 验证必要文件
if [ ! -f "$PROJECT_ROOT/apps/admin/Dockerfile" ]; then
  echo "错误: 缺少 Dockerfile $PROJECT_ROOT/apps/admin/Dockerfile"
  exit 1
fi

# 构建镜像（指定 linux/amd64 以兼容 CentOS，--load 加载到本地）
docker buildx build \
  --platform "$PLATFORM" \
  --load \
  --tag "$FULL_IMAGE_NAME" \
  --build-arg API_BASE_URL="$API_BASE_URL" \
  $NO_CACHE \
  -f "$PROJECT_ROOT/apps/admin/Dockerfile" \
  "$PROJECT_ROOT"

docker tag "$FULL_IMAGE_NAME" "${IMAGE_NAME}:${BRANCH}-latest"

echo ""
echo "✓ 镜像构建完成: $FULL_IMAGE_NAME"

# 将构建产物（镜像 tar）移到根目录 outputs 文件夹
OUTPUTS_DIR="$PROJECT_ROOT/outputs"
ADMIN_OUTPUT="$OUTPUTS_DIR/admin"
mkdir -p "$ADMIN_OUTPUT"
ADMIN_VERSION=$(node -p "require('$PROJECT_ROOT/apps/admin/package.json').version" 2>/dev/null || echo "1.0.0")
IMAGE_TAR="$ADMIN_OUTPUT/spark_coder_admin_${ADMIN_VERSION}.tar"
echo "保存镜像到 $IMAGE_TAR ..."
docker save "$FULL_IMAGE_NAME" -o "$IMAGE_TAR"
echo "✓ 产物已保存至: $IMAGE_TAR"
ls -lh "$IMAGE_TAR"

# 推送到镜像仓库
if [ "$PUSH" = "1" ]; then
  if ! docker image inspect "$FULL_IMAGE_NAME" &>/dev/null; then
    echo "错误: 镜像 $FULL_IMAGE_NAME 不存在，无法推送（构建可能已失败）"
    exit 1
  fi
  REGISTRY="${REGISTRY:-$DEFAULT_REGISTRY}"
  REMOTE_BASE="${REGISTRY%/}/coding-admin"
  REMOTE_VERSION="${REMOTE_BASE}:${IMAGE_TAG}"
  REMOTE_LATEST="${REMOTE_BASE}:${BRANCH}-latest"
  echo ""
  echo "正在推送 coding-admin 镜像到仓库..."
  docker tag "$FULL_IMAGE_NAME" "$REMOTE_VERSION"
  docker tag "$FULL_IMAGE_NAME" "$REMOTE_LATEST"
  if ! docker push "$REMOTE_VERSION"; then
    echo "错误: 推送 $REMOTE_VERSION 失败，请检查 docker login 及仓库权限"
    exit 1
  fi
  if ! docker push "$REMOTE_LATEST"; then
    echo "错误: 推送 $REMOTE_LATEST 失败"
    exit 1
  fi
  echo "✓ 已推送: $REMOTE_VERSION"
  echo "✓ 已推送: $REMOTE_LATEST"
fi

echo ""
echo "=========================================="
echo "构建完成！"
echo "=========================================="
REMOTE_IMAGE="${DEFAULT_REGISTRY%/}/coding-admin"
echo "本地镜像:"
echo "  - $FULL_IMAGE_NAME"
echo "  - ${IMAGE_NAME}:${BRANCH}-latest"
echo ""
echo "部署到服务器示例:"
echo "  1. docker pull $REMOTE_IMAGE:${BRANCH}-latest"
echo "  2. docker run -d -p 80:80 -e API_BASE_URL=http://your-api-server:7001 $REMOTE_IMAGE:${BRANCH}-latest"
echo ""
echo "或在本地运行:"
echo "  docker run -d -p 5174:80 -e API_BASE_URL=http://host.docker.internal:7001 ${IMAGE_NAME}:${BRANCH}-latest"
echo ""
