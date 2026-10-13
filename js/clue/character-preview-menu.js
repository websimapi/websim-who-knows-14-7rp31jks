// Owner's character inspection menu: Ctrl + backtick. No title-screen button.
const style = document.createElement('style');
style.textContent = `#characterPreviewMenu{position:fixed;inset:0;width:min(94vw,1400px);height:min(92vh,960px);padding:0;border:1px solid #455372;border-radius:12px;background:#10151d;color:#eef2fb;z-index:10000}#characterPreviewMenu::backdrop{background:#000b}#characterPreviewMenu header{height:48px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;background:#182231;font:15px system-ui}#characterPreviewMenu button{border:1px solid #596981;background:#243249;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer}#characterPreviewMenu iframe{width:100%;height:calc(100% - 48px);border:0;display:block}`;
document.head.append(style);
let dialog;
function toggle() {
  if (!dialog) {
    dialog = document.createElement('dialog');dialog.id = 'characterPreviewMenu';
    dialog.setAttribute('aria-label', 'Character preview menu');
    dialog.innerHTML = '<header><span>Character preview · Tomas Voss / Blue</span><button type="button" aria-label="Close character preview">Close</button></header><iframe title="Tomas Voss character preview"></iframe>';
    const url = new URL('./blue-preview.html', document.baseURI);
    const version = new URL(location.href).searchParams.get('v');
    if (version) url.searchParams.set('v', version);
    dialog.querySelector('iframe').src = url.href;
    dialog.querySelector('button').onclick = () => dialog.close();
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
    document.body.append(dialog);
  }
  if (dialog.open) dialog.close(); else dialog.showModal();
}
function shortcut(event) {
  if (event.ctrlKey && !event.altKey && !event.metaKey && (event.code === 'Backquote' || event.key === '`') && !event.repeat) {
    event.preventDefault(); event.stopPropagation(); toggle();
  }
}
document.addEventListener('keydown', shortcut, true);
// Key events in the preview iframe are delivered here by its own script.
addEventListener('message', event => {
  if (dialog && event.source === dialog.querySelector('iframe').contentWindow && event.origin === location.origin && event.data?.type === 'character-preview-close') dialog.close();
});
