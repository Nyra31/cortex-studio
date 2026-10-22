// Abre las ventanas de Cortex Studio en el monitor secundario (el usuario trabaja en el principal) y sin que
// Chromium deje de pintarlas. Hay que cargarlo antes de require('electron/main.js').
const { app, screen } = require('electron');

app.on('browser-window-created', (_e, win) => {
  const primary = screen.getPrimaryDisplay();
  const other = screen.getAllDisplays().find((d) => d.id !== primary.id);
  if (other) win.setBounds(other.workArea);
  win.webContents.setBackgroundThrottling(false);
});
