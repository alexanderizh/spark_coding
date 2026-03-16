#!/bin/bash
# Desktop 客户端构建脚本（macOS + Windows）
# 运行环境：本机（macOS/Linux，Windows 构建需在 macOS 上或使用 CI）
# 说明：使用 apps/desktop/.prod.env 中的环境变量进行构建

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROD_ENV="$PROJECT_ROOT/apps/desktop/.prod.env"

# 解析参数
BUILD_MAC=1
BUILD_WIN=1

usage() {
  cat <<EOF
用法: $0 [选项]

构建 Desktop 客户端（macOS + Windows），使用 .prod.env 环境变量

选项:
  --mac-only     仅构建 macOS
  --win-only     仅构建 Windows
  -h, --help     显示此帮助

示例:
  $0                    # 构建 macOS 和 Windows
  $0 --mac-only         # 仅构建 macOS
  $0 --win-only         # 仅构建 Windows
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
    --mac-only)
      BUILD_MAC=1
      BUILD_WIN=0
      shift
      ;;
    --win-only)
      BUILD_MAC=0
      BUILD_WIN=1
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

# 校验 .prod.env 存在
if [ ! -f "$PROD_ENV" ]; then
  echo "错误: 缺少生产环境配置文件 $PROD_ENV"
  exit 1
fi

# 加载 .prod.env 环境变量（排除注释和空行）
echo "=========================================="
echo "加载生产环境变量: $PROD_ENV"
echo "=========================================="
set -a
while IFS= read -r line || [ -n "$line" ]; do
  [[ "$line" =~ ^[[:space:]]*# ]] && continue
  [[ -z "${line// }" ]] && continue
  if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
    export "$line"
    echo "  ${BASH_REMATCH[1]}=***"
  fi
done < "$PROD_ENV"
set +a
echo ""

# 进入项目根目录
cd "$PROJECT_ROOT"

# 确保依赖已安装
if [ ! -d "node_modules" ]; then
  echo "安装项目依赖..."
  yarn install
fi

# 构建 macOS
if [ "$BUILD_MAC" = "1" ]; then
  echo "=========================================="
  echo "构建 macOS 版本"
  echo "=========================================="
  yarn dist:desktop:mac
  echo "✓ macOS 构建完成"
  echo ""
fi

# 构建 Windows
if [ "$BUILD_WIN" = "1" ]; then
  echo "=========================================="
  echo "构建 Windows 版本"
  echo "=========================================="
  yarn dist:desktop:win
  echo "✓ Windows 构建完成"
  echo ""
fi

echo "=========================================="
echo "Desktop 构建完成"
echo "=========================================="
echo "输出目录: $PROJECT_ROOT/apps/desktop/release/"
ls -la "$PROJECT_ROOT/apps/desktop/release/" 2>/dev/null || true

# 将构建产物移至 outputs，仅保留 Windows setup 和 macOS arm64 包，并重命名为 spark_coder_版本号
OUTPUTS_DIR="$PROJECT_ROOT/outputs"
DESKTOP_OUTPUT="$OUTPUTS_DIR/desktop"
RELEASE_DIR="$PROJECT_ROOT/apps/desktop/release"
mkdir -p "$DESKTOP_OUTPUT"
if [ -d "$RELEASE_DIR" ]; then
  echo ""
  echo "将构建产物移至 $DESKTOP_OUTPUT（仅 Windows setup + macOS arm64）..."
  rm -rf "$DESKTOP_OUTPUT"/*
  DESKTOP_VERSION=$(node -p "require('$PROJECT_ROOT/apps/desktop/package.json').version" 2>/dev/null || echo "1.0.0")
  REPLACE_NAME="spark_coder_${DESKTOP_VERSION}"
  # 仅复制 Windows setup 和 macOS arm64 dmg
  for f in "$RELEASE_DIR"/"Spark Coder Setup ${DESKTOP_VERSION}.exe" "$RELEASE_DIR"/"Spark Coder-${DESKTOP_VERSION}-arm64.dmg"; do
    [ -f "$f" ] && cp -p "$f" "$DESKTOP_OUTPUT/"
  done
  # 重命名为 spark_coder_版本号
  V_ESC=$(echo "$DESKTOP_VERSION" | sed 's/\./\\./g')
  for f in "$DESKTOP_OUTPUT"/*; do
    [ -f "$f" ] || continue
    b=$(basename "$f")
    n=$(echo "$b" | sed "s/Spark Coder Setup ${V_ESC}/${REPLACE_NAME}-setup/" | sed "s/Spark Coder-${V_ESC}-arm64/${REPLACE_NAME}-arm64/")
    [ "$b" != "$n" ] && mv "$f" "$DESKTOP_OUTPUT/$n"
  done
  echo "✓ 产物已移至: $DESKTOP_OUTPUT"
  ls -la "$DESKTOP_OUTPUT/" 2>/dev/null || true
fi
