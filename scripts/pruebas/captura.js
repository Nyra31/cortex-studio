// Abre un proyecto en el monitor secundario y guarda una captura de la ventana (o de un elemento).
// Uso (tras `npm run build`, sin ELECTRON_RUN_AS_NODE):
//   node_modules/electron/dist/electron.exe scripts/pruebas/captura.js --proyecto=<.cortex> --png=<salida>
//     [--sel=<selector CSS>] [--espera=<ms>] [--js=<código que se ejecuta antes de capturar>]
// Base para otras pruebas: `js(...)` ejecuta código en la interfaz, `wc.sendInputEvent` manda teclas y ratón y
// `window.cortexPruebas` (Preview.jsx, App.jsx) da acceso a seek, renderOfflineAudio y el motor de audio.
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app, dialog, BrowserWindow } = require('electron');

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const project = path.resolve(arg('proyecto'));
const out = path.resolve(arg('png'));
const sel = arg('sel');
const pause = Number(arg('espera') || 3000);
const pre = arg('js');

// Carpeta de datos aparte (sin la recuperación ni los ajustes de la app de verdad).
app.setPath('userData', path.join(os.tmpdir(), 'cortex-pruebas'));
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
dialog.showMessageBoxSync = () => 1;
app.quit = () => {};
require('./secundaria.js');
require('../../electron/main.js');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
  await wait(1500);
  const win = BrowserWindow.getAllWindows()[0];
  const wc = win.webContents;
  const js = (c) => wc.executeJavaScript(c);
  try {
    await js(`document.querySelector('.modal button.primary')?.click()`);
    await wait(300);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'O', modifiers: ['control'] });
    await wait(pause);
    if (pre) {
      console.log('js:', await js(pre));
      await wait(1500);
    }
    let rect;
    if (sel) {
      rect = await js(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; })()`);
    }
    // Si la ventana no se está pintando, la captura sale con un fotograma viejo.
    win.focus();
    wc.invalidate();
    await wait(500);
    const img = await win.capturePage(rect);
    fs.writeFileSync(out, img.toPNG());
    console.log('captura', out, JSON.stringify(img.getSize()));
  } catch (err) {
    console.log('ERROR', err.stack || err);
  }
  app.exit(0);
});
