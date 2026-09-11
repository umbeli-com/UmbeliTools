/**
 * Path-traversal guard.
 *
 * Straight from Webum's `apps/api/src/index.ts` (the version that survived a
 * real audit), plus the two hardenings its comment asks for but does not do:
 * percent-decoding and a NUL check.
 *
 * Why the shape it has:
 *   - Node does NOT normalise `req.url`, so `..` reaches `path.join` intact and
 *     climbs out of the site directory.
 *   - Express DOES decode `req.params`, so `%2e%2e%2f` arrives as `../` — a
 *     guard that only looks for a literal `..` in the raw URL misses it.
 *   - Normalising through `path.posix` keeps `..` VISIBLE, so an escape is
 *     refused (null) rather than silently rewritten into a path inside the
 *     root that then 404s — the caller wants to answer 400 and log it.
 *   - A leading `/` is stripped rather than resolved, because `req.path` is
 *     always '/something' and must not override `root` in `path.resolve`.
 *   - The containment test compares against `root + path.sep`, not `root`, so
 *     `/var/data-evil` is not accepted as being "inside" `/var/data`.
 */

import path from 'node:path';
import { BadRequestError } from '../http/errors.js';

/**
 * Resolve `candidate` under `root`.
 *
 * @returns the absolute path inside `root`, or `null` if it escapes (the caller
 *          answers 400/404 — never let a `null` fall through to `fs`).
 */
export function resolveWithin(root: string, candidate: string): string | null {
  if (typeof root !== 'string' || typeof candidate !== 'string') return null;

  let decoded = candidate;
  if (decoded.includes('%')) {
    try {
      // Double-decoding is deliberate: nginx decodes once for us on deployed
      // envs, so `%252e%252e` reaches the app as `%2e%2e`.
      decoded = decodeURIComponent(decoded);
      if (decoded.includes('%')) {
        try {
          decoded = decodeURIComponent(decoded);
        } catch {
          /* one round was enough — keep it */
        }
      }
    } catch {
      // Malformed escape (`%zz`, a lone `%`): refuse rather than guess.
      return null;
    }
  }

  // A NUL truncates the path inside libc — `a.txt\0.png` opens `a.txt`.
  if (decoded.includes('\0')) return null;

  // On Windows a backslash is a separator; on POSIX it is a legal filename
  // character, so only fold it where it can actually traverse.
  if (path.sep === '\\') decoded = decoded.replace(/\\/g, '/');

  // Leading slashes are dropped, NOT resolved: `req.path` is '/index.html' and
  // must mean root/index.html, while '/etc/passwd' must not mean the real one.
  const relative = path.posix.normalize(decoded.replace(/^\/+/, ''));

  // Webum's original collapsed '..' against a fake root, which silently
  // REWROTE '../../etc/passwd' into '<root>/etc/passwd' and served a 404
  // instead of refusing. Normalising without an anchor keeps the '..' visible,
  // so a genuine escape attempt is reported to the caller as one.
  if (relative === '..' || relative.startsWith('../')) return null;

  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);

  // Belt and braces: catches what normalisation cannot see — a Windows drive
  // letter, and the '/var/data-evil' vs '/var/data' prefix trap (hence
  // `root + path.sep`, never a bare startsWith(root)).
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) return null;
  return target;
}

/**
 * `resolveWithin`, but throwing a 400 `AppError` — for handlers that funnel
 * everything into `errorHandler()`. The offending path is NOT echoed back.
 */
export function resolveWithinOrThrow(root: string, candidate: string): string {
  const resolved = resolveWithin(root, candidate);
  if (resolved === null) throw new BadRequestError('Invalid path');
  return resolved;
}
