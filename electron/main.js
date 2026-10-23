const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const crypto = require('crypto');
const ff = require('./ffmpeg');
const youtube = require('./youtube');
const compressor = require('./compressor');

// Actualizaciones automáticas (electron-updater, releases de GitHub: latest.yml + instalador). Solo en la app
// instalada: al arrancar busca una versión nueva, la descarga en segundo plano y la interfaz pregunta si
// reiniciar ya o instalarla al salir. CORTEX_UPDATE_URL: servidor de pruebas (proveedor genérico).
let autoUpdater = null;
let updateState = { status: 'idle' }; // idle | checking | downloading | ready | latest | error
let manualCheck = false;

// Protocolo media:// para que la vista previa lea archivos locales con soporte de rangos (búsqueda en video).
// Con CORS, para que el compositor WebGL pueda leer los fotogramas sin que el lienzo quede bloqueado.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'media',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true, corsEnabled: true },
  },
]);
const CORS = { 'Access-Control-Allow-Origin': '*' };

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
  '.aac': 'audio/aac', '.flac': 'audio/flac', '.opus': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp',
};

const MEDIA_FILTERS = [
  { name: 'Medios', extensions: ['mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'opus', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] },
  { name: 'Todos los archivos', extensions: ['*'] },
];
const PROJECT_FILTERS = [{ name: 'Proyecto de Cortex Studio', extensions: ['cortex'] }];

// Copia de recuperación (guardado automático): la interfaz la escribe cada minuto si hay cambios sin guardar.
// Se borra al cerrar la ventana normalmente; si sigue ahí al arrancar, la aplicación se cerró de golpe.
const recoveryPath = () => path.join(app.getPath('userData'), 'autosave', 'recuperacion.json');
const clearRecovery = () => {
  try {
    fs.unlinkSync(recoveryPath());
  } catch {
    // no había copia
  }
};

// Solo se sirven por media:// los archivos que el usuario importó.
const allowedFiles = new Set();
let mainWindow = null;
let renderProcess = null;
let projectDirty = false; // la interfaz avisa cuando hay cambios sin guardar
let closeConfirmed = false;

async function serveMedia(request) {
  const filePath = new URL(request.url).searchParams.get('p');
  if (!filePath || !allowedFiles.has(path.resolve(filePath))) return new Response('Prohibido', { status: 403 });
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
  } catch {
    return new Response('No encontrado', { status: 404 });
  }
  const size = stat.size;
  const type = MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
  if (range) {
    let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    end = Math.min(end, size - 1);
    if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        ...CORS,
        'Content-Type': type,
        'Content-Length': String(end - start + 1),
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Accept-Ranges': 'bytes',
      },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...CORS, 'Content-Type': type, 'Content-Length': String(size), 'Accept-Ranges': 'bytes' },
  });
}

function createWindow() {
  // Arranca maximizada (en ventana, ocupando la pantalla, como otros editores). Se crea oculta y se
  // maximiza antes de mostrarla, para que no se vea primero pequeña.
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#1c1d20',
    title: 'Cortex Studio',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  // Se maximiza y se muestra enseguida, sin esperar a 'ready-to-show': en Windows ese evento a veces no
  // llega con la ventana oculta (pasaba con la carpeta de datos de la aplicación) y la ventana no aparecía.
  // Mientras carga se ve el color de fondo, el mismo de la interfaz.
  mainWindow.maximize();
  mainWindow.show();
  // La interfaz marca «Pantalla completa» en el menú Ver según el estado real (también si cambia por otra vía).
  const sendFullScreen = () => mainWindow.webContents.send('window:fullscreen', mainWindow.isFullScreen());
  mainWindow.on('enter-full-screen', sendFullScreen);
  mainWindow.on('leave-full-screen', sendFullScreen);
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  // Con cambios sin guardar, preguntar antes de cerrar (también al usar Archivo > Salir).
  mainWindow.on('close', (event) => {
    if (closeConfirmed || !projectDirty) return;
    event.preventDefault();
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      title: 'Cortex Studio',
      message: '¿Guardar los cambios del proyecto antes de salir?',
      detail: 'Si no los guardas, se perderán.',
      buttons: ['Guardar', 'No guardar', 'Cancelar'],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (choice === 0) {
      mainWindow.webContents.send('project:saveBeforeClose');
    } else if (choice === 1) {
      closeConfirmed = true;
      mainWindow.close();
    }
  });
  // Vista previa en otra pantalla (window.open de la interfaz con el nombre «cortex-externa»): ventana sin
  // marco a pantalla completa en una pantalla distinta de la del editor (o en la misma si solo hay una).
  mainWindow.webContents.setWindowOpenHandler(({ frameName }) => (frameName === 'cortex-externa'
    ? { action: 'allow', overrideBrowserWindowOptions: { frame: false, show: false, backgroundColor: '#000000', title: 'Cortex Studio: vista previa' } }
    : { action: 'deny' }));
  mainWindow.webContents.on('did-create-window', (child) => {
    const here = screen.getDisplayMatching(mainWindow.getBounds());
    const other = screen.getAllDisplays().find((d) => d.id !== here.id) || here;
    child.setBounds(other.bounds);
    child.show();
    child.setFullScreen(true);
  });
  mainWindow.on('closed', () => {
    for (const w of BrowserWindow.getAllWindows()) w.close(); // la vista previa externa
    mainWindow = null;
    clearRecovery(); // cierre normal: guardado, sin cambios o «No guardar»
  });
}

ipcMain.handle('media:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar medios',
    properties: ['openFile', 'multiSelections'],
    filters: MEDIA_FILTERS,
  });
  return res.canceled ? [] : res.filePaths;
});

ipcMain.handle('media:analyze', async (_e, filePath) => {
  const resolved = path.resolve(filePath);
  const info = await ff.analyze(resolved);
  allowedFiles.add(resolved);
  const proxy = info.isImage ? null : existingProxy(resolved);
  if (proxy) allowedFiles.add(proxy);
  return { ...info, proxy };
});

// Subtítulos: leer un SRT/WebVTT (devuelve { path, text } o null) y guardar uno.
ipcMain.handle('subtitles:import', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar subtítulos',
    properties: ['openFile'],
    filters: [{ name: 'Subtítulos (SRT, WebVTT)', extensions: ['srt', 'vtt'] }],
  });
  if (res.canceled || !res.filePaths.length) return null;
  return { path: res.filePaths[0], text: await fs.promises.readFile(res.filePaths[0], 'utf8') };
});
ipcMain.handle('subtitles:export', async (_e, text, defaultName) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Exportar subtítulos',
    defaultPath: defaultName || 'Subtítulos.srt',
    filters: [{ name: 'Subtítulos SRT', extensions: ['srt'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await fs.promises.writeFile(res.filePath, `﻿${text}`, 'utf8'); // con BOM: así lo leen bien los reproductores
  return res.filePath;
});

// LUT .cube del efecto LUT: elegir un archivo y leerlo (solo .cube) para la vista previa.
ipcMain.handle('lut:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir una LUT',
    properties: ['openFile'],
    filters: [{ name: 'LUT 3D (.cube)', extensions: ['cube'] }],
  });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});
ipcMain.handle('lut:read', async (_e, filePath) => {
  if (path.extname(filePath).toLowerCase() !== '.cube') throw new Error('No es un archivo .cube');
  return fs.promises.readFile(filePath, 'utf8');
});

// Detectar escenas: cortes de plano entre start y start + length (s del medio); devuelve los instantes desde start.
ipcMain.handle('media:scenes', async (event, filePath, start, length) => {
  const file = path.resolve(filePath);
  if (!allowedFiles.has(file)) throw new Error('El archivo no está importado');
  return ff.detectScenes(file, start, length, 0.3, {
    onProgress: (p) => event.sender.send('scenes:progress', p),
  });
});

// Congelar fotograma: el fotograma del medio en `time` (segundos del medio) como PNG en «Fotogramas» junto al
// proyecto (o en Documentos si aún no está guardado). Devuelve la ruta.
ipcMain.handle('media:frame', async (_e, filePath, time, projectPath) => {
  const file = path.resolve(filePath);
  if (!allowedFiles.has(file)) throw new Error('El archivo no está importado');
  const dir = projectPath
    ? path.join(path.dirname(projectPath), 'Fotogramas')
    : path.join(app.getPath('documents'), 'Cortex Studio', 'Fotogramas');
  await fs.promises.mkdir(dir, { recursive: true });
  const base = path.basename(file, path.extname(file));
  let n = 1;
  const name = (i) => path.join(dir, `${base} - fotograma ${String(i).padStart(2, '0')}.png`);
  while (fs.existsSync(name(n))) n++;
  const out = name(n);
  await ff.extractFrame(file, time, out);
  return out;
});

// Tira de miniaturas de un video para la línea de tiempo (ver filmstrip en ffmpeg.js), en userData/miniaturas
// (JPEG + JSON con sus medidas, mismo nombre que el proxy). Se hacen de una en una.
let stripQueue = Promise.resolve();
ipcMain.handle('media:filmstrip', (_e, filePath) => {
  const file = path.resolve(filePath);
  if (!allowedFiles.has(file)) throw new Error('El archivo no está importado');
  const job = stripQueue.then(async () => {
    const dir = path.join(app.getPath('userData'), 'miniaturas');
    const base = path.join(dir, path.basename(proxyPathFor(file), '.mp4'));
    const jpg = `${base}.jpg`;
    try {
      const meta = JSON.parse(await fs.promises.readFile(`${base}.json`, 'utf8'));
      if (fs.existsSync(jpg)) {
        allowedFiles.add(jpg);
        return { ...meta, path: jpg };
      }
    } catch {
      // no está hecha
    }
    await fs.promises.mkdir(dir, { recursive: true });
    const meta = await ff.filmstrip(file, `${base}.parcial.jpg`);
    await fs.promises.rename(`${base}.parcial.jpg`, jpg);
    await fs.promises.writeFile(`${base}.json`, JSON.stringify(meta));
    allowedFiles.add(jpg);
    return { ...meta, path: jpg };
  });
  stripQueue = job.catch(() => {});
  return job;
});

// ---- Proxies de la vista previa (ver makeProxy en ffmpeg.js) ----
// Se guardan en userData/proxies con un nombre que depende del nombre, el tamaño y la fecha del original (si el
// archivo cambia, se hace otro; una copia con la misma fecha, como las de «Recopilar medios», usa el mismo). Se
// crean de uno en uno; al salir se para el que esté en marcha.
const proxyDir = () => path.join(app.getPath('userData'), 'proxies');
function proxyPathFor(file) {
  const st = fs.statSync(file);
  const key = crypto.createHash('sha1').update(`${path.basename(file).toLowerCase()}|${st.size}|${Math.round(st.mtimeMs)}`).digest('hex').slice(0, 24);
  return path.join(proxyDir(), `${key}.mp4`);
}
function existingProxy(file) {
  try {
    const p = proxyPathFor(file);
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}
let proxyQueue = Promise.resolve();
let proxyProc = null;
const proxyJobs = new Map(); // original → promesa del proxy

ipcMain.handle('proxy:make', (_e, filePath) => {
  const file = path.resolve(filePath);
  if (!allowedFiles.has(file)) throw new Error('El archivo no está importado');
  const ready = existingProxy(file);
  if (ready) {
    allowedFiles.add(ready);
    return ready;
  }
  if (proxyJobs.has(file)) return proxyJobs.get(file);
  const job = proxyQueue.then(async () => {
    const out = proxyPathFor(file);
    await fs.promises.mkdir(proxyDir(), { recursive: true });
    const part = out.replace(/\.mp4$/, '.parcial.mp4');
    const send = (percent) => mainWindow?.webContents.send('proxy:progress', { path: file, percent });
    send(0);
    const r = await ff.makeProxy(file, part, {
      onSpawn: (p) => { proxyProc = p; },
      onProgress: (f) => send(Math.round(f * 100)),
    });
    proxyProc = null;
    if (r.code !== 0) {
      fs.promises.unlink(part).catch(() => {});
      throw new Error(r.stderr.trim().split('\n').pop() || `FFmpeg terminó con el código ${r.code}`);
    }
    await fs.promises.rename(part, out);
    allowedFiles.add(out);
    return out;
  });
  proxyQueue = job.catch(() => {});
  proxyJobs.set(file, job);
  job.catch(() => {}).finally(() => proxyJobs.delete(file));
  return job;
});

ipcMain.handle('proxy:remove', async (_e, filePath) => {
  const p = existingProxy(path.resolve(filePath));
  if (p) await fs.promises.unlink(p).catch(() => {});
  return true;
});

// Espacio que ocupan los proxies y borrado de todos (Herramientas).
const proxyFiles = () => {
  try {
    return fs.readdirSync(proxyDir()).map((f) => path.join(proxyDir(), f));
  } catch {
    return [];
  }
};
ipcMain.handle('proxy:usage', () => {
  const files = proxyFiles().filter((f) => !f.endsWith('.parcial.mp4'));
  return { count: files.length, bytes: files.reduce((sum, f) => sum + (fs.statSync(f).size || 0), 0) };
});
ipcMain.handle('proxy:clear', async () => {
  for (const f of proxyFiles()) if (!f.endsWith('.parcial.mp4')) await fs.promises.unlink(f).catch(() => {});
  return true;
});

ipcMain.handle('project:save', async (_e, data, filePath) => {
  let target = filePath;
  if (!target) {
    const res = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar proyecto',
      defaultPath: 'Proyecto.cortex',
      filters: PROJECT_FILTERS,
    });
    if (res.canceled || !res.filePath) return null;
    target = res.filePath;
  }
  await writeProject(target, data);
  await noteRecent(target);
  return target;
});

// Escribe un proyecto. Cada medio guarda también su ruta relativa a la carpeta del proyecto (`rel`): si al abrirlo
// la absoluta no existe (otro equipo, carpeta movida), se usa esa (ver readProject).
async function writeProject(target, data) {
  const dir = path.dirname(target);
  const media = (data.media || []).map((m) => (m.path ? { ...m, rel: path.relative(dir, m.path) } : m));
  // Copia de seguridad, como el .veg.bak de VEGAS: la versión anterior del archivo queda en «.bak».
  try {
    await fs.promises.copyFile(target, `${target}.bak`);
  } catch {
    // archivo nuevo: no hay versión anterior
  }
  await fs.promises.writeFile(target, JSON.stringify({ ...data, media }, null, 2), 'utf8');
}
// Recopilar medios: copia todos los archivos del proyecto a «Medios» dentro de la carpeta elegida y guarda allí el
// proyecto apuntando a las copias (que conservan la fecha del original). Los que ya están dentro de la carpeta no se
// copian, y una copia anterior igual (mismo tamaño y fecha) se reutiliza. Progreso por `collect:progress`.
// Devuelve { path, map (original → copia), missing } o null si se cancela.
ipcMain.handle('project:collect', async (event, data, currentPath) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Recopilar medios: elige o crea la carpeta del proyecto',
    properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
  });
  if (res.canceled || !res.filePaths.length) return null;
  const dir = res.filePaths[0];
  const target = path.join(dir, currentPath ? path.basename(currentPath) : 'Proyecto.cortex');
  const mediaDir = path.join(dir, 'Medios');
  await fs.promises.mkdir(mediaDir, { recursive: true });
  const files = [...new Set((data.media || []).filter((m) => m.path).map((m) => path.resolve(m.path)))];
  const map = {};
  const missing = [];
  const taken = new Set();
  const stats = new Map();
  for (const f of files) {
    try {
      stats.set(f, await fs.promises.stat(f));
    } catch {
      missing.push(f);
    }
  }
  const total = [...stats.values()].reduce((s, st) => s + st.size, 0) || 1;
  let done = 0;
  for (const [file, st] of stats) {
    const inside = !path.relative(dir, file).startsWith('..') && !path.isAbsolute(path.relative(dir, file));
    if (inside) {
      map[file] = file;
      continue;
    }
    // Nombre libre en «Medios» (o el de una copia anterior idéntica).
    const ext = path.extname(file);
    const stem = path.basename(file, ext);
    let dest = null;
    for (let i = 1; !dest; i++) {
      const candidate = path.join(mediaDir, i === 1 ? `${stem}${ext}` : `${stem} (${i})${ext}`);
      if (taken.has(candidate.toLowerCase())) continue;
      let same = false;
      let exists = false;
      try {
        const other = await fs.promises.stat(candidate);
        exists = true;
        same = other.size === st.size && Math.round(other.mtimeMs) === Math.round(st.mtimeMs);
      } catch {
        // libre
      }
      if (!exists || same) dest = candidate;
    }
    taken.add(dest.toLowerCase());
    event.sender.send('collect:progress', { name: path.basename(file), percent: Math.round((done / total) * 100) });
    if (!fs.existsSync(dest)) {
      await fs.promises.copyFile(file, `${dest}.parcial`);
      await fs.promises.rename(`${dest}.parcial`, dest);
      await fs.promises.utimes(dest, st.atimeMs / 1000, st.mtimeMs / 1000);
    }
    done += st.size;
    allowedFiles.add(dest);
    map[file] = dest;
  }
  const media = data.media.map((m) => (m.path && map[path.resolve(m.path)] ? { ...m, path: map[path.resolve(m.path)] } : m));
  await writeProject(target, { ...data, media });
  return { path: target, map, missing };
});

async function readProject(filePath) {
  const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  const dir = path.dirname(filePath);
  if (Array.isArray(data.media)) {
    data.media = data.media.map((m) => {
      if (!m.path || !m.rel || fs.existsSync(m.path)) return m;
      const near = path.resolve(dir, m.rel);
      return fs.existsSync(near) ? { ...m, path: near } : m;
    });
  }
  return data;
}

// Guardado automático: { savedAt, projectPath, data }. Se escribe en un temporal y se renombra, para que
// un cierre a medias no deje la copia rota.
ipcMain.handle('autosave:write', async (_e, data, projectPath) => {
  const file = recoveryPath();
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.promises.writeFile(tmp, JSON.stringify({ savedAt: Date.now(), projectPath, data }), 'utf8');
  await fs.promises.rename(tmp, file);
});
ipcMain.handle('autosave:clear', () => clearRecovery());
ipcMain.handle('autosave:check', async () => {
  try {
    return JSON.parse(await fs.promises.readFile(recoveryPath(), 'utf8'));
  } catch {
    return null;
  }
});

// Proyectos recientes (pantalla de inicio): userData/recientes.json = [{ path, openedAt }], los últimos abiertos o
// guardados primero, como mucho RECENT_MAX.
const RECENT_MAX = 12;
const recentPath = () => path.join(app.getPath('userData'), 'recientes.json');
async function readRecent() {
  try {
    const list = JSON.parse(await fs.promises.readFile(recentPath(), 'utf8'));
    return Array.isArray(list) ? list.filter((r) => typeof r?.path === 'string') : [];
  } catch {
    return [];
  }
}
async function writeRecent(list) {
  await fs.promises.mkdir(path.dirname(recentPath()), { recursive: true }).catch(() => {});
  await fs.promises.writeFile(recentPath(), JSON.stringify(list.slice(0, RECENT_MAX)), 'utf8').catch(() => {});
}
async function noteRecent(filePath) {
  const key = path.resolve(filePath).toLowerCase();
  const list = (await readRecent()).filter((r) => path.resolve(r.path).toLowerCase() !== key);
  await writeRecent([{ path: path.resolve(filePath), openedAt: Date.now() }, ...list]);
}
ipcMain.handle('recent:list', async () => {
  const list = await readRecent();
  return Promise.all(list.map(async (r) => {
    try {
      const st = await fs.promises.stat(r.path);
      return { ...r, exists: true, modifiedAt: st.mtimeMs };
    } catch {
      return { ...r, exists: false };
    }
  }));
});
ipcMain.handle('recent:remove', async (_e, filePath) => {
  const key = path.resolve(filePath).toLowerCase();
  await writeRecent((await readRecent()).filter((r) => path.resolve(r.path).toLowerCase() !== key));
});
// Abrir un proyecto de la lista de recientes (solo archivos .cortex que estén en ella).
ipcMain.handle('project:openPath', async (_e, filePath) => {
  const key = path.resolve(filePath).toLowerCase();
  if (!/\.cortex$/i.test(key) || !(await readRecent()).some((r) => path.resolve(r.path).toLowerCase() === key)) {
    throw new Error('El proyecto no está en la lista de recientes');
  }
  const data = await readProject(filePath);
  await noteRecent(filePath);
  return { path: path.resolve(filePath), data };
});

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir proyecto',
    properties: ['openFile'],
    filters: PROJECT_FILTERS,
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const data = await readProject(filePath);
  await noteRecent(filePath);
  return { path: filePath, data };
});

// type = { name, ext } del formato elegido en la ventana de render.
ipcMain.handle('render:pickPath', async (_e, defaultName, type) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Renderizar como',
    defaultPath: defaultName || 'Video.mp4',
    filters: [type?.ext ? { name: type.name, extensions: [type.ext] } : { name: 'Video MP4 (H.264/AAC)', extensions: ['mp4'] }],
  });
  return res.canceled ? null : res.filePath;
});

ipcMain.handle('render:start', async (event, project, settings, outPath) => {
  if (renderProcess) return { ok: false, error: 'Ya hay un renderizado en curso.' };
  let canceled = false;
  try {
    const result = await ff.render(project, settings, outPath, {
      onSpawn: (proc) => {
        renderProcess = proc;
        proc.cancel = () => {
          canceled = true;
          proc.kill();
        };
      },
      onProgress: (p) => event.sender.send('render:progress', p),
    });
    if (canceled) {
      fs.promises.unlink(outPath).catch(() => {});
      return { ok: false, canceled: true };
    }
    if (result.code !== 0) return { ok: false, error: result.stderr.trim().split('\n').slice(-8).join('\n') };
    return { ok: true, cpuFallback: result.cpuFallback };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    renderProcess = null;
  }
});

ipcMain.handle('render:cancel', () => {
  if (renderProcess) renderProcess.cancel();
});

ipcMain.on('project:dirty', (_e, dirty) => {
  projectDirty = !!dirty;
});
ipcMain.handle('window:toggleFullScreen', () => {
  if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
});
ipcMain.on('window:close', () => {
  closeConfirmed = true;
  if (mainWindow) mainWindow.close();
});

// Grabación de voz en off: la interfaz manda las muestras (PCM de 16 bits, mono) a trozos y aquí se escriben
// en un WAV. Va a la carpeta «Grabaciones» junto al proyecto (o en Documentos si aún no está guardado).
const recordings = new Map(); // id → { fd, path, bytes, rate }
let recordingId = 0;
function wavHeader(rate, bytes) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + bytes, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(bytes, 40);
  return h;
}
ipcMain.handle('record:start', async (_e, projectPath, rate) => {
  const dir = projectPath
    ? path.join(path.dirname(projectPath), 'Grabaciones')
    : path.join(app.getPath('documents'), 'Cortex Studio', 'Grabaciones');
  await fs.promises.mkdir(dir, { recursive: true });
  let n = 1;
  const name = (i) => path.join(dir, `Voz en off ${String(i).padStart(2, '0')}.wav`);
  while (fs.existsSync(name(n))) n++;
  const file = name(n);
  const fd = fs.openSync(file, 'w');
  fs.writeSync(fd, wavHeader(rate, 0));
  const id = ++recordingId;
  recordings.set(id, { fd, path: file, bytes: 0, rate });
  return { id, path: file };
});
ipcMain.on('record:write', (_e, id, chunk) => {
  const r = recordings.get(id);
  if (!r) return;
  const buf = Buffer.from(chunk);
  fs.writeSync(r.fd, buf, 0, buf.length, 44 + r.bytes);
  r.bytes += buf.length;
  // Cabecera al día cada pocos segundos: si la aplicación se cierra de golpe, el archivo se puede abrir igual.
  if (r.bytes - (r.headerAt || 0) > r.rate * 2 * 5) {
    fs.writeSync(r.fd, wavHeader(r.rate, r.bytes), 0, 44, 0);
    r.headerAt = r.bytes;
  }
});
// Devuelve la ruta del archivo (null si no se grabó nada: se borra).
ipcMain.handle('record:stop', async (_e, id) => {
  const r = recordings.get(id);
  if (!r) return null;
  recordings.delete(id);
  fs.writeSync(r.fd, wavHeader(r.rate, r.bytes), 0, 44, 0);
  fs.closeSync(r.fd);
  if (!r.bytes) {
    fs.promises.unlink(r.path).catch(() => {});
    return null;
  }
  return r.path;
});

function sendUpdate(state) {
  updateState = state;
  if (mainWindow) mainWindow.webContents.send('update:state', { ...state, manual: manualCheck });
}
function setupUpdates() {
  if (!app.isPackaged && !process.env.CORTEX_UPDATE_URL) return;
  ({ autoUpdater } = require('electron-updater'));
  if (process.env.CORTEX_UPDATE_URL) autoUpdater.setFeedURL({ provider: 'generic', url: process.env.CORTEX_UPDATE_URL });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true; // «Al cerrar»: se instala al salir
  autoUpdater.logger = null;
  autoUpdater.on('checking-for-update', () => sendUpdate({ status: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdate({ status: 'downloading', version: info.version, percent: 0 }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ ...updateState, status: 'downloading', percent: p.percent }));
  autoUpdater.on('update-not-available', () => sendUpdate({ status: 'latest' }));
  autoUpdater.on('update-downloaded', (info) => sendUpdate({ status: 'ready', version: info.version }));
  autoUpdater.on('error', (err) => sendUpdate({ status: 'error', message: String(err?.message || err).split('\n')[0] }));
  // Unos segundos después de arrancar, para no competir con la carga del proyecto.
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 4000);
}
ipcMain.handle('update:check', async () => {
  if (!autoUpdater) return { status: 'unavailable' };
  if (updateState.status === 'downloading' || updateState.status === 'ready') return updateState;
  manualCheck = true;
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // el error llega también por el evento
  }
  return updateState;
});
ipcMain.handle('update:state', () => updateState);
ipcMain.handle('app:version', () => app.getVersion());
// Reiniciar e instalar. Si hay cambios sin guardar, primero la pregunta de siempre al cerrar.
ipcMain.handle('update:install', () => {
  if (!autoUpdater || updateState.status !== 'ready') return;
  installOnClose = true;
  if (mainWindow) mainWindow.close();
});
let installOnClose = false;

ipcMain.handle('screen:count', () => screen.getAllDisplays().length);

// ---- Descargas de YouTube (ver youtube.js) ----
// El estado de la instalación/actualización de yt-dlp y el progreso de la descarga llegan por `youtube:progress`.
const sendYoutube = (p) => mainWindow?.webContents.send('youtube:progress', p);
ipcMain.handle('youtube:info', async (_e, url, playlist) => {
  await youtube.ensure(sendYoutube);
  return youtube.info(url, playlist);
});
ipcMain.handle('youtube:download', async (_e, opts) => {
  await youtube.ensure(sendYoutube);
  return youtube.download(opts, sendYoutube);
});
ipcMain.handle('youtube:cancel', () => youtube.cancel());
ipcMain.handle('youtube:defaultDir', () => app.getPath('downloads'));
// ---- Compresor de video (ver compressor.js) ----
// Progreso por `compress:progress`. Las muestras de 10 s se pueden abrir en el reproductor del sistema
// (`compress:openSample`, solo las que ha creado el compresor) y se borran al salir.
const samples = new Set();
const sendCompress = (p) => mainWindow?.webContents.send('compress:progress', p);
ipcMain.handle('compress:encoders', () => compressor.availableEncoders());
ipcMain.handle('compress:inspect', (_e, file, settings) => compressor.inspect(file, settings));
ipcMain.handle('compress:run', (_e, file, settings) => compressor.compress(file, settings, sendCompress));
ipcMain.handle('compress:sample', async (_e, file, settings) => {
  const r = await compressor.sample(file, settings, (p) => sendCompress({ ...p, sample: true }));
  if (r.path) samples.add(r.path);
  return r;
});
ipcMain.handle('compress:cancel', () => compressor.cancel());
ipcMain.handle('compress:openSample', (_e, file) => (samples.has(file) ? shell.openPath(file) : null));
ipcMain.handle('compress:pick', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Videos para comprimir',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Videos', extensions: ['mp4', 'm4v', 'mov', 'mkv', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'ogv', 'vob', 'mxf'] }, { name: 'Todos los archivos', extensions: ['*'] }],
  });
  return res.canceled ? [] : res.filePaths;
});
app.on('will-quit', () => {
  for (const f of samples) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
});

ipcMain.handle('dialog:folder', async (_e, title, defaultPath) => {
  const res = await dialog.showOpenDialog(mainWindow, { title, defaultPath, properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0];
});

ipcMain.handle('shell:reveal', (_e, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('devtools:toggle', () => mainWindow && mainWindow.webContents.toggleDevTools());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('media', serveMedia);
  createWindow();
  setupUpdates();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (renderProcess) renderProcess.cancel();
  if (proxyProc) proxyProc.kill();
  youtube.cancel();
  compressor.cancel();
  // «Reiniciar y actualizar»: el instalador (sin preguntas) sustituye la aplicación y la vuelve a abrir.
  if (installOnClose && autoUpdater) autoUpdater.quitAndInstall(true, true);
  else if (process.platform !== 'darwin') app.quit();
});
