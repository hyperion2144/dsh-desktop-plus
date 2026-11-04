// DSH Desktop Plus —— 鸿蒙 Electron 骨架应用的主进程。
//
// 这一份是“能开窗、能报运行时版本”的最小应用：真实的 DSH 主进程产物还没接进来
// （那要先有 ohos 侧的 app 打包管线）。骨架存在的意义是让 HAP 真的能跑起来，
// 从而在没有真实产物时也能验证「模板 + 覆盖层 + 签名」这条链路。
//
// 鸿蒙特有能力（窗口类型 / 权限 / 托盘）按需再加，别在这里猜 API。
const { app, BrowserWindow } = require('electron')
const path = require('node:path')

const WINDOW = { width: 1180, height: 760 }

function runtimeBanner() {
  const versions = process.versions
  return {
    platform: process.platform,
    electron: versions.electron,
    node: versions.node,
    chrome: versions.chrome,
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: WINDOW.width,
    height: WINDOW.height,
    title: 'DSH Desktop Plus',
    backgroundColor: '#0b0d12',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.loadFile(path.join(__dirname, 'index.html'))
  return win
}

console.log('[dsh] runtime ' + JSON.stringify(runtimeBanner()))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
