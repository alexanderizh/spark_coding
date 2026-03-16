#!/bin/bash
# Mobile 安卓 App 构建脚本
# 运行环境：本机（macOS/Linux，需已安装 Flutter SDK 和 Android SDK）
# 说明：构建 Flutter Android APK，输出文件名为 版本号+构建号.apk

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MOBILE_DIR="$PROJECT_ROOT/apps/mobile"
APK_OUTPUT_DIR="$MOBILE_DIR/build/app/outputs/flutter-apk"

usage() {
  cat <<EOF
用法: $0 [选项]

构建 Mobile 安卓 APK，输出文件名为 版本号+构建号.apk（如 remote_claude_mobile-1.0.0+1.apk）

选项:
  -h, --help     显示此帮助
EOF
}

while [[ $# -gt 0 ]]; do
  case $1 in
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

# 校验 Flutter 环境
if ! command -v flutter &>/dev/null; then
  echo "错误: 未找到 Flutter，请先安装 Flutter SDK 并配置 PATH"
  exit 1
fi

# 校验 mobile 目录
if [ ! -f "$MOBILE_DIR/pubspec.yaml" ]; then
  echo "错误: 缺少 mobile 项目 $MOBILE_DIR/pubspec.yaml"
  exit 1
fi

echo "=========================================="
echo "构建 Mobile 安卓 App"
echo "=========================================="
echo "项目目录: $MOBILE_DIR"
echo "Flutter: $(flutter --version | head -1)"
echo "=========================================="

cd "$MOBILE_DIR"

# 从 pubspec.yaml 解析版本号+构建号（格式：1.0.0+1）
VERSION_LINE=$(grep -E '^version:' pubspec.yaml | head -1)
if [[ "$VERSION_LINE" =~ version:[[:space:]]*([0-9]+\.[0-9]+\.[0-9]+\+[0-9]+) ]]; then
  VERSION_BUILD="${BASH_REMATCH[1]}"
else
  echo "错误: 无法从 pubspec.yaml 解析 version（需格式如 1.0.0+1）"
  exit 1
fi

APP_NAME="remote_claude_mobile"
APK_FINAL_NAME="${APP_NAME}-${VERSION_BUILD}.apk"

echo "版本: $VERSION_BUILD"
echo "输出: $APK_FINAL_NAME"
echo ""

# 获取依赖
echo "获取 Flutter 依赖..."
flutter pub get

# 构建 APK
echo ""
echo "=========================================="
echo "构建 Release APK"
echo "=========================================="
flutter build apk --release
echo "✓ APK 构建完成"
echo ""

# 重命名为 版本号+构建号.apk
SRC_APK="$APK_OUTPUT_DIR/app-release.apk"
FINAL_APK="$APK_OUTPUT_DIR/$APK_FINAL_NAME"
if [ -f "$SRC_APK" ]; then
  cp "$SRC_APK" "$FINAL_APK"
  echo "=========================================="
  echo "Mobile 安卓构建完成"
  echo "=========================================="
  echo "APK 输出: $FINAL_APK"
  ls -la "$FINAL_APK"

  # 将构建产物移到根目录 outputs 文件夹，并重命名为 spark_coder_版本号
  OUTPUTS_DIR="$PROJECT_ROOT/outputs"
  MOBILE_OUTPUT="$OUTPUTS_DIR/mobile"
  mkdir -p "$MOBILE_OUTPUT"
  APK_RENAMED="spark_coder_${VERSION_BUILD}.apk"
  cp "$FINAL_APK" "$MOBILE_OUTPUT/$APK_RENAMED"
  echo ""
  echo "✓ 产物已移至: $MOBILE_OUTPUT/$APK_RENAMED"
  ls -la "$MOBILE_OUTPUT/"
else
  echo "错误: 构建产物不存在 $SRC_APK"
  exit 1
fi
echo ""
