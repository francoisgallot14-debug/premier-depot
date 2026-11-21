// Fabrication du jeu en un seul fichier (hors ligne) :
//   dist/royaume.html  : page complète, s'ouvre directement (file://)
//   dist/artifact.html : la même chose en « fragment » pour l'hébergement claude.ai
// Les deux sortent du même gabarit : le balisage vient d'index.html (entre les marqueurs),
// le style de src/ui/style.css, le script de src/main.js (+ three.js) regroupé par esbuild.
import { build, transform } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(RACINE, 'dist');
const LIMITE = 1.1 * 1024 * 1024; // taille visée par fichier (polices comprises)
const TITRE = 'Projet Royaume';

// 1. Script : un seul IIFE minifié (aucun module, aucun chargement externe)
const js = await build({
  entryPoints: [join(RACINE, 'src', 'main.js')],
  bundle: true,
  format: 'iife',
  minify: true,
  target: ['es2020'],
  platform: 'browser',
  legalComments: 'none',
  write: false,
  logLevel: 'warning',
});
// un « </script » dans le code fermerait la balise trop tôt
const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script').trim();

// 2. Style : le même fichier qu'en développement, minifié. Les polices (assets/fonts/) y entrent
//    en data: (base64) : le jeu les a même hors ligne, sans aucune requête.
let fontes = 0;
const styleSource = readFileSync(join(RACINE, 'src', 'ui', 'style.css'), 'utf8')
  .replace(/url\((['"]?)\.\.\/\.\.\/assets\/fonts\/([\w.-]+\.woff2)\1\)/g, (_, _q, nom) => {
    fontes++;
    return `url(data:font/woff2;base64,${readFileSync(join(RACINE, 'assets', 'fonts', nom)).toString('base64')})`;
  });
const css = (await transform(styleSource, { loader: 'css', minify: true })).code.trim();
// garde-fou : rien ne doit partir sur le réseau (le jeu se joue hors ligne)
if (/@import|url\(\s*['"]?(https?:)?\/\//i.test(css)) throw new Error('style.css : ressource externe (@import ou url distante) interdite');
if (fontes === 0) throw new Error('style.css : polices de assets/fonts/ introuvables');

// 3. Balisage partagé avec index.html
const index = readFileSync(join(RACINE, 'index.html'), 'utf8');
const m = index.match(/<!-- balisage:debut -->([\s\S]*?)<!-- balisage:fin -->/);
if (!m) throw new Error('index.html : marqueurs « balisage:debut / balisage:fin » introuvables');
const balisage = m[1].trim();

/** Gabarit unique : les mêmes morceaux (style, balisage, script) dans les deux sorties. */
function page(complet) {
  const style = `<style>${css}</style>`;
  const corps = `${balisage}\n<script>${script}</script>\n`;
  if (!complet) {
    // fragment : pas de doctype/html/head/body ; titre et méta d'abord, puis style, balisage, script
    return `<title>${TITRE}</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${style}\n${corps}`;
  }
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#0b1119">
<meta name="description" content="Jeu de gestion médiéval et défense par vagues, en 3D, hors ligne.">
<title>${TITRE}</title>
${style}
</head>
<body>
${corps}</body>
</html>
`;
}

mkdirSync(DIST, { recursive: true });
const sorties = [
  ['royaume.html', page(true)],
  ['artifact.html', page(false)],
];
let trop = false;
for (const [nom, contenu] of sorties) {
  writeFileSync(join(DIST, nom), contenu);
  const n = Buffer.byteLength(contenu);
  const ko = (n / 1024).toFixed(1);
  const ok = n <= LIMITE;
  if (!ok) trop = true;
  console.log(`${ok ? 'OK ' : 'TROP'} dist/${nom.padEnd(14)} ${ko.padStart(8)} Ko`);
}
console.log(`     (script ${(script.length / 1024).toFixed(1)} Ko, style ${(css.length / 1024).toFixed(1)} Ko dont ${fontes} polices)`);
if (trop) {
  console.error(`Un fichier dépasse ${(LIMITE / 1024 / 1024).toFixed(1)} Mo.`);
  process.exit(1);
}
