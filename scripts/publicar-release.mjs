// Crea la release de GitHub de la versión de package.json y sube lo que haya de esa versión en release/: el
// instalador de Windows, su .blockmap y latest.yml (obligatorios) y, si están, los de macOS (.dmg, .zip,
// latest-mac.yml) y Linux (.AppImage, latest-linux.yml). Se crea como borrador y se publica al final, para que las
// actualizaciones automáticas no vean la versión sin sus archivos. Las notas salen de CHANGELOG.md.
// Token: GITHUB_TOKEN (GitHub Actions, ver .github/workflows/instalador.yml) o el de Git Credential Manager.
// Uso a mano, después de `npm run dist`, el commit y `git push origin main vX.Y.Z`: node scripts/publicar-release.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'Nyra31/cortex-studio';
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;
const required = [`Cortex-Studio-Setup-${version}.exe`, `Cortex-Studio-Setup-${version}.exe.blockmap`, 'latest.yml'];
const files = fs.readdirSync(path.join(root, 'release')).filter((f) => required.includes(f) || /^latest-(mac|linux)\.yml$/.test(f)
  || (f.startsWith(`Cortex-Studio-${version}-`) && /\.(dmg|zip|AppImage|blockmap)$/.test(f)));
for (const f of required) {
  if (!fs.existsSync(path.join(root, 'release', f))) throw new Error(`Falta release/${f} (¿npm run dist?)`);
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`));
if (!section) throw new Error(`CHANGELOG.md no tiene sección «## ${version}»`);
const body = `## Novedades\n\n${section.slice(section.indexOf('\n') + 1).trim()}\n\nLos proyectos de versiones anteriores se siguen abriendo.`;

const token = process.env.GITHUB_TOKEN
  || execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' }).toString().match(/^password=(.*)$/m)?.[1];
if (!token) throw new Error('No hay token de GitHub (GITHUB_TOKEN o git credential fill)');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cortex-release' };

const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}\n${text}`);
  return JSON.parse(text);
};

const rel = await api(`https://api.github.com/repos/${repo}/releases`, {
  method: 'POST',
  body: JSON.stringify({ tag_name: tag, name: `Cortex Studio ${version}`, body, draft: true, prerelease: false }),
});
console.log('borrador', rel.html_url, files.join(', '));
for (const f of files) {
  const data = fs.readFileSync(path.join(root, 'release', f));
  const up = await api(`https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(f)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) },
    body: data,
  });
  console.log('subido', up.name, up.size);
}
const done = await api(`https://api.github.com/repos/${repo}/releases/${rel.id}`, { method: 'PATCH', body: JSON.stringify({ draft: false }) });
console.log('publicada', done.html_url);
