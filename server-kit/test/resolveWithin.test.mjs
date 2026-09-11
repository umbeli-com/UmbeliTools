import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveWithin, resolveWithinOrThrow, AppError } from '@umbeli-com/server-kit';

const ROOT = path.resolve('/srv/sites/abc');

test('resolves an ordinary relative path inside the root', () => {
  assert.equal(resolveWithin(ROOT, 'assets/logo.png'), path.join(ROOT, 'assets/logo.png'));
  assert.equal(resolveWithin(ROOT, '/index.html'), path.join(ROOT, 'index.html'));
  assert.equal(resolveWithin(ROOT, './a/../b.txt'), path.join(ROOT, 'b.txt'));
});

test('the root itself is allowed', () => {
  assert.equal(resolveWithin(ROOT, ''), ROOT);
  assert.equal(resolveWithin(ROOT, '/'), ROOT);
  assert.equal(resolveWithin(ROOT, '.'), ROOT);
});

test('a literal .. cannot climb out', () => {
  assert.equal(resolveWithin(ROOT, '../../../etc/passwd'), null);
  assert.equal(resolveWithin(ROOT, 'assets/../../../../etc/passwd'), null);
});

test('percent-encoded traversal is decoded and refused — Express hands us BOTH forms', () => {
  // Express decodes req.params, so a handler can receive the already-decoded
  // '../'. But req.path is NOT decoded, so the same attack also arrives raw.
  assert.equal(resolveWithin(ROOT, '%2e%2e/%2e%2e/etc/passwd'), null);
  assert.equal(resolveWithin(ROOT, '..%2f..%2fetc%2fpasswd'), null);
  assert.equal(resolveWithin(ROOT, '%2E%2E%2F%2E%2E%2Fetc'), null);
  // Double-encoded: nginx decodes once on every deployed env, so this reaches
  // the app as the single-encoded form above.
  assert.equal(resolveWithin(ROOT, '%252e%252e%252fetc'), null);
});

test('an absolute candidate is defanged, not honoured', () => {
  // path.resolve(root, '/etc/passwd') would return '/etc/passwd' — the reason
  // the candidate is normalised through path.posix against a fake root first.
  assert.equal(resolveWithin(ROOT, '/etc/passwd'), path.join(ROOT, 'etc/passwd'));
});

test('a sibling directory sharing the root prefix is NOT inside the root', () => {
  // The classic off-by-one: startsWith(root) alone accepts '/srv/sites/abc-evil'.
  assert.equal(resolveWithin('/srv/sites/abc', '../abc-evil/secret'), null);
  assert.equal(resolveWithin('/srv/sites/abc', '/../abc-evil'), null);
});

test('a NUL byte is refused (it truncates the path inside libc)', () => {
  assert.equal(resolveWithin(ROOT, 'logo.png\u0000.txt'), null);
  assert.equal(resolveWithin(ROOT, 'logo.png%00.txt'), null);
});

test('a malformed escape is refused rather than guessed at', () => {
  assert.equal(resolveWithin(ROOT, '%zz'), null);
  assert.equal(resolveWithin(ROOT, '100%'), null);
});

test('non-string input never reaches fs', () => {
  assert.equal(resolveWithin(ROOT, undefined), null);
  assert.equal(resolveWithin(ROOT, null), null);
  assert.equal(resolveWithin(undefined, 'a.txt'), null);
  assert.equal(resolveWithin(ROOT, ['../etc']), null);
});

test('a relative root is resolved against cwd before the containment test', () => {
  const resolved = resolveWithin('sites/abc', 'a.txt');
  assert.equal(resolved, path.join(path.resolve('sites/abc'), 'a.txt'));
});

test('resolveWithinOrThrow throws a 400 AppError that does not echo the path back', () => {
  assert.equal(resolveWithinOrThrow(ROOT, 'ok.txt'), path.join(ROOT, 'ok.txt'));
  try {
    resolveWithinOrThrow(ROOT, '../../etc/passwd');
    assert.fail('should have thrown');
  } catch (err) {
    assert.ok(err instanceof AppError);
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, 'BAD_REQUEST');
    assert.ok(!err.message.includes('passwd'));
  }
});
