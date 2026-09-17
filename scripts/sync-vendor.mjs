#!/usr/bin/env node
/**
 * Pousse @umbeli-com/server-kit et @umbeli-com/tools dans les backends de la suite.
 *
 *   node scripts/sync-vendor.mjs            # build + pousse partout
 *   node scripts/sync-vendor.mjs --check    # ne touche à rien, sort en 1 si dérive
 *   node scripts/sync-vendor.mjs --add <chemin-du-backend>   # câble une nouvelle app
 *   node scripts/sync-vendor.mjs --app Profilum            # une seule app (préfixe du chemin)
 *
 * Pourquoi vendoriser plutôt qu'installer depuis GitHub Packages : AUCUN backend
 * de la suite n'a d'auth registry au moment du `docker build`. Le Dockerfile de
 * Monitorum va jusqu'à faire `rm -f .npmrc` avec le commentaire « avoids npm
 * asking for a GITHUB_TOKEN that is not available at build time ». Les packages
 * @umbeli-com/{ui,auth,layout,billing} vivent déjà sous `vendor/` pour cette
 * raison exacte ; server-kit et le SDK suivent la même route.
 *
 * Le jour où les builds Docker sauront s'authentifier, ces copies redeviennent
 * un simple filet hors-ligne et les `file:` redeviennent des plages de version.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, resolve, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SUITE_ROOT = resolve(REPO_ROOT, '..', 'Umbelium')

/** Les deux packages publiés depuis ce repo, et le dossier vendor qu'ils occupent. */
const PACKAGES = [
  { name: '@umbeli-com/server-kit', dir: 'server-kit', vendor: 'umbeli-server-kit' },
  { name: '@umbeli-com/tools', dir: 'client', vendor: 'umbeli-tools' },
]

/** Champs qui appartiennent à la source canonique ; les deps restent locales. */
const OWNED_FIELDS = ['version', 'description', 'type', 'main', 'module', 'types', 'exports', 'files', 'peerDependencies', 'engines']

const SKIP = new Set(['node_modules', 'dist', '.git', '.claude', 'build', 'coverage', 'vendor', '.next'])

const argv = process.argv.slice(2)
const CHECK = argv.includes('--check')
const ADD = argv.includes('--add') ? argv[argv.indexOf('--add') + 1] : null
// Même option que le sync-vendor d'UmbeliumComponents : synchroniser une app
// sans toucher les repos où quelqu'un travaille déjà (ou un agent).
const ONLY_APP = argv.includes('--app') ? argv[argv.indexOf('--app') + 1] : null

const C = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
const c = (k, s) => `${C[k]}${s}${C.off}`

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')) } catch { return null } }
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

function manifests(dir, out = [], depth = 0) {
  if (depth > 5) return out
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    if (e.isFile() && e.name === 'package.json') out.push(join(dir, e.name))
    else if (e.isDirectory() && !SKIP.has(e.name) && !e.name.startsWith('.')) manifests(join(dir, e.name), out, depth + 1)
  }
  return out
}

/** Backends qui déclarent l'un de nos packages en `file:`. */
function discoverTargets() {
  const targets = []
  for (const manifest of manifests(SUITE_ROOT)) {
    const pkg = readJson(manifest)
    if (!pkg) continue
    for (const spec of PACKAGES) {
      const declared = pkg.dependencies?.[spec.name] ?? pkg.devDependencies?.[spec.name]
      if (typeof declared !== 'string' || !declared.startsWith('file:')) continue
      const dir = resolve(dirname(manifest), declared.slice(5))
      targets.push({ spec, dir, app: relative(SUITE_ROOT, dirname(manifest)) || '.', consumer: manifest })
    }
  }
  return targets.sort((a, b) => a.app.localeCompare(b.app))
}

/** `--checksum` : sans lui un simple rebuild ferait passer chaque copie pour dérivée. */
function rsync(from, to, write) {
  const args = ['-a', '--checksum', '--delete', '--itemize-changes', '--exclude', 'node_modules', '--exclude', '.DS_Store']
  if (!write) args.push('--dry-run')
  args.push(from.replace(/\/?$/, '/'), to.replace(/\/?$/, '/'))
  return run('rsync', args, REPO_ROOT).split('\n').filter((l) => /^[<>c*]/.test(l))
}

if (ADD) {
  const manifestPath = resolve(ADD, 'package.json')
  const pkg = readJson(manifestPath)
  if (!pkg) { console.error(c('red', `Aucun package.json dans ${ADD}`)); process.exit(1) }
  pkg.dependencies ||= {}
  for (const spec of PACKAGES) pkg.dependencies[spec.name] = `file:vendor/${spec.vendor}`
  writeFileSync(manifestPath, JSON.stringify(pkg, null, 2) + '\n')
  console.log(c('green', `✓ ${ADD} déclare maintenant les deux packages en file:vendor/`))
  console.log(c('dim', '  → lancer `node scripts/sync-vendor.mjs` puis `npm install` dans l\'app.'))
  process.exit(0)
}

const targets = discoverTargets().filter((t) => !ONLY_APP || t.app === ONLY_APP || t.app.startsWith(`${ONLY_APP}/`))
if (!targets.length) {
  console.log(c('yellow', '\nAucun backend ne déclare encore ces packages.'))
  console.log(c('dim', '  → node scripts/sync-vendor.mjs --add ../Umbelium/<App>/backend\n'))
  process.exit(0)
}

if (!CHECK) {
  for (const spec of PACKAGES) {
    process.stdout.write(c('dim', `build ${spec.dir}… `))
    run('npm', ['run', 'build'], join(REPO_ROOT, spec.dir))
    console.log(c('green', '✓'))
  }
  console.log()
}

let drifted = 0
let synced = 0

for (const t of targets) {
  const source = join(REPO_ROOT, t.spec.dir)
  const changes = []

  if (!CHECK) mkdirSync(join(t.dir, 'dist'), { recursive: true })
  if (existsSync(join(source, 'dist')) && (CHECK ? existsSync(join(t.dir, 'dist')) : true)) {
    const items = rsync(join(source, 'dist'), join(t.dir, 'dist'), !CHECK)
    if (items.length) changes.push(`dist/ ${items.length} fichier(s)`)
  }

  const canon = readJson(join(source, 'package.json'))
  const targetPkgPath = join(t.dir, 'package.json')
  const existing = readJson(targetPkgPath) ?? { name: t.spec.name }
  const merged = { ...existing }
  for (const field of OWNED_FIELDS) {
    if (canon[field] === undefined) delete merged[field]
    else merged[field] = canon[field]
  }
  merged.name = t.spec.name
  if (JSON.stringify(existing) !== JSON.stringify(merged)) {
    changes.push('package.json')
    if (!CHECK) writeFileSync(targetPkgPath, JSON.stringify(merged, null, 2) + '\n')
  }

  if (changes.length) { drifted++; console.log(`  ${c('yellow', t.spec.vendor.padEnd(18))} ${t.app.padEnd(26)} ${changes.join(', ')}`) }
  else synced++
}

console.log()
console.log(c('bold', `${targets.length} copie(s) : ${synced} à jour, ${drifted} ${CHECK ? 'en dérive' : 'mise(s) à jour'}.`))

if (CHECK && drifted) {
  console.log(c('red', '\n✗ Des copies ont dérivé de la source canonique.'))
  console.log(c('dim', '  → node scripts/sync-vendor.mjs, puis committer chaque repo touché.\n'))
  process.exit(1)
}
if (!CHECK && drifted) console.log(c('dim', `\n→ Committer les repos d'app touchés.`))
