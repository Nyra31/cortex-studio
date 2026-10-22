// Crea la release de GitHub de la versión de package.json y sube el instalador, su .blockmap y latest.yml.
// Las notas salen de la sección de esa versión en CHANGELOG.md. El token es el de Git Credential Manager.
// Uso, después de `npm run dist`, el commit y `git push origin main vX.Y.Z`: node scripts/publicar-release.mjs
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = 'Nyra31/cortex-studio';
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = `v${version}`;
const files = [`Cortex-Studio-Setup-${version}.exe`, `Cortex-Studio-Setup-${version}.exe.blockmap`, 'latest.yml'];
for (const f of files) {
  if (!fs.existsSync(path.join(root, 'release', f))) throw new Error(`Falta release/${f} (¿npm run dist?)`);
}

const changelog = fs.readFileSync(path.join(root, 'CHANGELOG.md'), 'utf8');
const section = changelog.split(/^## /m).find((s) => s.startsWith(`${version} `) || s.startsWith(`${version}\n`));
if (!section) throw new Error(`CHANGELOG.md no tiene sección «## ${version}»`);
const body = `## Novedades\n\n${section.slice(section.indexOf('\n') + 1).trim()}\n\nLos proyectos de versiones anteriores se siguen abriendo.`;

const cred = execSync('git credential fill', { input: 'protocol=https\nhost=github.com\n\n' }).toString();
const token = cred.match(/^password=(.*)$/m)?.[1];
if (!token) throw new Error('No hay token de GitHub en Git Credential Manager');
const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'cortex-release' };

const api = async (url, opts = {}) => {
  const res = await fetch(url, { ...opts, headers: { ...headers, ...(opts.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url}\n${text}`);
  return JSON.parse(text);
};

const rel = await api(`https://api.github.com/repos/${repo}/releases`, {
  method: 'POST',
  body: JSON.stringify({ tag_name: tag, name: `Cortex Studio ${version}`, body, draft: false, prerelease: false }),
});
console.log('release', rel.html_url);
for (const f of files) {
  const data = fs.readFileSync(path.join(root, 'release', f));
  const up = await api(`https://uploads.github.com/repos/${repo}/releases/${rel.id}/assets?name=${encodeURIComponent(f)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(data.length) },
    body: data,
  });
  console.log('subido', up.name, up.size);
}
