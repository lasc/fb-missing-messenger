import { app, shell, BrowserWindow, ipcMain, nativeImage, session, Notification, Menu, dialog, net } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, createWriteStream, unlinkSync, statSync, existsSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
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

/** Fetch URL using Electron's net module (uses Chromium's network stack + system certs) */
function electronFetch(url: string, headers: Record<string, string> = {}): Promise<Electron.IncomingMessage> {
  return new Promise((resolve, reject) => {
    const request = net.request({
      url,
      redirect: 'follow'
    })
    request.setHeader('User-Agent', 'FB-Missing-Messenger-UpdateChecker')
    for (const [key, value] of Object.entries(headers)) {
      request.setHeader(key, value)
    }
    request.on('response', (response) => {
      resolve(response)
    })
    request.on('error', reject)
    request.end()
  })
}

async function checkForUpdates(ignoreDismissed = false): Promise<UpdateInfo | null> {
  try {
    const response = await electronFetch('https://api.github.com/repos/lasc/fb-missing-messenger/releases/latest')

    const body = await new Promise<string>((resolve, reject) => {
      let data = ''
      response.on('data', (chunk: Buffer) => { data += chunk.toString() })
      response.on('end', () => resolve(data))
      response.on('error', reject)
    })

    const release = JSON.parse(body)
    const latestVersion = release.tag_name
    const currentVersion = app.getVersion()

    if (compareSemver(currentVersion, latestVersion) < 0) {
      if (!ignoreDismissed) {
        const dismissed = getDismissedVersion()
        if (dismissed === latestVersion) {
          return null
        }
      }

      // Find the DMG asset
      const dmgAsset = release.assets?.find((a: any) =>
        a.name.endsWith('.dmg')
      )
      if (!dmgAsset) return null

      return {
        hasUpdate: true,
        latestVersion,
        assetUrl: dmgAsset.browser_download_url,
        releaseName: release.name || latestVersion
      }
    }
    return null
  } catch {
    return null
  }
}

/** Download DMG, mount, copy .app over current installation, unmount, relaunch */
async function performUpdate(assetUrl: string, win: BrowserWindow): Promise<void> {
  const sendProgress = (stage: string, percent?: number, errorMessage?: string) => {
    try { win.webContents.send('update-progress', { stage, percent, errorMessage }) } catch { /* window closed */ }
  }

  const dmgPath = join(app.getPath('temp'), 'fb-messenger-update.dmg')

  try {
    // Clean up any leftover DMG from a previous failed attempt
    try { unlinkSync(dmgPath) } catch { /* ok */ }

    // --- Download DMG ---
    sendProgress('downloading', 0)
    const response = await electronFetch(assetUrl)

    if (response.statusCode && response.statusCode >= 400) {
      throw new Error(`Download failed with HTTP ${response.statusCode}`)
    }

    const totalBytes = parseInt(String(response.headers['content-length'] || '0'), 10)
    let downloadedBytes = 0
    const file = createWriteStream(dmgPath)

    await new Promise<void>((resolve, reject) => {
      response.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length
        file.write(chunk)
        if (totalBytes > 0) {
          sendProgress('downloading', Math.round((downloadedBytes / totalBytes) * 100))
        }
      })
      response.on('error', (err: Error) => { file.destroy(); reject(err) })
      response.on('end', () => { file.end(); })
      file.on('error', (err: Error) => { reject(err) })
      file.on('close', () => resolve())
    })

    // Validate the downloaded file before mounting
    const fileSize = statSync(dmgPath).size
    if (fileSize < 1024) {
      throw new Error(`Downloaded DMG is too small (${fileSize} bytes) — download may have failed`)
    }

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
      // Strip quarantine and re-sign so macOS Gatekeeper doesn't block the updated app
      try { execSync(`xattr -cr "${currentAppBundle}"`, { encoding: 'utf-8' }) } catch { /* ok */ }
      try { execSync(`codesign --force --deep --sign - "${currentAppBundle}"`, { encoding: 'utf-8' }) } catch { /* ok */ }
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
    },
    backgroundColor: '#18191A'
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

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Performance optimization flags
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=256')
app.commandLine.appendSwitch('renderer-process-limit', '4')
app.commandLine.appendSwitch('disable-extensions')
// GPU & rendering acceleration
app.commandLine.appendSwitch('enable-gpu-rasterization')
app.commandLine.appendSwitch('enable-zero-copy')
app.commandLine.appendSwitch('enable-hardware-overlays', 'single-fullscreen,single-on-top,underlay')
app.commandLine.appendSwitch('enable-features', 'VaapiVideoDecoder,VaapiVideoEncoder,CanvasOopRasterization')
// Network performance
app.commandLine.appendSwitch('enable-quic')
app.commandLine.appendSwitch('enable-tcp-fastopen')

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.evame.fbmissingmessenger')
  app.setName('FB Missing Messenger')

  // Configure persistent session cache for webviews
  // This keeps cookies, DOM storage, and HTTP cache across restarts
  const webviewSession = session.fromPartition('persist:webview')
  webviewSession.setPreloads([])
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

  // App IPC handlers (registered once, use dynamic window lookup)
  ipcMain.on('open-external-url', (_event, url: string) => {
    if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
      shell.openExternal(url)
    }
  })

  ipcMain.on('show-notification', async (_event, { title, body, icon }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const settings = loadSettings()

    console.log('[NOTIF-MAIN] 🔔 Received show-notification:', { title, body, hasIcon: !!icon })

    // Check if notifications are enabled in settings
    if (settings.notifications === false) {
      console.log('[NOTIF-MAIN] ⏭️ Notifications disabled in settings, skipping')
      return
    }

    // Build notification options with native macOS toast support
    const notifOptions: Electron.NotificationConstructorOptions = {
      title,
      body,
      silent: settings.notificationSound === false,
      // Use the app icon for the notification
      icon: nativeImage.createFromPath(join(__dirname, '../../resources/icon.png')),
      // macOS-specific: sound name for native toast
      sound: settings.notificationSound === false ? undefined : 'default',
      // Ensure it shows as a toast banner on macOS
      urgency: 'normal' as any
    }

    // If we have a sender icon URL, try to fetch it for the notification
    if (icon && typeof icon === 'string' && icon.startsWith('http')) {
      try {
        const iconResponse = await electronFetch(icon)
        const chunks: Buffer[] = []
        await new Promise<void>((resolve, reject) => {
          iconResponse.on('data', (chunk: Buffer) => chunks.push(chunk))
          iconResponse.on('end', () => resolve())
          iconResponse.on('error', reject)
        })
        const iconBuffer = Buffer.concat(chunks)
        const senderIcon = nativeImage.createFromBuffer(iconBuffer)
        if (!senderIcon.isEmpty()) {
          notifOptions.icon = senderIcon
          console.log('[NOTIF-MAIN] 📷 Using sender profile picture for notification')
        }
      } catch (e) {
        console.log('[NOTIF-MAIN] ⚠️ Failed to fetch sender icon, using app icon')
      }
    }

    const notification = new Notification(notifOptions)
    notification.show()
    console.log('[NOTIF-MAIN] ✅ Native toast notification shown')

    notification.on('click', () => {
      console.log('[NOTIF-MAIN] 👆 Notification clicked — focusing window')
      if (win) {
        if (win.isMinimized()) win.restore()
        win.focus()
        // Switch to messenger tab when clicking notification
        win.webContents.send('notification-clicked')
      }
    })

    if (win && !win.isFocused() && process.platform === 'darwin' && settings.dockBounce !== false) {
      app.dock?.bounce('informational')
    }
  })

  ipcMain.on('unread-count', (_event, count: number) => {
    if (process.platform === 'darwin') {
      // Check settings before updating badge
      const settings = loadSettings()
      if (settings.badgeCount !== false) {
        app.setBadgeCount(count)
      }
    }
  })

  // --- Settings persistence ---
  const settingsPath = join(app.getPath('userData'), 'app-settings.json')

  function loadSettings(): Record<string, any> {
    try {
      if (existsSync(settingsPath)) {
        return JSON.parse(readFileSync(settingsPath, 'utf-8'))
      }
    } catch {
      console.log('[SETTINGS] Failed to load settings, using defaults')
    }
    return {}
  }

  function saveSettings(settings: Record<string, any>): void {
    try {
      writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8')
      console.log('[SETTINGS] Settings saved:', settings)
    } catch (e) {
      console.error('[SETTINGS] Failed to save settings:', e)
    }
  }

  ipcMain.handle('get-settings', () => {
    return loadSettings()
  })

  ipcMain.handle('save-settings', (_event, settings: Record<string, any>) => {
    saveSettings(settings)
    return true
  })

  ipcMain.handle('get-app-version', () => {
    return app.getVersion()
  })

  ipcMain.handle('get-webview-preload-path', () => {
    return join(__dirname, '../preload/webview-preload.js')
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
