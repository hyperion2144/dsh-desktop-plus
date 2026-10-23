/** Electron splash window: buffered stage pushes, no injection into a blank page. */

import { BrowserWindow } from 'electron'

import type { SplashController, StartupStageUpdate } from './orchestrator.ts'

export interface CreateSplashOptions {
	/** Window width in CSS pixels. */
	width?: number
	/** Window height in CSS pixels. */
	height?: number
}

/**
 * Creates the frameless splash window and returns its controller. Stage pushes
 * made before `did-finish-load` are buffered and replayed on ready, so the
 * page only ever receives updates it can render.
 */
export function createSplashWindow(options: CreateSplashOptions = {}): SplashController {
	const width = options.width ?? 420
	const height = options.height ?? 240
	const splash = new BrowserWindow({
		width,
		height,
		frame: false,
		resizable: false,
		show: false,
		alwaysOnTop: true,
		title: 'DeepSeek Harness Plus',
	})
	void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(SPLASH_HTML)}`)

	let ready = false
	let disposed = false
	const buffered: StartupStageUpdate[] = []

	const render = (update: StartupStageUpdate): void => {
		void splash.webContents
			.executeJavaScript(`window.__plusSetStage(${JSON.stringify(update)})`, true)
			.catch(() => { /* a closing splash drops pushes; the sequence state stays authoritative */ })
	}

	splash.webContents.once('did-finish-load', () => {
		ready = true
		for (const update of buffered) render(update)
		buffered.length = 0
		splash.show()
	})

	return {
		setStage(update: StartupStageUpdate): void {
			if (disposed) return
			if (!ready) {
				buffered.push(update)
				return
			}
			render(update)
		},
		markReady(): void {
			// The window flushes itself on did-finish-load; kept for the controller contract.
		},
		dispose(): void {
			if (disposed) return
			disposed = true
			if (!splash.isDestroyed()) splash.destroy()
		},
	}
}

const SPLASH_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; height: 100vh; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px;
    font-family: -apple-system, "Segoe UI", sans-serif; user-select: none;
  }
  h1 { font-size: 17px; font-weight: 600; margin: 0; }
  #stage { font-size: 13px; opacity: .72; }
  #reason { font-size: 12px; color: #c0392b; max-width: 90%; text-align: center; }
  .bar { width: 180px; height: 4px; border-radius: 2px; background: color-mix(in srgb, currentColor 15%, transparent); overflow: hidden; }
  .bar > i { display: block; height: 100%; width: 40%; border-radius: 2px; background: currentColor; opacity: .6; animation: slide 1.1s ease-in-out infinite; }
  @keyframes slide { 0% { transform: translateX(-100%); } 100% { transform: translateX(450%); } }
  body.failed .bar { display: none; }
</style>
</head>
<body>
  <h1>DeepSeek Harness Plus</h1>
  <div class="bar"><i></i></div>
  <div id="stage">Starting…</div>
  <div id="reason"></div>
  <script>
    window.__plusSetStage = (u) => {
      const labels = { tray: 'Tray', splash: 'Splash', host: 'DSH host', window: 'Window' };
      document.getElementById('stage').textContent = (labels[u.stage] ?? u.stage) + (u.detail && !u.failed ? ' · ' + u.detail : '');
      const reason = document.getElementById('reason');
      reason.textContent = u.failed ? (u.detail ?? 'Something went wrong') : '';
      document.body.classList.toggle('failed', Boolean(u.failed));
    };
  </script>
</body>
</html>`
