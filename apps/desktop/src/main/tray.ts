import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { showMainWindow, setQuitting } from './window-manager'

let tray: Tray | null = null

export function createTray(): void {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  let icon: Electron.NativeImage
  try {
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) {
      icon = nativeImage.createEmpty()
    } else {
      // 固定 16x16，避免托盘图标显示异常
      icon = img.resize({ width: 16, height: 16 })
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip('Spark Coder')

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Spark Coder',
      click: () => showMainWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        setQuitting(true)
        app.quit()
      },
    },
  ])

  tray.setContextMenu(menu)

  // Single-click on tray icon shows the window
  tray.on('click', () => showMainWindow())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
