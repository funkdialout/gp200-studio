'use strict';
// Desktop shell for GP200 Studio. Serves the built web app (./dist) from a
// private app:// origin so Web MIDI (SysEx), audio input and localStorage all
// behave as they do in Chrome, with a stable origin across launches.
const { app, BrowserWindow, protocol, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const SCHEME = 'app';
const ORIGIN = `${SCHEME}://gp200`;
const START_URL = `${ORIGIN}/editor`;
const DIST = path.join(__dirname, 'dist');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// Must run before app 'ready'. standard + secure = a real secure context,
// which Web MIDI, getUserMedia and AudioWorklet all require.
protocol.registerSchemesAsPrivileged([
  {
    scheme: SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true },
  },
]);

/** Map a URL path to a file inside dist, mirroring the hosted site's routing. */
function resolveFile(urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const base = path.normalize(path.join(DIST, rel));
  if (base !== DIST && !base.startsWith(DIST + path.sep)) return null; // traversal guard
  for (const candidate of [base, path.join(base, 'index.html'), `${base}.html`]) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // try the next shape
    }
  }
  return null;
}

function serve(request) {
  const { pathname } = new URL(request.url);
  const file = resolveFile(pathname);
  if (!file) {
    const notFound = path.join(DIST, '404.html');
    const body = fs.existsSync(notFound) ? fs.readFileSync(notFound) : 'Not found';
    return new Response(body, { status: 404, headers: { 'content-type': MIME['.html'] } });
  }
  const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
  return new Response(fs.readFileSync(file), { headers: { 'content-type': type } });
}

const isOurs = (url) => typeof url === 'string' && url.startsWith(ORIGIN);

function openExternal(url) {
  if (/^(https?|mailto):/i.test(url)) void shell.openExternal(url);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 1024,
    minHeight: 680,
    title: 'GP200 Studio',
    backgroundColor: '#141517',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Keep the looper and drum machine on time when the window is behind others.
      backgroundThrottling: false,
    },
  });

  // Same-origin popups (e.g. the guide) stay in the app; everything else goes to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOurs(url)) return { action: 'allow' };
    openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isOurs(url)) return;
    event.preventDefault();
    openExternal(url);
  });

  void win.loadURL(START_URL);
  return win;
}

// One instance only: a second launch focuses the window instead of opening
// another copy that would fight over the GP-200's MIDI port.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    protocol.handle(SCHEME, serve);

    // Only our own bundled pages ever load in the window, so grant them what a
    // user would click "Allow" for in Chrome: MIDI + SysEx, audio input, etc.
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, _permission, callback, details) => {
      callback(isOurs(details.requestingUrl || wc.getURL()));
    });
    ses.setPermissionCheckHandler((_wc, _permission, requestingOrigin) => isOurs(requestingOrigin));

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  // Quit on every platform so the MIDI port is always released.
  app.on('window-all-closed', () => app.quit());
}
