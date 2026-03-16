同时构建 macOS 和 Windows：默认执行 dist:desktop:mac 和 dist:desktop:win
使用 .prod.env：从 apps/desktop/.prod.env 读取并导出环境变量
参数：
--mac-only：只构建 macOS
--win-only：只构建 Windows
-h, --help：显示帮助
2. 相关改动
electron-builder.yml：将 .prod.env 加入打包文件，随应用一起发布
main/index.ts：在打包后的应用中加载 .prod.env，保证生产环境使用正确配置（如 RELAY_SERVER_URL）
# 构建 macOS 和 Windows
./docker-build/build-desktop.sh
# 仅构建 macOS
./docker-build/build-desktop.sh --mac-only
# 仅构建 Windows
./docker-build/build-desktop.sh --win-only

构建产物位于 apps/desktop/release/

在 macOS 上可同时构建 macOS 和 Windows；在 Windows 上构建 macOS 可能受限，建议在 macOS 或 CI 中执行。