// Context isolation bridge — 只暴露白名单 IPC，不暴露任何 Node.js API
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel, cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('moshi', {
  // 数据存储（文件）
  load: () => ipcRenderer.invoke('store:load'),
  save: (json) => ipcRenderer.invoke('store:save', json),
  lockStatus: () => ipcRenderer.invoke('store:lock-status'),
  unlock: (pass) => ipcRenderer.invoke('store:unlock', pass),
  setLock: (json, pass) => ipcRenderer.invoke('store:set-lock', json, pass),
  // 图片
  saveImage: (bytes, ext) => ipcRenderer.invoke('img:save', bytes, ext),
  deleteImage: (url) => ipcRenderer.invoke('img:delete', url),
  // 导入导出 / 数据目录
  exportData: (json) => ipcRenderer.invoke('data:export', json),
  importData: () => ipcRenderer.invoke('data:import'),
  openFolder: () => ipcRenderer.invoke('data:open-folder'),
  // 胶囊到期提醒
  scheduleCapsules: (list) => ipcRenderer.invoke('capsules:schedule', list),
  onCapsuleNavigate: (cb) => listen('capsule:navigate', cb),
  onCapsuleNotice: (cb) => listen('capsule:notice', cb)
});
