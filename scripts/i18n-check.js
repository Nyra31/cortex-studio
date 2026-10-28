// Comprueba las traducciones (electron/i18n/<idioma>.json) contra los textos del código: los tx('…') sin
// traducir, las traducciones que ya no se usan y las que no tienen las mismas variables {así} que el español.
// Uso: npm run i18n                  (informe de todos los idiomas; termina con error si falta algo)
//      npm run i18n -- --missing fr  (solo las claves que le faltan a ese idioma, en JSON, para traducirlas)
// Usa @babel/parser, que viene con @vitejs/plugin-react.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const parser = require('@babel/parser');

const root = path.join(__dirname, '..');
const dictDir = path.join(root, 'electron/i18n');
const dicts = Object.fromEntries(fs.readdirSync(dictDir).filter((f) => f.endsWith('.json'))
  .map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dictDir, f), 'utf8'))]));

// Textos del primer argumento de cada tx(): una cadena o las dos ramas de un ?: con cadenas.
function keysOf(node, out) {
  if (!node) return;
  if (node.type === 'StringLiteral') out.push(node.value);
  else if (node.type === 'TemplateLiteral' && !node.expressions.length) out.push(node.quasis[0].value.cooked);
  else if (node.type === 'ConditionalExpression') {
    keysOf(node.consequent, out);
    keysOf(node.alternate, out);
  } else out.push(null); // texto calculado: no se puede comprobar
}

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const k of Object.keys(node)) {
    if (k === 'loc' || k === 'start' || k === 'end') continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => walk(c, visit));
    else if (v && typeof v.type === 'string') walk(v, visit);
  }
}

const files = execSync('git ls-files --cached --others --exclude-standard src electron', { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter((f) => /\.(js|jsx)$/.test(f));
const used = new Map(); // clave → primer sitio donde aparece
const dynamic = [];
for (const f of files) {
  const src = fs.readFileSync(path.join(root, f), 'utf8');
  if (!/\btx\(/.test(src)) continue;
  const ast = parser.parse(src, { sourceType: /^\s*(import|export)\s/m.test(src) ? 'module' : 'script', plugins: ['jsx'] });
  walk(ast.program, (n) => {
    if (n.type !== 'CallExpression' || n.callee.type !== 'Identifier' || n.callee.name !== 'tx') return;
    const keys = [];
    keysOf(n.arguments[0], keys);
    for (const k of keys) {
      const where = `${f}:${n.loc.start.line}`;
      if (k === null) dynamic.push(where);
      else if (!used.has(k)) used.set(k, where);
    }
  });
}

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const check = (dict) => ({
  missing: [...used.keys()].filter((k) => typeof dict[k] !== 'string' || !dict[k]),
  unused: Object.keys(dict).filter((k) => !used.has(k)),
  mismatched: [...used.keys()].filter((k) => dict[k] && vars(k) !== vars(dict[k])),
});

const only = process.argv.indexOf('--missing');
if (only >= 0) {
  const { missing } = check(dicts[process.argv[only + 1] || 'en']);
  console.log(JSON.stringify(Object.fromEntries(missing.map((k) => [k, ''])), null, 2));
  process.exit(0);
}
console.log(`${used.size} textos.`);
let failed = false;
for (const [id, dict] of Object.entries(dicts)) {
  const { missing, unused, mismatched } = check(dict);
  console.log(`${id}: ${Object.keys(dict).length} traducciones.`);
  for (const k of missing) console.log(`  Falta:        ${JSON.stringify(k)}  (${used.get(k)})`);
  for (const k of mismatched) console.log(`  Variables:    ${JSON.stringify(k)} → ${JSON.stringify(dict[k])}`);
  for (const k of unused) console.log(`  Sin usar:     ${JSON.stringify(k)}`);
  if (missing.length || mismatched.length) failed = true;
}
for (const w of dynamic) console.log(`Calculado:    tx() con un texto que no es una cadena en ${w}`);
if (failed) process.exit(1);
