/* ================================================================
   墨室 · 时光档案 — Android 桥（Capacitor）
   在 window.Capacitor 环境下，用文件存储 + Web Crypto 实现与桌面版
   Electron 桥完全同构的 window.moshi 接口；桌面端加载本文件时自动空转。
   存储格式与桌面版互通：{enc:0,data} 明文 / {enc:1,kdf,salt,iv,tag,data}
   为 pbkdf2-sha256-150000 + AES-256-GCM 信封，两端可互相解密。
   ================================================================ */
(function () {
'use strict';
if (!window.Capacitor || window.moshi) return;

var C = window.Capacitor;
var P = (C.Plugins && typeof C.Plugins === 'object') ? C.Plugins : {};
var FS = P.Filesystem;
var LN = P.LocalNotifications;
var App = P.App;
var Share = P.Share;
if (!FS) return;   // 非 Capacitor 容器（普通浏览器）→ 走页面自带 localStorage 回退

var DIR = 'DATA';
var STORE = 'store.json';
var IMG_DIR = 'images';
var BK_DIR = 'backups';
var NOTIFY_FILE = 'notified.json';
var PBKDF2_ITER = 150000;

/* ==================== 小工具 ==================== */
function pad(n) { return String(n).padStart(2, '0'); }
function localDateStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function fsErr(e) { return String((e && e.message) || e || ''); }

function bytesToBase64(bytes) {
  var s = '', chunk = 0x8000;
  for (var i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}
function base64ToBytes(b64) {
  var bin = atob(b64), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bufToHex(buf) {
  var u = new Uint8Array(buf), s = '';
  for (var i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, '0');
  return s;
}
function hexToBytes(hex) {
  var out = new Uint8Array(hex.length / 2);
  for (var i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}
function randomBytes(n) {
  var u = new Uint8Array(n);
  crypto.getRandomValues(u);
  return u;
}
function hashStr(s) {
  var h = 0;
  s = String(s);
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) || 1;
}

/* 平台级轻提示（复用页面 toast DOM，不干扰页面逻辑） */
function platformToast(msg, type) {
  try {
    var box = document.getElementById('toast-container');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () {
      el.style.opacity = '0';
      el.style.transition = 'opacity .3s';
      setTimeout(function () { el.remove(); }, 300);
    }, 2600);
  } catch (e) { /* ignore */ }
}

/* ==================== 文件系统封装 ==================== */
function fReadText(path) {
  return FS.readFile({ path: path, directory: DIR, encoding: 'utf8' }).then(function (r) { return r.data; });
}
function fReadB64(path) {
  return FS.readFile({ path: path, directory: DIR }).then(function (r) { return r.data; });
}
function fWriteText(path, text) {
  return FS.writeFile({ path: path, directory: DIR, data: text, encoding: 'utf8', recursive: true });
}
/* 近似原子写：先写 .tmp 再 rename 覆盖 */
function fWriteTextAtomic(path, text) {
  var tmp = path + '.tmp';
  return fWriteText(tmp, text)
    .then(function () { return FS.deleteFile({ path: path, directory: DIR }); })
    .catch(function () { /* 目标不存在 */ })
    .then(function () { return FS.rename({ from: tmp, to: path, directory: DIR, toDirectory: DIR }); })
    .catch(function () { return fWriteText(path, text); });
}

/* ==================== 密码锁（Web Crypto，与桌面版信封互通） ==================== */
var lockKey = null;         // CryptoKey，解锁后驻留内存
var lastObj = null;
var didStartupBackup = false;

function deriveKey(pass, saltBytes) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(String(pass)), 'PBKDF2', false, ['deriveKey'])
    .then(function (km) {
      return crypto.subtle.deriveKey(
        { name: 'PBKDF2', salt: saltBytes, iterations: PBKDF2_ITER, hash: 'SHA-256' },
        km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    });
}
function encryptWithKey(obj, key, saltHex) {
  var salt = saltHex || bufToHex(randomBytes(16));
  var iv = randomBytes(12);
  var pt = new TextEncoder().encode(JSON.stringify(obj));
  return crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, pt).then(function (buf) {
    var all = new Uint8Array(buf);              // WebCrypto: ciphertext||tag(16B)
    var ct = all.subarray(0, all.length - 16);
    var tag = all.subarray(all.length - 16);
    return {
      enc: 1,
      kdf: 'pbkdf2-sha256-' + PBKDF2_ITER,
      salt: salt,
      iv: bufToHex(iv),
      tag: bufToHex(tag),
      data: bytesToBase64(ct)
    };
  });
}
function decryptEnvelope(env, key) {
  var all = new Uint8Array(base64ToBytes(env.data).length + 16);
  all.set(base64ToBytes(env.data), 0);
  all.set(hexToBytes(env.tag), all.length - 16);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: hexToBytes(env.iv) }, key, all)
    .then(function (pt) { return JSON.parse(new TextDecoder().decode(pt)); });
}

/* ==================== 备份轮转（保留最近 5 份） ==================== */
function backupNow() {
  return fReadText(STORE)
    .then(function (raw) {
      var stamp = localDateStr(new Date()).replace(/-/g, '') + '_' +
        new Date().toTimeString().slice(0, 8).replace(/:/g, '');
      return fWriteText(BK_DIR + '/store_' + stamp + '.json', raw).then(function () {
        return FS.readdir({ path: BK_DIR, directory: DIR });
      }).then(function (r) {
        var files = (r.files || []).map(function (f) { return f.name; })
          .filter(function (n) { return /^store_\d{8}_\d{6}\.json$/.test(n); }).sort();
        var kill = files.slice(0, Math.max(0, files.length - 5));
        var seq = Promise.resolve();
        kill.forEach(function (n) {
          seq = seq.then(function () { return FS.deleteFile({ path: BK_DIR + '/' + n, directory: DIR }); })
            .catch(function () { /* ignore */ });
        });
        return seq;
      }).then(function () { return true; });
    })
    .catch(function () { return false; });
}

/* ==================== Store ==================== */
function readStoreEnv() {
  return fReadText(STORE).then(function (raw) {
    try { return JSON.parse(raw); } catch (e) { return null; }
  }).catch(function () { return null; });
}
function storeToText(obj) {
  if (lockKey) return encryptWithKey(obj, lockKey).then(function (env) { return JSON.stringify(env); });
  return Promise.resolve(JSON.stringify({ enc: 0, data: obj }));
}

function readNotified() {
  return fReadText(NOTIFY_FILE).then(function (raw) {
    try { return JSON.parse(raw) || {}; } catch (e) { return {}; }
  }).catch(function () { return {}; });
}
function writeNotified(map) {
  return fWriteTextAtomic(NOTIFY_FILE, JSON.stringify(map)).catch(function () { /* ignore */ });
}

/* ==================== 图片 ==================== */
var IMG_MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
function safeImgName(name) {
  if (typeof name !== 'string' || !/^[\w.-]+$/.test(name) || name.indexOf('..') > -1) return null;
  return name;
}
function imgFileNameFromUrl(url) {
  var s = String(url || '');
  var i = s.lastIndexOf('/');
  var name = i > -1 ? s.slice(i + 1) : s;
  if (name.indexOf('?') > -1) name = name.slice(0, name.indexOf('?'));
  return safeImgName(name);
}

/* ==================== 胶囊提醒 ==================== */
var capsuleList = [];
var noticeCbs = [];
var navigateCbs = [];
var notifPermAsked = false;
var notifiedMap = {};

function fireNotice(payload) {
  noticeCbs.forEach(function (cb) { try { cb(payload); } catch (e) { /* ignore */ } });
}
function notifyOS(title, body, c) {
  if (!LN) return;
  LN.schedule({
    notifications: [{
      id: hashStr(c && c.id ? c.id : title),
      title: title,
      body: body,
      schedule: { at: new Date(Date.now() + 500), allowWhileIdle: true }
    }]
  }).catch(function () { /* ignore */ });
}
function ensureNotifPermission() {
  if (!LN || notifPermAsked) return;
  notifPermAsked = true;
  LN.checkPermissions().then(function (st) {
    if (st && st.display !== 'granted') {
      return LN.requestPermissions().catch(function () { /* ignore */ });
    }
  }).catch(function () { /* ignore */ });
}
/* 未来胶囊统一排在开启日当天上午 9 点提醒 */
function reminderDate(openDate) {
  var d = new Date(openDate);
  d.setHours(9, 0, 0, 0);
  if (d.getTime() <= Date.now()) d.setTime(openDate);
  return d;
}
function syncPendingNotifications() {
  if (!LN) return Promise.resolve();
  return LN.getPending().then(function (r) {
    var pend = (r && r.notifications) || [];
    if (!pend.length) return;
    return LN.cancel({ notifications: pend.map(function (n) { return { id: n.id }; }) }).catch(function () { /* ignore */ });
  }).catch(function () { /* ignore */ }).then(function () {
    var future = capsuleList.filter(function (c) {
      return c && c.status === 'sealed' && typeof c.openDate === 'number' && c.openDate > Date.now();
    });
    if (!future.length) return;
    return LN.schedule({
      notifications: future.map(function (c) {
        return {
          id: hashStr(c.id),
          title: '时间胶囊 · ' + (c.title || '未命名之信'),
          body: '约定的日子到了，来看看这封信吧。',
          schedule: { at: reminderDate(c.openDate), allowWhileIdle: true }
        };
      })
    }).catch(function () { /* ignore */ });
  });
}
function checkDueCapsules() {
  var now = Date.now();
  var today = localDateStr(new Date());
  var dirty = false;
  capsuleList.forEach(function (c) {
    if (!c || c.status !== 'sealed' || typeof c.openDate !== 'number') return;
    if (c.openDate > now) return;
    if (notifiedMap[c.id] === today) return;
    notifiedMap[c.id] = today;
    dirty = true;
    var title = '时间胶囊 · ' + (c.title || '未命名之信');
    var body = '有一枚胶囊可以开启了，去看看它吧。';
    notifyOS(title, body, c);
    fireNotice({ title: title, body: body });
  });
  if (dirty) writeNotified(notifiedMap);
  syncPendingNotifications();
}

/* ==================== 导出（图片内联为 data URL，跨平台可迁移） ==================== */
function inlineImages(json) {
  var obj;
  try { obj = JSON.parse(json); } catch (e) { return Promise.resolve(json); }
  var urls = [];
  (obj.diaries || []).forEach(function (d) {
    (d.images || []).forEach(function (u) {
      if (typeof u === 'string' && u.indexOf('data:') !== 0 && u.indexOf('/_capacitor_file_/') > -1) urls.push(u);
    });
  });
  urls = urls.filter(function (u, i) { return urls.indexOf(u) === i; });
  var map = {};
  var seq = Promise.resolve();
  urls.forEach(function (u) {
    seq = seq.then(function () {
      var name = imgFileNameFromUrl(u);
      if (!name) return;
      var ext = (name.split('.').pop() || 'jpg').toLowerCase();
      return fReadB64(IMG_DIR + '/' + name).then(function (b64) {
        map[u] = 'data:image/' + (IMG_MIME[ext] || 'image/jpeg').slice(6) + ';base64,' + b64;
      }).catch(function () { /* 缺图则保留原引用 */ });
    });
  });
  return seq.then(function () {
    if (!urls.length) return json;
    var s = json;
    urls.forEach(function (u) { if (map[u]) s = s.split(u).join(map[u]); });
    return s;
  });
}

/* ==================== 暴露 window.moshi ==================== */
var moshi = {
  platform: 'android',

  load: function () {
    return readStoreEnv().then(function (env) {
      if (!env) return { locked: false, data: null };
      if (env.enc === 1) return { locked: true };
      var data = env.data !== undefined ? env.data : env;
      if (!didStartupBackup) { didStartupBackup = true; backupNow(); }
      return { locked: false, data: data };
    }).catch(function () { return { locked: false, data: null }; });
  },

  save: function (json) {
    var obj;
    try { obj = JSON.parse(json); } catch (e) { return Promise.resolve({ ok: false, error: 'bad json' }); }
    lastObj = obj;
    var p = didStartupBackup ? Promise.resolve(false) : (didStartupBackup = true, backupNow());
    return p.then(function () { return storeToText(obj); })
      .then(function (text) { return fWriteTextAtomic(STORE, text); })
      .then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, error: fsErr(e) }; });
  },

  lockStatus: function () {
    return readStoreEnv().then(function (env) {
      return { encrypted: !!(env && env.enc === 1) };
    }).catch(function () { return { encrypted: false }; });
  },

  unlock: function (pass) {
    return readStoreEnv().then(function (env) {
      if (!env || env.enc !== 1) return { ok: false, error: '未加密' };
      return deriveKey(pass, hexToBytes(env.salt)).then(function (key) {
        return decryptEnvelope(env, key).then(function (data) {
          lockKey = key;
          lastObj = data;
          if (!didStartupBackup) { didStartupBackup = true; backupNow(); }
          return { ok: true, data: data };
        });
      }).catch(function () { return { ok: false, error: '密码错误' }; });
    }).catch(function () { return { ok: false, error: '密码错误' }; });
  },

  setLock: function (json, pass) {
    var obj;
    try { obj = JSON.parse(json); } catch (e) { return Promise.resolve({ ok: false, error: 'bad json' }); }
    if (pass) {
      if (String(pass).length < 4) return Promise.resolve({ ok: false, error: '密码至少 4 位' });
      var salt = randomBytes(16);
      return deriveKey(pass, salt).then(function (key) {
        return encryptWithKey(obj, key, bufToHex(salt)).then(function (env) {
          lockKey = key;
          lastObj = obj;
          return fWriteTextAtomic(STORE, JSON.stringify(env));
        });
      }).then(function () { return { ok: true }; })
        .catch(function (e) { return { ok: false, error: fsErr(e) }; });
    }
    lockKey = null;
    lastObj = obj;
    return fWriteTextAtomic(STORE, JSON.stringify({ enc: 0, data: obj }))
      .then(function () { return { ok: true }; })
      .catch(function (e) { return { ok: false, error: fsErr(e) }; });
  },

  saveImage: function (bytes, ext) {
    try {
      var cleanExt = IMG_MIME[String(ext || 'jpg').toLowerCase()] ? String(ext).toLowerCase() : 'jpg';
      var name = 'img_' + Date.now().toString(36) + '_' + bufToHex(randomBytes(4)) + '.' + cleanExt;
      var b64 = bytes instanceof Uint8Array ? bytesToBase64(bytes) : String(bytes);
      return FS.writeFile({ path: IMG_DIR + '/' + name, directory: DIR, data: b64, recursive: true })
        .then(function () { return FS.getUri({ path: IMG_DIR + '/' + name, directory: DIR }); })
        .then(function (r) { return C.convertFileSrc(r.uri); })
        .catch(function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  },

  deleteImage: function (url) {
    var name = imgFileNameFromUrl(url);
    if (!name) return Promise.resolve(false);
    return FS.deleteFile({ path: IMG_DIR + '/' + name, directory: DIR })
      .then(function () { return true; })
      .catch(function () { return false; });
  },

  exportData: function (json) {
    return inlineImages(json).then(function (out) {
      var fname = 'moshi_archive_' + localDateStr(new Date()) + '.json';
      if (Share) {
        return FS.writeFile({ path: fname, directory: 'CACHE', data: out, encoding: 'utf8', recursive: true })
          .then(function () { return FS.getUri({ path: fname, directory: 'CACHE' }); })
          .then(function (r) { return Share.share({ title: '墨室 · 时光档案 数据导出', files: [r.uri], dialogTitle: '导出数据' }); })
          .then(function () { return { ok: true }; })
          .catch(function () { return exportFallback(out, fname); });
      }
      return exportFallback(out, fname);
    }).catch(function (e) { return { ok: false, error: fsErr(e) }; });
  },

  importData: function () {
    return new Promise(function (resolve) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = '.json,application/json';
      input.onchange = function () {
        var file = input.files && input.files[0];
        if (!file) { resolve({ ok: false, canceled: true }); return; }
        var reader = new FileReader();
        reader.onload = function (ev) {
          try {
            var data = JSON.parse(ev.target.result);
            if (!Array.isArray(data.diaries) || !Array.isArray(data.capsules)) {
              resolve({ ok: false, error: '文件格式不正确：缺少 diaries/capsules' });
              return;
            }
            backupNow();
            resolve({ ok: true, data: data });
          } catch (err) {
            resolve({ ok: false, error: '导入失败：' + fsErr(err) });
          }
        };
        reader.onerror = function () { resolve({ ok: false, error: '读取文件失败' }); };
        reader.readAsText(file);
      };
      input.oncancel = function () { resolve({ ok: false, canceled: true }); };
      input.click();
    });
  },

  openFolder: function () {
    platformToast('数据存放在应用私有空间，备份请用「导出数据」');
    return Promise.resolve(true);
  },

  scheduleCapsules: function (list) {
    capsuleList = Array.isArray(list) ? list : [];
    ensureNotifPermission();
    if (!notifiedMap || !Object.keys(notifiedMap).length) {
      readNotified().then(function (m) { notifiedMap = m || {}; checkDueCapsules(); });
    } else {
      checkDueCapsules();
    }
    return Promise.resolve(true);
  },

  onCapsuleNavigate: function (cb) {
    navigateCbs.push(cb);
    return function () { navigateCbs = navigateCbs.filter(function (x) { return x !== cb; }); };
  },

  onCapsuleNotice: function (cb) {
    noticeCbs.push(cb);
    return function () { noticeCbs = noticeCbs.filter(function (x) { return x !== cb; }); }
  }
};
window.moshi = moshi;

/* 导出兜底：无分享面板时写入 Documents 并告知路径 */
function exportFallback(text, fname) {
  return FS.writeFile({ path: 'Documents/' + fname, directory: 'EXTERNAL', data: text, encoding: 'utf8', recursive: true })
    .then(function () {
      platformToast('已导出：Android/data/com.moshi.diary/files/Documents/' + fname);
      return { ok: true, path: 'Documents/' + fname };
    })
    .catch(function (e) { return { ok: false, error: fsErr(e) }; });
}

/* ==================== 生命周期 ==================== */
readNotified().then(function (m) { notifiedMap = m || {}; });
setInterval(checkDueCapsules, 60 * 1000);

/* 通知点击 → 跳到胶囊页 */
if (LN && LN.addListener) {
  LN.addListener('localNotificationActionPerformed', function () {
    navigateCbs.forEach(function (cb) { try { cb('capsule'); } catch (e) { /* ignore */ } });
  });
}

/* 安卓返回键：先关弹层，否则最小化到后台 */
if (App && App.addListener) {
  App.addListener('backButton', function () {
    function open(id) { var el = document.getElementById(id); return !!(el && el.classList.contains('open')); }
    function click(id) { var el = document.getElementById(id); if (el) el.click(); }
    if (open('modal-overlay')) { click('modal-close'); return; }
    if (open('confirm-overlay')) { click('confirm-cancel'); return; }
    App.minimizeApp();
  });
}
})();
