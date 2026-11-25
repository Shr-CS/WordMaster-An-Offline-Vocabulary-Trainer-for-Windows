/* Android capability adapter. The shared learning code also runs in Electron. */
'use strict';

if (window.WordMasterAndroid) {
  document.documentElement.dataset.platform = 'android';
  const pending = new Map();
  let requestId = 0;
  function request(action, payload = '') {
    return new Promise((resolve) => {
      const id = ++requestId;
      pending.set(id, resolve);
      window.WordMasterAndroid.request(id, action, payload);
    });
  }
  window.WMAndroidComplete = (id, result) => {
    const resolve = pending.get(id);
    pending.delete(id);
    if (resolve) resolve(result);
  };
  window.desktop = {
    platform: 'android',
    getInfo: async () => JSON.parse(window.WordMasterAndroid.getInfo()),
    setTheme: async (theme) => window.WordMasterAndroid.setTheme(theme),
    exportData: (json) => request('export', json),
    importData: () => request('import'),
  };
  window.WMAndroidBack = () => {
    const modal = document.getElementById('modal-host');
    if (modal && !modal.hidden) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return true;
    }
    if (window.WM && WM.app.route !== 'home') {
      WM.app.navigate('home');
      return true;
    }
    return false;
  };
}
