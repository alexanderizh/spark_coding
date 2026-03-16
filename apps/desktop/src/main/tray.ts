import { Tray, Menu, app, nativeImage } from 'electron'
import { join } from 'path'
import { showMainWindow, setQuitting } from './window-manager'

let tray: Tray | null = null

export function createTray(appName: string): void {
  const iconPath = join(__dirname, '../../resources/tray-icon.png')
  let icon: Electron.NativeImage
  try {
    const img = nativeImage.createFromPath(iconPath)
    if (img.isEmpty()) {
      icon = nativeImage.createEmpty()
    } else {
      const resized = process.platform === 'win32'
        ? img.crop({ x: 112, y: 152, width: 288, height: 208 }).resize({ width: 20, height: 20 })
        : img.resize({ width: 16, height: 16 })
      icon = resized
      icon.setTemplateImage(false)
    }
  } catch {
    icon = nativeImage.createEmpty()
  }

  tray = new Tray(icon)
  tray.setToolTip(appName)

  const menu = Menu.buildFromTemplate([
    {
      label: `Open ${appName}`,
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
