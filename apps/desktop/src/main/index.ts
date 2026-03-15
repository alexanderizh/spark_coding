import { config as loadEnv } from 'dotenv'
import { resolve } from 'path'

// 加载 .env：优先 apps/desktop/.env，其次项目根目录 .env
loadEnv({ path: resolve(process.cwd(), '.env') })
loadEnv({ path: resolve(process.cwd(), 'apps/desktop/.env') })

import { app } from 'electron'
import { createMainWindow, showMainWindow, setQuitting } from './window-manager'
import { createTray } from './tray'
import { setupIpc, maybeAutoStart } from './ipc'
import { getMainWindow } from './window-manager'

// Single instance lock — prevent multiple app instances
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })
}

app.whenReady().then(async () => {
  const win = createMainWindow()

  createTray()
  setupIpc(() => getMainWindow())

  // Auto-start session once renderer has loaded
  win.webContents.once('did-finish-load', async () => {
    await maybeAutoStart(() => getMainWindow())
  })

  app.on('activate', () => {
    // macOS: re-show window when dock icon is clicked
    showMainWindow()
  })
})

// Keep process alive when all windows are closed (tray mode)
app.on('window-all-closed', () => {
  // Do NOT quit — app stays in system tray
})

app.on('before-quit', () => {
  setQuitting(true)
})
