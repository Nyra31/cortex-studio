// Prueba de humo (la usa el flujo de GitHub Actions en Windows, macOS y Linux, y vale a mano): abre Cortex Studio
// con un proyecto de 2 s hecho con FFmpeg (video y sonido), lo renderiza a MP4 H.264 y comprueba el archivo con
// ffprobe. Así se ve que la interfaz arranca y que FFmpeg y ffprobe van bien empaquetados. Termina con código 0 si
// todo va bien y 1 si no. Datos aparte (carpeta temporal), en español.
// Uso: electron scripts/pruebas/humo.js [ruta de app.asar]   (sin ruta, el código del repo; hace falta vite build)
const path = require('path');
const os = require('os');
const fs = require('fs');
const { app, dialog, BrowserWindow } = require('electron');

const asar = process.argv.find((a) => a.endsWith('.asar'));
const base = asar ? path.resolve(asar) : path.join(__dirname, '..', '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-humo-'));
const userData = path.join(dir, 'datos');
fs.mkdirSync(userData, { recursive: true });
fs.writeFileSync(path.join(userData, 'idioma.json'), JSON.stringify({ lang: 'es' }));
app.setPath('userData', userData);
const clip = path.join(dir, 'clip.mp4');
const project = path.join(dir, 'humo.cortex');
const out = path.join(dir, 'render.mp4');
dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [project] });
dialog.showMessageBoxSync = () => 1;
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');
if (!process.env.CI) require('./secundaria.js'); // a mano, en el monitor secundario

const log = (...a) => console.log('[humo]', ...a);
let finished = false;
const finish = (ok, msg) => {
  if (finished) return;
  finished = true;
  log(ok ? 'BIEN' : 'FALLO', msg);
  try {
    fs.rmSync(clip, { force: true });
    fs.rmSync(out, { force: true });
  } catch {
    // la carpeta de datos la tiene abierta Chromium: se queda en la carpeta temporal
  }
  app.exit(ok ? 0 : 1);
};
setTimeout(() => finish(false, 'tiempo agotado (3 min)'), 180000);
process.on('uncaughtException', (err) => finish(false, err.stack || err));

const ff = require(path.join(base, 'electron', 'ffmpeg.js'));
require(path.join(base, 'electron', 'main.js'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(check, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`no llega: ${what}`);
    await wait(250);
  }
}

app.whenReady().then(async () => {
  try {
    log(process.platform, process.arch, 'electron', process.versions.electron, asar ? `asar ${asar}` : 'repo');
    // Medio de prueba: barras de color y un tono de 440 Hz.
    const r = await ff.run(ff.ffmpegPath, [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=30:duration=2', '-f', 'lavfi', '-i', 'sine=f=440:duration=2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', clip,
    ]);
    if (r.code !== 0) throw new Error(`FFmpeg no genera el clip: ${r.stderr}`);
    const tracks = [{ id: 't1', type: 'video', name: 'Video 1' }, { id: 't2', type: 'audio', name: 'Audio 1' }];
    const ev = (id, trackId) => ({ id, trackId, mediaId: 'm1', start: 0, inPoint: 0, duration: 2, groupId: 'g1' });
    fs.writeFileSync(project, JSON.stringify({
      format: 'cortex-studio', version: 10, settings: { width: 320, height: 240, fps: 30 },
      media: [{ id: 'm1', path: clip, name: 'clip.mp4' }], tracks, events: [ev('e1', 't1'), ev('e2', 't2')], markers: [], regions: [],
    }));

    const win = await until(() => BrowserWindow.getAllWindows()[0], 20000, 'la ventana');
    const wc = win.webContents;
    const errors = [];
    wc.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 3) errors.push(String(e.message).slice(0, 300));
    });
    wc.on('render-process-gone', (_e, d) => finish(false, `la interfaz se ha cerrado: ${d.reason}`));
    const js = (c) => wc.executeJavaScript(c);
    await until(() => !wc.isLoading() && js("!!document.querySelector('.statusbar')"), 30000, 'la interfaz');
    await js("document.querySelector('.modal button.primary')?.click()");
    await wait(500);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'O', modifiers: ['control'] });
    await until(() => js("document.querySelectorAll('.track-lane .event').length >= 2"), 30000, 'el proyecto abierto');
    log('proyecto abierto');
    const res = await js(`window.cortexPruebas.render(${JSON.stringify(out)})`);
    if (!res?.ok) throw new Error(`el render falla: ${res?.error}`);
    const info = await ff.analyze(out);
    log('render', JSON.stringify({ duration: info.duration, video: info.hasVideo, audio: info.hasAudio, size: `${info.width}x${info.height}` }));
    if (!info.hasVideo || !info.hasAudio || Math.abs(info.duration - 2) > 0.1 || info.width !== 320) throw new Error('el archivo renderizado no es el esperado');
    if (await js("document.body.innerText.includes('Algo ha fallado')")) throw new Error('la interfaz muestra la pantalla de error');
    const glError = await js("document.querySelector('.preview-error')?.innerText || ''");
    if (glError) log('aviso: la vista previa no se puede mostrar (normal sin tarjeta gráfica):', glError);
    if (errors.length) log(`aviso: ${errors.length} errores en la consola:\n  ${errors.join('\n  ')}`);
    finish(true, 'la aplicación arranca, abre el proyecto y renderiza');
  } catch (err) {
    finish(false, err.stack || err);
  }
});
