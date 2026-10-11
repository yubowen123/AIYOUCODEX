// Official v0.2.16 chunks. Resolve them relative to the owned document's base
// so React and the settings stores reuse the editor's existing module instances.
export const OPENCHATCUT_SETTINGS_MODULES = Object.freeze({
  dialog: 'assets/SettingsDialog-8GsumHR8.js',
  react: 'assets/react-DUVq_3mI.js',
});

// Serialized into the controlled editor document. Only OpenChatCut's native
// component owns the fields, save requests and dirty-form close guard.
export function createOpenChatCutSettingsOpener(modules) {
  let mounted = null;
  let pending = null;
  let disposed = false;
  function close() {
    const current = mounted;
    mounted = null;
    current?.root.unmount();
    current?.host.remove();
  }
  function hasNativeSettings() {
    // An older native entry may already have a dirty form in the editor root.
    // Reuse it without touching its local values or mounting a second dialog.
    const titles = ['设置 · API 密钥', 'Settings · API Keys', 'Impostazioni · chiavi API', 'Настройки · API-ключи'];
    return [...document.querySelectorAll('header b')].some(title => {
      if (!titles.includes(title.textContent.trim())) return false;
      const header = title.closest('header'), panel = header?.parentElement, overlay = panel?.parentElement;
      return panel?.firstElementChild === header && panel.children[1]?.tagName === 'DIV'
        && panel.children[2]?.tagName === 'FOOTER' && !!panel.children[2].querySelector('input[type="checkbox"]')
        && overlay?.style.position === 'fixed' && overlay.style.inset === '0px' && overlay.style.zIndex === '200';
    });
  }
  async function open() {
    if (disposed) throw new Error('OpenChatCut settings entry has been disposed');
    if (mounted?.host.isConnected || hasNativeSettings()) return;
    if (pending) return pending;
    pending = (async () => {
      const [{ SettingsDialog }, runtime] = await Promise.all([
        import(new URL(modules.dialog, document.baseURI).href),
        import(new URL(modules.react, document.baseURI).href),
      ]);
      if (disposed || hasNativeSettings()) return;
      if (typeof SettingsDialog !== 'function' || typeof runtime.i !== 'function' || typeof runtime.n !== 'function') {
        throw new Error('Unsupported OpenChatCut settings module');
      }
      const React = runtime.i();
      const ReactDOM = runtime.n();
      const host = document.createElement('div');
      host.setAttribute('data-aiyou-openchatcut-model-settings', '');
      document.body.appendChild(host);
      const root = ReactDOM.createRoot(host);
      mounted = { host, root };
      try {
        root.render(React.createElement(SettingsDialog, { onClose: close }));
        for (let attempt = 0; attempt < 80 && !disposed && host.isConnected && !host.childElementCount; attempt++) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        if (!disposed && host.isConnected && !host.childElementCount) throw new Error('OpenChatCut settings did not mount');
      } catch (error) { close(); throw error; }
    })().finally(() => { pending = null; });
    return pending;
  }
  return { open, destroy() { disposed = true; close(); } };
}
