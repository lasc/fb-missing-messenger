const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('node:path')

const projectRoot = path.resolve(__dirname, '../..')

ipcMain.handle('get-webview-preload-path', () => '')
ipcMain.handle('get-settings', () => ({}))
ipcMain.handle('get-app-version', () => 'test')
ipcMain.handle('get-cache-size', () => 0)
ipcMain.handle('check-for-updates', () => null)

app.whenReady().then(async () => {
    const window = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        titleBarStyle: 'hiddenInset',
        webPreferences: {
            preload: path.join(projectRoot, 'out/preload/index.js'),
            sandbox: false,
            contextIsolation: true,
            webviewTag: true
        }
    })

    await window.loadFile(path.join(projectRoot, 'out/renderer/index.html'))

    const result = await window.webContents.executeJavaScript(`
        new Promise((resolve, reject) => {
            const deadline = Date.now() + 5000;
            const inspect = () => {
                const sidebar = document.querySelector('.sidebar');
                const topDragRegion = document.querySelector('.window-drag-region');
                const navigationButton = document.querySelector('.nav-btn');

                if (!sidebar || !navigationButton) {
                    if (Date.now() < deadline) return requestAnimationFrame(inspect);
                    reject(new Error('App shell did not render'));
                    return;
                }

                const describe = element => {
                    if (!element) return null;
                    const style = getComputedStyle(element);
                    const rect = element.getBoundingClientRect();
                    return {
                        appRegion: style.getPropertyValue('-webkit-app-region').trim(),
                        top: rect.top,
                        left: rect.left,
                        right: rect.right,
                        height: rect.height
                    };
                };

                resolve({
                    viewportWidth: innerWidth,
                    sidebar: describe(sidebar),
                    topDragRegion: describe(topDragRegion),
                    navigationButton: describe(navigationButton)
                });
            };
            inspect();
        })
    `)

    process.stdout.write(`DRAG_REGION_RESULT:${JSON.stringify(result)}\n`)
    window.destroy()
    app.quit()
}).catch(error => {
    process.stderr.write(`${error.stack || error}\n`)
    app.exit(1)
})
