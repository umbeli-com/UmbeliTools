/**
 * Stamps a `type` marker into each build output.
 *
 * The package root has no `"type"` field, so Node reads every `.js` file under
 * `dist/` as CommonJS by default — which would break `dist/esm`. A one-line
 * package.json inside each directory pins the format for that subtree, which is
 * what makes a plain `.js` extension safe in both builds (no .mjs/.cjs dance,
 * no duplicated source, no bundler).
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const marks = [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
];

for (const [dir, type] of marks) {
  const target = path.join(dist, dir);
  if (!fs.existsSync(target)) {
    console.error(`[server-kit] missing build output: ${target}`);
    process.exit(1);
  }
  fs.writeFileSync(
    path.join(target, 'package.json'),
    JSON.stringify({ type }, null, 2) + '\n',
  );
}

console.log('[server-kit] dual build stamped (dist/cjs = commonjs, dist/esm = module)');
