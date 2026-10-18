const { app, BrowserWindow, ipcMain, dialog, protocol, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const ff = require('./ffmpeg');

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
  mainWindow.on('closed', () => {
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
  return info;
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
  // Copia de seguridad, como el .veg.bak de VEGAS: la versión anterior del archivo queda en «.bak».
  try {
    await fs.promises.copyFile(target, `${target}.bak`);
  } catch {
    // archivo nuevo: no hay versión anterior
  }
  await fs.promises.writeFile(target, JSON.stringify(data, null, 2), 'utf8');
  return target;
});

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

ipcMain.handle('project:open', async () => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Abrir proyecto',
    properties: ['openFile'],
    filters: PROJECT_FILTERS,
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  return { path: filePath, data: JSON.parse(await fs.promises.readFile(filePath, 'utf8')) };
});

ipcMain.handle('render:pickPath', async (_e, defaultName) => {
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Renderizar como',
    defaultPath: defaultName || 'Video.mp4',
    filters: [{ name: 'Video MP4 (H.264/AAC)', extensions: ['mp4'] }],
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
    return { ok: true };
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

ipcMain.handle('shell:reveal', (_e, filePath) => shell.showItemInFolder(filePath));
ipcMain.handle('devtools:toggle', () => mainWindow && mainWindow.webContents.toggleDevTools());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle('media', serveMedia);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (renderProcess) renderProcess.cancel();
  if (process.platform !== 'darwin') app.quit();
});
