// Lanza Electron con la aplicación quitando ELECTRON_RUN_AS_NODE: algunos programas (por ejemplo, VS Code y
// sus terminales) la definen, y con ella Electron arranca como Node y la aplicación no se abre.
const { spawn } = require('child_process');
const electron = require('electron'); // desde Node, la ruta del ejecutable

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, process.argv.slice(2), { stdio: 'inherit', env });
child.on('close', (code) => process.exit(code ?? 0));
