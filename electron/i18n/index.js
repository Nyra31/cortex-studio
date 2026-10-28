// Idioma de la aplicación. Los textos se escriben en español en el código, envueltos en tx('…'), y el texto en
// español es la clave: cada <idioma>.json de esta carpeta da su traducción (si falta, se ve el español). Las
// variables van entre llaves: tx('Invirtiendo «{name}»…', { name }). Una clave puede llevar un contexto tras «|»
// para distinguir dos traducciones del mismo texto (tx('I|izquierda')); el contexto no se muestra.
// El proceso principal decide el idioma al arrancar (el elegido en Ayuda → Idioma, guardado en userData/idioma.json,
// o el del sistema) y la interfaz lo lee de él (preload.js). Cambiarlo reinicia la aplicación.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

// Los mismos que LANGUAGES en src/i18n/index.js.
const DICTS = {
  en: require('./en.json'),
  fr: require('./fr.json'),
  de: require('./de.json'),
  it: require('./it.json'),
  pt: require('./pt.json'),
};
const LANGUAGES = ['es', ...Object.keys(DICTS)];
const settingsPath = () => path.join(app.getPath('userData'), 'idioma.json');

// El primero de los idiomas preferidos del sistema que tengamos; si no hay ninguno, inglés.
function systemLanguage() {
  let tags = [];
  try {
    tags = app.getPreferredSystemLanguages();
  } catch {
    // versiones sin esta función: la configuración regional de ICU
  }
  if (!tags.length) tags = [Intl.DateTimeFormat().resolvedOptions().locale || ''];
  return tags.map((t) => t.toLowerCase().split(/[-_]/)[0]).find((id) => LANGUAGES.includes(id)) || 'en';
}

function detect() {
  try {
    const saved = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')).lang;
    if (LANGUAGES.includes(saved)) return saved;
  } catch {
    // sin elegir todavía
  }
  return systemLanguage();
}

const lang = detect();
const dict = DICTS[lang] || null;

function tx(text, vars) {
  let s = (dict && dict[text]) || text.replace(/\|.*$/s, '');
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return process.platform === 'darwin' ? s.replace(/\b(Ctrl|Strg)\b/g, 'Cmd') : s; // atajos de macOS (ver src/i18n)
}

function saveLanguage(value) {
  if (!LANGUAGES.includes(value)) throw new Error(`Idioma desconocido: ${value}`);
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify({ lang: value }));
}

module.exports = { LANGUAGES, lang, tx, saveLanguage };
