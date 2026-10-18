// Descarga fuentes de Google Fonts (woff2, subconjunto latino) a public/fonts y escribe la lista en
// src/state/font-list.json. Uso: node scripts/get-fonts.js . (para añadir una fuente: ponerla en FAMILIES)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = process.argv[2];
const outDir = path.join(root, 'public', 'fonts');
fs.mkdirSync(outDir, { recursive: true });
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const FAMILIES = {
  'Sin serifa': ['Roboto', 'Open Sans', 'Montserrat', 'Poppins', 'Lato', 'Raleway', 'Nunito', 'Inter', 'Work Sans', 'Rubik', 'Barlow'],
  'Titulares': ['Oswald', 'Bebas Neue', 'Anton', 'Archivo Black', 'Righteous', 'Russo One', 'Black Ops One', 'Bangers', 'Bungee', 'Alfa Slab One', 'Lilita One', 'Luckiest Guy', 'Teko'],
  'Con serifa': ['Playfair Display', 'Merriweather', 'Lora', 'Abril Fatface', 'Cinzel', 'Roboto Slab', 'Libre Baskerville'],
  'Manuscritas': ['Pacifico', 'Lobster', 'Dancing Script', 'Great Vibes', 'Caveat', 'Satisfy', 'Permanent Marker', 'Kaushan Script', 'Shadows Into Light', 'Amatic SC', 'Indie Flower'],
  'Retro y técnicas': ['Roboto Mono', 'Press Start 2P', 'VT323', 'Orbitron', 'Monoton', 'Audiowide', 'Creepster', 'Special Elite'],
};

async function css(query) {
  const res = await fetch(`https://fonts.googleapis.com/css2?family=${query}&display=swap`, { headers: { 'User-Agent': UA } });
  return res.ok ? res.text() : null;
}

(async () => {
  const list = [];
  const licenses = [];
  for (const [category, families] of Object.entries(FAMILIES)) {
    for (const family of families) {
      const q = family.replace(/ /g, '+');
      const text = (await css(`${q}:ital,wght@0,400;0,700;1,400;1,700`)) || (await css(`${q}:wght@400;700`)) || (await css(q));
      if (!text) {
        console.log('NO', family);
        continue;
      }
      const faces = [];
      for (const m of text.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*@font-face\s*\{([^}]*)\}/g)) {
        if (m[1] !== 'latin') continue;
        const body = m[2];
        const style = /font-style:\s*(\w+)/.exec(body)[1];
        const weight = /font-weight:\s*(\d+)/.exec(body)[1];
        const url = /url\((https:[^)]+)\)/.exec(body)[1];
        const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1];
        const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
        const name = `${family.replace(/ /g, '')}-${crypto.createHash('md5').update(url).digest('hex').slice(0, 8)}.woff2`;
        fs.writeFileSync(path.join(outDir, name), buf);
        faces.push({ style, weight: Number(weight), file: name, range });
      }
      list.push({ family, category, faces });
      // Licencia (OFL casi todas; algunas Apache) desde el repositorio de Google Fonts.
      const dir = family.toLowerCase().replace(/ /g, '');
      let lic = null;
      for (const [kind, file] of [['ofl', 'OFL.txt'], ['apache', 'LICENSE.txt'], ['ufl', 'UFL.txt']]) {
        const res = await fetch(`https://raw.githubusercontent.com/google/fonts/main/${kind}/${dir}/${file}`);
        if (res.ok) {
          lic = { kind, text: await res.text() };
          break;
        }
      }
      licenses.push({ family, lic });
      console.log(family, faces.map((f) => `${f.style[0]}${f.weight}`).join(' '), lic ? lic.kind : 'SIN LICENCIA');
    }
  }
  fs.writeFileSync(path.join(root, 'src', 'state', 'font-list.json'), `${JSON.stringify(list, null, 1)}\n`);
  let out = 'Fuentes incluidas en Cortex Studio (de Google Fonts, https://fonts.google.com).\n' +
    'Cada una se distribuye con su licencia, copiada a continuación.\n\n';
  for (const { family, lic } of licenses) {
    out += `${'='.repeat(78)}\n${family} (${lic ? { ofl: 'SIL Open Font License 1.1', apache: 'Apache License 2.0', ufl: 'Ubuntu Font Licence' }[lic.kind] : 'ver fonts.google.com'})\n${'='.repeat(78)}\n\n${lic ? lic.text.trim() : ''}\n\n`;
  }
  fs.writeFileSync(path.join(outDir, 'LICENCIAS.txt'), out);
  const total = fs.readdirSync(outDir).reduce((s, f) => s + fs.statSync(path.join(outDir, f)).size, 0);
  console.log('total', (total / 1024 / 1024).toFixed(2), 'MB');
})();
