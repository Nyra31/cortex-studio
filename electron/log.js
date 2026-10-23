// Registro de errores: userData/registros/cortex-AAAA-MM-DD.log (uno por día, se guardan los últimos 14). Sirve para
// saber qué ha fallado en el equipo de otra persona (Ayuda → Abrir la carpeta de registros). No se envía a ninguna
// parte.
const { app } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const KEEP_DAYS = 14;
const MAX_MESSAGE = 6000;

const dir = () => path.join(app.getPath('userData'), 'registros');
const fileFor = (d = new Date()) => path.join(dir(), `cortex-${d.toISOString().slice(0, 10)}.log`);

function write(level, source, message) {
  try {
    fs.mkdirSync(dir(), { recursive: true });
    const text = String(message?.stack || message).slice(0, MAX_MESSAGE).replace(/\r?\n/g, '\n    ');
    fs.appendFileSync(fileFor(), `${new Date().toISOString()} [${level}] [${source}] ${text}\n`, 'utf8');
  } catch {
    // sin registro: no se puede hacer nada más
  }
}

function prune() {
  try {
    const files = fs.readdirSync(dir()).filter((f) => /^cortex-\d{4}-\d{2}-\d{2}\.log$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - KEEP_DAYS))) fs.unlinkSync(path.join(dir(), f));
  } catch {}
}

// Al arrancar: limpia los viejos, apunta la versión y el sistema, y registra los errores sin capturar.
function setup() {
  prune();
  let version = app.getVersion();
  try {
    version = require('../package.json').version;
  } catch {}
  write('info', 'inicio', `Cortex Studio ${version} · Electron ${process.versions.electron} · ${os.platform()} ${os.release()} ${os.arch()} · ${os.cpus()[0]?.model || ''} · ${Math.round(os.totalmem() / 1073741824)} GB`);
  process.on('unhandledRejection', (err) => write('error', 'principal', err));
  app.on('render-process-gone', (_e, _wc, details) => write('error', 'interfaz', `El proceso de la interfaz terminó: ${details.reason} (código ${details.exitCode})`));
  app.on('child-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') write('error', 'proceso', `${details.type} terminó: ${details.reason} (código ${details.exitCode})`);
  });
}

// Envuelve ipcMain.handle para apuntar los errores de cada canal (siguen llegando a la interfaz como siempre).
function wrapIpc(ipcMain) {
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) => handle(channel, async (...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      write('error', channel, err);
      throw err;
    }
  });
}

module.exports = { write, setup, wrapIpc, dir };
