const { app, BrowserWindow, shell, ipcMain, protocol, Notification, Tray, Menu, nativeImage, dialog, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const os = require('os');

/* ==================== Paths ==================== */
const SMOKE = process.env.MOSHI_SMOKE === '1';
if (SMOKE) {
  app.setPath('userData', path.join(os.tmpdir(), 'moshi-smoke-' + Date.now()));
} else {
  app.setPath('userData', path.join(app.getPath('appData'), 'MoshiDiary'));
}
const DATA_DIR = path.join(app.getPath('userData'), 'data');
const IMG_DIR = path.join(DATA_DIR, 'images');
const BK_DIR = path.join(DATA_DIR, 'backups');
const STORE_FILE = path.join(DATA_DIR, 'store.json');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');
const NOTIFY_FILE = path.join(DATA_DIR, 'notified.json');

app.setAppUserModelId('com.moshi.diary');

/* ==================== Legacy localStorage carry-over ====================
   旧版本把数据存在 Chromium localStorage（leveldb）里。首次运行新版本时，
   把旧 profile 的 leveldb 拷进新 userData，让渲染进程能在页面加载时读到
   旧数据并迁移到文件存储。仅当新 store.json 尚不存在时执行一次。 */
function carryLegacyLocalStorage() {
  if (fs.existsSync(STORE_FILE)) return;
  const candidates = ['moshi-diary', 'Electron', '时光胶囊日记本'];
  for (const name of candidates) {
    const src = path.join(app.getPath('appData'), name, 'Local Storage', 'leveldb');
    if (fs.existsSync(path.join(src, 'CURRENT'))) {
      try {
        const dst = path.join(app.getPath('userData'), 'Local Storage', 'leveldb');
        fs.mkdirSync(dst, { recursive: true });
        fs.cpSync(src, dst, { recursive: true, force: true });
      } catch (e) { /* ignore — 旧数据缺失时直接空白启动 */ }
      return;
    }
  }
}
carryLegacyLocalStorage();

/* ==================== Single instance ==================== */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}
app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

/* ==================== moshiimg:// protocol ==================== */
protocol.registerSchemesAsPrivileged([
  { scheme: 'moshiimg', privileges: { standard: true, secure: false, supportFetchAPI: true, stream: true } }
]);

/* ==================== Small fs helpers ==================== */
function ensureDirs() {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(BK_DIR, { recursive: true });
}
function atomicWrite(file, buf) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
}
function localDateStr(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ==================== Crypto (密码锁) ==================== */
const PBKDF2_ITER = 150000;
let lockKey = null; // Buffer，解锁后驻留内存

function makeKey(pass, salt) {
  return crypto.pbkdf2Sync(String(pass), salt, PBKDF2_ITER, 32, 'sha256');
}
function encryptWithKey(obj, key, saltHex) {
  const salt = saltHex || crypto.randomBytes(16).toString('hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const pt = Buffer.from(JSON.stringify(obj), 'utf8');
  const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
  return {
    enc: 1,
    kdf: `pbkdf2-sha256-${PBKDF2_ITER}`,
    salt,
    iv: iv.toString('hex'),
    tag: cipher.getAuthTag().toString('hex'),
    data: ct.toString('base64')
  };
}
function decryptEnvelope(env, key) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(env.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(env.tag, 'hex'));
  const pt = Buffer.concat([decipher.update(Buffer.from(env.data, 'base64')), decipher.final()]);
  return JSON.parse(pt.toString('utf8'));
}

/* ==================== Store (文件存储 + 备份轮转) ==================== */
let lastObj = null;          // 最近一次保存的数据（退出时兜底回写）
let didStartupBackup = false;

function readStoreFile() {
  try {
    const raw = fs.readFileSync(STORE_FILE, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}
function storeToBuffer(obj) {
  if (lockKey) return Buffer.from(JSON.stringify(encryptWithKey(obj, lockKey)), 'utf8');
  return Buffer.from(JSON.stringify({ enc: 0, data: obj }), 'utf8');
}
function writeStore(obj) {
  atomicWrite(STORE_FILE, storeToBuffer(obj));
  lastObj = obj;
}
function backupNow() {
  try {
    if (!fs.existsSync(STORE_FILE)) return false;
    ensureDirs();
    const stamp = localDateStr(new Date()).replace(/-/g, '') + '_' +
      new Date().toTimeString().slice(0, 8).replace(/:/g, '');
    fs.copyFileSync(STORE_FILE, path.join(BK_DIR, `store_${stamp}.json`));
    const files = fs.readdirSync(BK_DIR).filter(f => /^store_\d{8}_\d{6}\.json$/.test(f)).sort();
    while (files.length > 5) fs.unlinkSync(path.join(BK_DIR, files.shift()));
    return true;
  } catch (e) {
    return false;
  }
}

ipcMain.handle('store:load', () => {
  ensureDirs();
  const env = readStoreFile();
  if (!env) return { locked: false, data: null };
  if (env.enc === 1) return { locked: true };
  didStartupBackup = didStartupBackup || backupNow();
  return { locked: false, data: env.data !== undefined ? env.data : env };
});

ipcMain.handle('store:save', (e, json) => {
  try {
    const obj = JSON.parse(json);
    didStartupBackup = didStartupBackup || backupNow();
    writeStore(obj);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('store:unlock', (e, pass) => {
  try {
    const env = readStoreFile();
    if (!env || env.enc !== 1) return { ok: false, error: '未加密' };
    const key = makeKey(pass, Buffer.from(env.salt, 'hex'));
    const data = decryptEnvelope(env, key);
    lockKey = key;
    lastObj = data;
    didStartupBackup = didStartupBackup || backupNow();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: '密码错误' };
  }
});

ipcMain.handle('store:set-lock', (e, json, pass) => {
  try {
    const obj = JSON.parse(json);
    if (pass) {
      if (String(pass).length < 4) return { ok: false, error: '密码至少 4 位' };
      const salt = crypto.randomBytes(16);
      lockKey = makeKey(pass, salt);
      const env = encryptWithKey(obj, lockKey, salt.toString('hex'));
      atomicWrite(STORE_FILE, Buffer.from(JSON.stringify(env), 'utf8'));
    } else {
      lockKey = null;
      atomicWrite(STORE_FILE, Buffer.from(JSON.stringify({ enc: 0, data: obj }), 'utf8'));
    }
    lastObj = obj;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('store:lock-status', () => {
  const env = readStoreFile();
  return { encrypted: !!(env && env.enc === 1) };
});

/* ==================== Images ==================== */
const IMG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

const IMG_ROOT = path.resolve(IMG_DIR);
// 文件名白名单 + 目录边界双重校验，杜绝路径穿越
function imgPath(name) {
  if (typeof name !== 'string' || !/^[\w.-]+$/.test(name) || name.includes('..')) return null;
  const target = path.resolve(IMG_ROOT, name);
  if (!target.startsWith(IMG_ROOT + path.sep)) return null;
  return target;
}

ipcMain.handle('img:save', (e, bytes, ext) => {
  try {
    ensureDirs();
    const cleanExt = IMG_MIME[String(ext || 'jpg').toLowerCase()] ? String(ext).toLowerCase() : 'jpg';
    const name = `img_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}.${cleanExt}`;
    const target = imgPath(name);
    if (!target) return null;
    fs.writeFileSync(target, Buffer.from(bytes));
    return 'moshiimg://' + name;
  } catch (err) {
    return null;
  }
});

ipcMain.handle('img:delete', (e, url) => {
  try {
    const name = String(url || '').replace('moshiimg://', '');
    const target = imgPath(name);
    if (!target) return false;
    if (fs.existsSync(target)) fs.unlinkSync(target);
    return true;
  } catch (err) {
    return false;
  }
});

/* ==================== Export / Import ==================== */
/* 导出时把 moshiimg:// 图片内联为 data URL，让导出档案跨设备/跨平台（含 Android）可迁移 */
async function inlineImages(json) {
  try {
    const obj = JSON.parse(json);
    const urls = new Set();
    for (const d of (obj.diaries || [])) {
      for (const u of (d.images || [])) {
        if (typeof u === 'string' && u.startsWith('moshiimg://')) urls.add(u);
      }
    }
    if (!urls.size) return json;
    const map = {};
    for (const u of urls) {
      const target = imgPath(u.replace('moshiimg://', ''));
      if (!target || !fs.existsSync(target)) continue;
      const ext = path.extname(target).slice(1).toLowerCase();
      map[u] = `data:${IMG_MIME[ext] || 'application/octet-stream'};base64,` + fs.readFileSync(target).toString('base64');
    }
    let s = json;
    for (const [u, du] of Object.entries(map)) s = s.split(u).join(du);
    return s;
  } catch (e) {
    return json;
  }
}

ipcMain.handle('data:export', async (e, json) => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const def = path.join(app.getPath('documents'), `moshi_archive_${localDateStr(new Date())}.json`);
    const r = await dialog.showSaveDialog(win, {
      title: '导出数据',
      defaultPath: def,
      filters: [{ name: 'JSON 数据', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return { ok: false, canceled: true };
    const out = await inlineImages(json);
    fs.writeFileSync(r.filePath, out, 'utf8');
    return { ok: true, path: r.filePath };
  } catch (err) {
    return { ok: false, error: String(err.message || err) };
  }
});

ipcMain.handle('data:import', async () => {
  try {
    const win = BrowserWindow.getAllWindows()[0];
    const r = await dialog.showOpenDialog(win, {
      title: '导入数据（当前数据会先自动备份）',
      filters: [{ name: 'JSON 数据', extensions: ['json'] }],
      properties: ['openFile']
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true };
    const raw = fs.readFileSync(r.filePaths[0], 'utf8');
    const data = JSON.parse(raw);
    if (!Array.isArray(data.diaries) || !Array.isArray(data.capsules)) {
      return { ok: false, error: '文件格式不正确：缺少 diaries/capsules' };
    }
    backupNow();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: '导入失败：' + String(err.message || err) };
  }
});

ipcMain.handle('data:open-folder', async () => {
  ensureDirs();
  await shell.openPath(DATA_DIR);
  return true;
});

/* ==================== Capsule reminders ==================== */
let capsuleList = [];
let notifiedMap = {};
try { notifiedMap = JSON.parse(fs.readFileSync(NOTIFY_FILE, 'utf8')) || {}; } catch (e) { notifiedMap = {}; }
function saveNotified() {
  try { ensureDirs(); atomicWrite(NOTIFY_FILE, Buffer.from(JSON.stringify(notifiedMap), 'utf8')); } catch (e) { /* ignore */ }
}

ipcMain.handle('capsules:schedule', (e, list) => {
  capsuleList = Array.isArray(list) ? list : [];
  checkCapsules();
  return true;
});

function checkCapsules() {
  const now = Date.now();
  const today = localDateStr(new Date());
  for (const c of capsuleList) {
    if (!c || c.status !== 'sealed' || typeof c.openDate !== 'number') continue;
    if (c.openDate > now) continue;
    if (notifiedMap[c.id] === today) continue;
    notifiedMap[c.id] = today;
    saveNotified();
    const title = `时间胶囊 · ${c.title || '未命名之信'}`;
    const body = '有一枚胶囊可以开启了，去看看它吧。';
    if (Notification.isSupported()) {
      const n = new Notification({ title, body, icon: appIcon(32), silent: false });
      n.on('click', () => focusWindow('capsule'));
      n.show();
    } else {
      sendToRenderer('capsule:notice', { title, body });
    }
  }
}

function sendToRenderer(channel, payload) {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) win.webContents.send(channel, payload);
}
function focusWindow(page) {
  let win = BrowserWindow.getAllWindows()[0];
  if (!win) { createWindow(); win = BrowserWindow.getAllWindows()[0]; }
  else { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  if (page) sendToRenderer('capsule:navigate', page);
}

/* ==================== Window ==================== */
function appIcon(size) {
  const p = size === 32 ? path.join(__dirname, 'app', 'icon32.png') : path.join(__dirname, 'app', 'icon.png');
  const img = nativeImage.createFromPath(p);
  return img.isEmpty() ? undefined : img;
}

function loadWindowState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return null; }
}
function saveWindowState(win) {
  try {
    const st = {
      maximized: win.isMaximized(),
      bounds: win.isMaximized() ? win.getNormalBounds() : win.getBounds()
    };
    atomicWrite(STATE_FILE, Buffer.from(JSON.stringify(st), 'utf8'));
  } catch (e) { /* ignore */ }
}

function createWindow() {
  const saved = loadWindowState();
  const opts = {
    width: 420,
    height: 800,
    minWidth: 360,
    minHeight: 640,
    title: '墨室 · 时光档案',
    autoHideMenuBar: true,
    backgroundColor: '#f6f1e6',
    icon: appIcon(256),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js')
    }
  };
  if (saved && saved.bounds) {
    Object.assign(opts, saved.bounds);
    try {
      const wa = screen.getDisplayMatching(saved.bounds).workArea;
      const fits = saved.bounds.x >= wa.x - 20 && saved.bounds.y >= wa.y - 20 &&
        saved.bounds.x + saved.bounds.width <= wa.x + wa.width + 20 &&
        saved.bounds.y + saved.bounds.height <= wa.y + wa.height + 20;
      if (!fits) { delete opts.x; delete opts.y; }
    } catch (e) { delete opts.x; delete opts.y; }
  }

  const win = new BrowserWindow(opts);
  if (saved && saved.maximized) win.maximize();

  win.loadFile(path.join(__dirname, 'app', 'index.html'));

  win.on('close', () => saveWindowState(win));

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

/* ==================== Tray ==================== */
function createTray() {
  try {
    const icon = appIcon(32);
    if (!icon) return;
    const tray = new Tray(icon);
    tray.setToolTip('墨室 · 时光档案');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开时光胶囊日记本', click: () => focusWindow() },
      { label: '打开数据文件夹', click: () => { ensureDirs(); shell.openPath(DATA_DIR); } },
      { type: 'separator' },
      { label: '退出', click: () => app.quit() }
    ]));
    tray.on('click', () => focusWindow());
  } catch (e) { /* 托盘失败不影响主功能 */ }
}

/* ==================== Smoke test ==================== */
const SMOKE_JS = [
  '(async () => {',
  '  const R = {};',
  '  try {',
  '    R.bridge = !!window.moshi;',
  '    const first = await window.moshi.load();',
  '    R.firstLocked = first.locked;',
  '    const data = { version:1, diaries:[{ id:"d1", date:"2026-09-06", title:"冒烟测试", content:"正文", mood:"calm", images:[], createdAt:1, updatedAt:1 }], capsules:[], achievements:[], streak:{ current:1, longest:1, lastDate:"2026-09-06", freezesLeft:1, freezeMonth:"2026-09", milestoneShown:[] }, settings:{ theme:"light", font:"serif" }, meta:{ createdAt:1 } };',
  '    await window.moshi.save(JSON.stringify(data));',
  '    const second = await window.moshi.load();',
  '    R.persisted = !!(second.data && second.data.diaries.length === 1 && second.data.diaries[0].title === "冒烟测试");',
  '    const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));',
  '    const url = await window.moshi.saveImage(bytes, "png");',
  '    R.imgUrl = !!url && url.indexOf("moshiimg://") === 0;',
  '    R.protocol = await new Promise(res => { const im = new Image(); im.onload = () => res(true); im.onerror = () => res(false); im.src = url; });',
  '    R.imgDelete = await window.moshi.deleteImage(url);',
  '    await window.moshi.setLock(JSON.stringify(data), "test123");',
  '    const locked = await window.moshi.load();',
  '    R.lockedAfterSet = locked.locked === true;',
  '    const bad = await window.moshi.unlock("wrong");',
  '    R.wrongPassRejected = bad.ok === false;',
  '    const good = await window.moshi.unlock("test123");',
  '    R.unlockOk = good.ok === true && good.data.diaries.length === 1;',
  '    await window.moshi.setLock(JSON.stringify(good.data), null);',
  '    const plain = await window.moshi.load();',
  '    R.lockRemoved = plain.locked === false && plain.data.diaries.length === 1;',
  '  } catch (err) { R.error = String(err && err.message || err); }',
  '  R.ok = R.bridge && R.persisted && R.imgUrl && R.protocol && R.imgDelete && R.lockedAfterSet && R.wrongPassRejected && R.unlockOk && R.lockRemoved && !R.error;',
  '  return JSON.stringify(R);',
  '})()'
].join('\n');

function runSmokeTest(win) {
  win.webContents.on('did-finish-load', async () => {
    try {
      const r = await win.webContents.executeJavaScript(SMOKE_JS, true);
      console.log('SMOKE_RESULT ' + r);
    } catch (e) {
      console.log('SMOKE_ERROR ' + (e && e.message || e));
    }
    setTimeout(() => app.exit(0), 300);
  });
}

/* ==================== Lifecycle ==================== */
app.whenReady().then(() => {
  ensureDirs();
  protocol.handle('moshiimg', (request) => {
    try {
      const u = new URL(request.url);
      const name = path.basename(decodeURIComponent(u.host + u.pathname));
      const target = imgPath(name);
      if (!target) return new Response('bad request', { status: 400 });
      if (!fs.existsSync(target)) return new Response('not found', { status: 404 });
      const ext = path.extname(name).slice(1).toLowerCase();
      return new Response(fs.readFileSync(target), { headers: { 'content-type': IMG_MIME[ext] || 'application/octet-stream' } });
    } catch (e) {
      return new Response('error', { status: 500 });
    }
  });

  const win = createWindow();
  createTray();
  setInterval(checkCapsules, 60 * 1000);
  if (SMOKE) runSmokeTest(win);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

/* 退出前兜底：把最近一次数据同步写盘（防丢尾部修改） */
app.on('before-quit', () => {
  try {
    if (lastObj) atomicWrite(STORE_FILE, storeToBuffer(lastObj));
  } catch (e) { /* ignore */ }
});

/* 留 200ms 余量让页面 pagehide 里的最后一次 save IPC 落地 */
app.on('window-all-closed', () => {
  setTimeout(() => app.quit(), 200);
});
