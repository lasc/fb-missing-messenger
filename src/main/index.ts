import { app, shell, BrowserWindow, ipcMain, nativeImage, session, Notification, Menu, dialog } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, createWriteStream, unlinkSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import https from 'https'
import { execSync } from 'child_process'

// --- Update Checker ---

interface UpdateInfo {
  hasUpdate: boolean
  latestVersion: string
  assetUrl: string
  releaseName: string
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) < (pb[i] || 0)) return -1
    if ((pa[i] || 0) > (pb[i] || 0)) return 1
  }
  return 0
}

function getDismissedVersion(): string | null {
  try {
    const filePath = join(app.getPath('userData'), 'dismissed-updates.json')
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return data.dismissedVersion || null
  } catch {
    return null
  }
}

function setDismissedVersion(version: string): void {
  const filePath = join(app.getPath('userData'), 'dismissed-updates.json')
  writeFileSync(filePath, JSON.stringify({ dismissedVersion: version }), 'utf-8')
}

/** HTTPS GET with redirect following (GitHub → S3) */
function httpsGet(url: string, headers: Record<string, string> = {}): Promise<{ res: import('http').IncomingMessage }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const req = https.get({
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      headers: { 'User-Agent': 'FB-Missing-Messenger-UpdateChecker', ...headers }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        httpsGet(res.headers.location, headers).then(resolve).catch(reject)
      } else {
        resolve({ res })
      }
    })
    req.on('error', reject)
    req.setTimeout(30000, () => { req.destroy(); reject(new Error('timeout')) })
  })
}

function checkForUpdates(ignoreDismissed = false): Promise<UpdateInfo | null> {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.github.com',
      path: '/repos/lasc/fb-missing-messenger/releases/latest',
      headers: { 'User-Agent': 'FB-Missing-Messenger-UpdateChecker' }
    }

    const req = https.get(options, (res) => {
      let body = ''
      res.on('data', (chunk: string) => { body += chunk })
      res.on('end', () => {
        try {
          const release = JSON.parse(body)
          const latestVersion = release.tag_name
          const currentVersion = app.getVersion()

          if (compareSemver(currentVersion, latestVersion) < 0) {
            if (!ignoreDismissed) {
              const dismissed = getDismissedVersion()
              if (dismissed === latestVersion) {
                resolve(null)
                return
              }
            }

            // Find the DMG asset
            const dmgAsset = release.assets?.find((a: any) =>
              a.name.endsWith('.dmg')
            )
            if (!dmgAsset) {
              resolve(null)
              return
            }

            resolve({
              hasUpdate: true,
              latestVersion,
              assetUrl: dmgAsset.browser_download_url,
              releaseName: release.name || latestVersion
            })
          } else {
            resolve(null)
          }
        } catch {
          resolve(null)
        }
      })
    })

    req.on('error', () => resolve(null))
    req.setTimeout(10000, () => { req.destroy(); resolve(null) })
  })
}

/** Download DMG, mount, copy .app over current installation, unmount, relaunch */
async function performUpdate(assetUrl: string, win: BrowserWindow): Promise<void> {
  const sendProgress = (stage: string, percent?: number, errorMessage?: string) => {
    try { win.webContents.send('update-progress', { stage, percent, errorMessage }) } catch { /* window closed */ }
  }

  const dmgPath = join(app.getPath('temp'), 'fb-messenger-update.dmg')

  try {
    // --- Download DMG ---
    sendProgress('downloading', 0)
    const { res } = await httpsGet(assetUrl)

    const totalBytes = parseInt(res.headers['content-length'] || '0', 10)
    let downloadedBytes = 0
    const file = createWriteStream(dmgPath)

    await new Promise<void>((resolve, reject) => {
      res.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        file.write(chunk)
        if (totalBytes > 0) {
          sendProgress('downloading', Math.round((downloadedBytes / totalBytes) * 100))
        }
      })
      res.on('end', () => { file.end(); resolve() })
      res.on('error', reject)
    })

    // --- Mount DMG ---
    sendProgress('installing')
    const mountOutput = execSync(
      `hdiutil attach "${dmgPath}" -nobrowse -noverify -noautoopen 2>&1`,
      { encoding: 'utf-8' }
    )

    // Parse mount point from hdiutil output (last column of last line)
    const mountLines = mountOutput.trim().split('\n')
    const lastLine = mountLines[mountLines.length - 1]
    const mountPoint = lastLine.split('\t').pop()?.trim()
    if (!mountPoint) throw new Error('Could not determine mount point')

    try {
      // Find the .app bundle inside the mounted volume
      const lsOutput = execSync(`ls "${mountPoint}"`, { encoding: 'utf-8' })
      const appName = lsOutput.trim().split('\n').find(f => f.endsWith('.app'))
      if (!appName) throw new Error('No .app found in DMG')

      const sourceApp = join(mountPoint, appName)

      // Determine current app path (go up from the executable to the .app bundle)
      // In production: /Applications/FB Missing Messenger.app/Contents/Resources/app.asar → go up 3 levels
      const appPath = app.getAppPath()
      let currentAppBundle: string

      if (appPath.includes('.app')) {
        currentAppBundle = appPath.substring(0, appPath.indexOf('.app') + 4)
      } else {
        throw new Error('Cannot determine current app bundle path')
      }

      // Copy new .app over current installation
      execSync(`rm -rf "${currentAppBundle}"`, { encoding: 'utf-8' })
      execSync(`cp -R "${sourceApp}" "${currentAppBundle}"`, { encoding: 'utf-8' })
    } finally {
      // Always unmount
      try { execSync(`hdiutil detach "${mountPoint}" -force 2>&1`) } catch { /* ok */ }
    }

    // Cleanup DMG
    try { unlinkSync(dmgPath) } catch { /* ok */ }

    // --- Relaunch ---
    sendProgress('restarting')
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 500)
  } catch (err: any) {
    // Cleanup on error
    try { unlinkSync(dmgPath) } catch { /* ok */ }
    sendProgress('error', undefined, err?.message || 'Unknown error')
    throw err
  }
}

function createWindow(): void {
  const iconPath = join(__dirname, '../../resources/icon.png')
  const icon = nativeImage.createFromPath(iconPath)
  
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    icon: icon,
    title: 'FB Missing Messenger',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webviewTag: true
    }
  })

  if (process.platform === 'darwin') {
      app.dock?.setIcon(icon)
  }

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })
  
  ipcMain.on('open-external-url', (_event, url: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
    }
  })

  let lastTotalUnreadCount = 0

  ipcMain.on('show-notification', (_event, { title, body }) => {
    const notification = new Notification({
      title,
      body,
      silent: false
    })
    notification.show()
    notification.on('click', () => {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    })

    if (!mainWindow.isFocused() && process.platform === 'darwin') {
      app.dock?.bounce('informational')
    }
  })

  ipcMain.on('unread-count', (_event, count: number) => {
    if (process.platform === 'darwin') {
      app.setBadgeCount(count)
    }
    lastTotalUnreadCount = count
  })

  ipcMain.handle('get-webview-preload-path', () => {
    return join(__dirname, '../preload/webview-preload.js')
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Performance optimization flags (keeping only safe ones that don't affect session storage)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256')
app.commandLine.appendSwitch('renderer-process-limit', '4')
app.commandLine.appendSwitch('disable-extensions')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.evame.fbmissingmessenger')
  app.setName('FB Missing Messenger')
  app.setAboutPanelOptions({
    applicationName: 'FB Missing Messenger',
    applicationVersion: app.getVersion(),
    credits: 'A native wrapper for Messenger and Marketplace with power features',
    copyright: '© 2026 Eugeny Perepelyatnikov peugeny@gmail.com'
  })

  // Update checker IPC handlers
  ipcMain.handle('check-for-updates', async () => {
    return await checkForUpdates()
  })

  ipcMain.on('dismiss-update-version', (_event, version: string) => {
    setDismissedVersion(version)
  })

  ipcMain.handle('perform-update', async (_event, assetUrl: string) => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('No window found')
    await performUpdate(assetUrl, win)
  })

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    if (permission === 'notifications') {
      callback(true)
      return
    }
    callback(false)
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  // Build app menu with "Check for Update" item
  const appMenu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Check for Update…',
          click: async () => {
            const info = await checkForUpdates(true)
            const win = BrowserWindow.getAllWindows()[0]
            if (info && win) {
              win.webContents.send('force-update-check', info)
            } else if (win) {
              dialog.showMessageBox(win, {
                type: 'info',
                title: 'No Updates',
                message: 'You are running the latest version.',
                buttons: ['OK']
              })
            }
          }
        },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' }
  ])
  Menu.setApplicationMenu(appMenu)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
