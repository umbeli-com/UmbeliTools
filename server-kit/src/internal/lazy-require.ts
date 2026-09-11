/**
 * Runtime module loading that works in BOTH build outputs.
 *
 * server-kit ships the same source twice (dist/cjs + dist/esm). A static
 * `import` of an optional peer (`ws`, `@supabase/supabase-js`) would be
 * evaluated at module load in both formats — crashing consumers that installed
 * neither. So the two optional peers are pulled in lazily, through a `require`
 * that is resolved differently per format:
 *
 *   - CJS build: the real `require` is in scope, resolution is relative to the
 *     installed copy of server-kit (correct in every layout, including
 *     hoisting-hostile pnpm trees).
 *   - ESM build: `require` does not exist and `import.meta` cannot be emitted
 *     by the CommonJS pass, so we seed `createRequire()` from the consumer's
 *     entry script (`process.argv[1]`) — i.e. resolution walks up from THEIR
 *     app, which is where the optional peer is installed.
 */

import { createRequire } from 'node:module';

let cachedRequires: NodeRequire[] | null = null;

function candidateRequires(): NodeRequire[] {
  if (cachedRequires) return cachedRequires;

  // `typeof` on an undeclared identifier is safe — no ReferenceError in ESM.
  if (typeof require === 'function') {
    cachedRequires = [require];
    return cachedRequires;
  }

  const seeds: NodeRequire[] = [];
  // The consumer's entry script first, their working directory second: a
  // process started by a runner (tsx, a test harness, `npm exec`) can have an
  // argv[1] that sits outside the project, and then only cwd finds their deps.
  for (const base of [process.argv[1], `${process.cwd()}/__server-kit__.js`]) {
    if (!base) continue;
    try {
      seeds.push(createRequire(base));
    } catch {
      /* unusable seed — try the next one */
    }
  }
  cachedRequires = seeds;
  return cachedRequires;
}

/**
 * True when the failure is "this module is not installed here", as opposed to
 * "the module is installed and blew up while being evaluated".
 *
 * The distinction matters: reporting the second kind as a MISSING module sends
 * whoever is on call to `npm install` a package that is already there.
 */
function isModuleNotFound(err: unknown, specifier: string): boolean {
  const e = err as { code?: unknown; message?: unknown } | null;
  const code = typeof e?.code === 'string' ? e.code : '';
  if (code !== 'MODULE_NOT_FOUND' && code !== 'ERR_MODULE_NOT_FOUND') return false;
  // A require() *inside* the dependency fails with the same code; only a
  // failure naming the specifier itself means "not installed here".
  const message = typeof e?.message === 'string' ? e.message : '';
  return message.includes(`'${specifier}'`) || message.includes(`"${specifier}"`);
}

/** Attempt every candidate base. Returns the module, or the last real error. */
function tryLoad<T>(specifier: string): { module: T } | { module: null; error: unknown } {
  let lastError: unknown = null;
  for (const req of candidateRequires()) {
    try {
      return { module: req(specifier) as T };
    } catch (err) {
      // Not resolvable from this base — try the next one. Anything else is the
      // module itself failing, and is worth reporting verbatim.
      if (!isModuleNotFound(err, specifier)) lastError = err;
    }
  }
  return { module: null, error: lastError };
}

/** Load a module, or return null if it is not installed. Never throws. */
export function loadOptionalModule<T = unknown>(specifier: string): T | null {
  return tryLoad<T>(specifier).module;
}

/** Load a module, or throw an error that names the missing peer. */
export function loadRequiredModule<T = unknown>(specifier: string, why: string): T {
  const result = tryLoad<T>(specifier);
  if (result.module) return result.module;
  // An installed-but-broken module must NOT be reported as a missing one, or
  // the fix looks like `npm install` when it is really a build/version problem.
  if ('error' in result && result.error) throw result.error;
  throw new Error(
    `[server-kit] "${specifier}" is required to ${why}, but it is not installed. ` +
      `Run: npm install ${specifier}`,
  );
}

/**
 * Unwrap an interop default. `require('ws')` hands back the class directly,
 * but a transpiled/ESM-interop copy hands back `{ default: ... }`.
 */
export function interopDefault<T>(mod: unknown): T {
  const m = mod as { default?: unknown } | null;
  if (m && typeof m === 'object' && 'default' in m && m.default) return m.default as T;
  return mod as T;
}
