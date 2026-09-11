/**
 * Service-level configuration.
 *
 * SCOPE: this file holds ONLY what the service itself needs to boot — port,
 * environment, the inter-service keys, the CORS allowlist and the rate-limit
 * knobs. Caller credentials (Anthropic, Mailjet, Twilio, Cloudflare, Gandi,
 * Meta…) are NEVER read here: every tool takes them per request in the body.
 *
 * FAIL FAST: `validateEnv()` used to `console.warn` and let the process boot
 * with no service key, so every request answered 500 CONFIG_ERROR while the
 * container still looked healthy (the Docker HEALTHCHECK only pings
 * `/api/health`, which is unauthenticated). A misconfigured deploy must refuse
 * to start instead.
 */

/** One accepted inter-service key, with the identity of the app that holds it. */
export interface ServiceKeyEntry {
  /** Caller identity, e.g. `webum`. Attached to the request and logged. */
  name: string;
  /** The shared secret itself. */
  key: string;
}

export interface EnvConfig {
  /**
   * Listening port. Falls back to 3002 when PORT is unparseable — and
   * `validateEnv()` then refuses to boot rather than binding a random port.
   */
  PORT: number;
  NODE_ENV: string;
  IS_PRODUCTION: boolean;
  /** Raw `UMBELIUM_SERVICE_KEY` value, kept for backward compatibility. */
  UMBELIUM_SERVICE_KEY: string;
  /** Parsed keys — this is what the auth middleware actually compares against. */
  SERVICE_KEYS: ServiceKeyEntry[];
  /** Browser origins allowed to call the API. Empty = server-to-server only. */
  CORS_ORIGINS: string[];
  /** Which env var CORS_ORIGINS came from, or null when none was set. */
  CORS_SOURCE: string | null;
  /** Sliding rate-limit window, in ms. */
  RATE_LIMIT_WINDOW_MS: number;
  /** Requests tolerated per key inside the window. */
  RATE_LIMIT_MAX: number;
  /** `app.set('trust proxy', …)` value — the service sits behind nginx-proxy. */
  TRUST_PROXY: boolean | number | string;
  /** Body-size cap handed to `express.json()`. */
  JSON_BODY_LIMIT: string;
  /** Set when PORT was present but unusable; surfaced by `validateEnv()`. */
  PORT_ERROR: string | null;
}

export const DEFAULT_PORT = 3002;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_RATE_LIMIT_MAX = 600;
const DEFAULT_JSON_BODY_LIMIT = '2mb';
/** Below this, a public-internet shared secret is worth warning about. */
const WEAK_KEY_LENGTH = 24;

/** A caller identity: short, printable, safe in a log line. */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

export class EnvValidationError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid service configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'EnvValidationError';
    this.problems = problems;
    Object.setPrototypeOf(this, EnvValidationError.prototype);
  }
}

/**
 * `PORT=abc` used to reach `parseInt` → NaN → `app.listen(NaN)` → Node binds a
 * RANDOM free port, the container passes its own healthcheck on 3002 only by
 * luck and nginx-proxy sends traffic nowhere. `Number()` (unlike `parseInt`)
 * also rejects `"3002abc"` instead of silently reading `3002`.
 */
export function parsePort(raw: string | undefined): { port: number; error: string | null } {
  if (raw === undefined || raw.trim() === '') return { port: DEFAULT_PORT, error: null };
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return {
      port: DEFAULT_PORT,
      error: `PORT must be an integer between 1 and 65535 (got ${JSON.stringify(raw)})`,
    };
  }
  return { port: value, error: null };
}

/**
 * `UMBELIUM_SERVICE_KEY` accepts either spelling:
 *
 *   UMBELIUM_SERVICE_KEY=s3cr3t                       → one key, caller "default"
 *   UMBELIUM_SERVICE_KEY=webum:s3cr3t,manager:0th3r   → two keys, named callers
 *
 * A `name:` prefix is only treated as a name when it looks like one, so a key
 * that happens to contain a colon is never silently cut in half.
 */
export function parseServiceKeys(raw: string | undefined): ServiceKeyEntry[] {
  if (!raw) return [];
  const entries: ServiceKeyEntry[] = [];
  const usedNames = new Set<string>();
  let unnamed = 0;

  for (const part of raw.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    let name: string | null = null;
    let key = trimmed;

    const colon = trimmed.indexOf(':');
    if (colon > 0) {
      const candidateName = trimmed.slice(0, colon);
      const candidateKey = trimmed.slice(colon + 1).trim();
      if (NAME_RE.test(candidateName) && candidateKey.length > 0) {
        name = candidateName;
        key = candidateKey;
      }
    }

    if (name === null) {
      unnamed += 1;
      name = unnamed === 1 ? 'default' : `default-${unnamed}`;
    }

    // Two entries claiming the same identity would make the log lie about who
    // called; disambiguate rather than drop one.
    let unique = name;
    let suffix = 2;
    while (usedNames.has(unique)) unique = `${name}-${suffix++}`;
    usedNames.add(unique);

    entries.push({ name: unique, key });
  }

  return entries;
}

/** `"a, b ,,b/"` → `["a","b"]` — trimmed, de-duplicated, trailing slash removed. */
function splitOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const value = part.trim().replace(/\/+$/, '');
    if (value) seen.add(value);
  }
  return [...seen];
}

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw.trim() === '') return 1; // nginx-proxy, one hop
  const trimmed = raw.trim();
  if (trimmed === 'false' || trimmed === '0') return false;
  if (trimmed === 'true') return true;
  const asNumber = Number(trimmed);
  if (Number.isInteger(asNumber) && asNumber >= 0) return asNumber;
  return trimmed; // 'loopback', a subnet, a comma list — Express parses these
}

/** Build a config object from any env-shaped source (tests pass their own). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const { port, error } = parsePort(source.PORT);
  const nodeEnv = source.NODE_ENV || 'development';

  const corsKeys = ['TOOLS_CORS_ORIGINS', 'CORS_ORIGINS', 'CORS_ORIGIN', 'FRONTEND_ORIGIN'];
  let corsSource: string | null = null;
  let corsOrigins: string[] = [];
  for (const key of corsKeys) {
    const parsed = splitOrigins(source[key]);
    if (parsed.length > 0) {
      corsSource = key;
      corsOrigins = parsed;
      break;
    }
  }

  return {
    PORT: port,
    PORT_ERROR: error,
    NODE_ENV: nodeEnv,
    IS_PRODUCTION: nodeEnv === 'production',
    UMBELIUM_SERVICE_KEY: source.UMBELIUM_SERVICE_KEY || '',
    SERVICE_KEYS: parseServiceKeys(source.UMBELIUM_SERVICE_KEY),
    CORS_ORIGINS: corsOrigins,
    CORS_SOURCE: corsSource,
    RATE_LIMIT_WINDOW_MS: parsePositiveInt(
      source.RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
    ),
    RATE_LIMIT_MAX: parsePositiveInt(source.RATE_LIMIT_MAX, DEFAULT_RATE_LIMIT_MAX),
    TRUST_PROXY: parseTrustProxy(source.TRUST_PROXY),
    JSON_BODY_LIMIT: source.JSON_BODY_LIMIT?.trim() || DEFAULT_JSON_BODY_LIMIT,
  };
}

export const ENV: EnvConfig = loadEnv();

/** Non-fatal observations — logged, never thrown. */
export function envWarnings(env: EnvConfig = ENV): string[] {
  const warnings: string[] = [];

  for (const entry of env.SERVICE_KEYS) {
    if (entry.key.length < WEAK_KEY_LENGTH) {
      warnings.push(
        `service key "${entry.name}" is only ${entry.key.length} chars — this one secret guards every provider credential the suite holds; use at least ${WEAK_KEY_LENGTH}`,
      );
    }
  }

  const byKey = new Map<string, string[]>();
  for (const entry of env.SERVICE_KEYS) {
    byKey.set(entry.key, [...(byKey.get(entry.key) ?? []), entry.name]);
  }
  for (const [, names] of byKey) {
    if (names.length > 1) {
      warnings.push(
        `callers ${names.join(', ')} share the same key — attribution in the logs cannot tell them apart`,
      );
    }
  }

  if (env.CORS_ORIGINS.length > 0) {
    warnings.push(
      `browser CORS is open to ${env.CORS_ORIGINS.join(', ')} (from ${env.CORS_SOURCE}) — the service key would have to ship in a browser bundle for that to be useful; prefer server-to-server calls`,
    );
  }

  return warnings;
}

/**
 * Throws `EnvValidationError` when the service cannot safely serve traffic.
 * Call it before `app.listen()` and let the process die — a container that
 * restart-loops on a bad env is far cheaper to diagnose than one that boots and
 * answers 500 to every caller.
 */
export function validateEnv(env: EnvConfig = ENV): void {
  const problems: string[] = [];

  if (env.PORT_ERROR) problems.push(env.PORT_ERROR);

  if (!env.UMBELIUM_SERVICE_KEY.trim()) {
    problems.push(
      'UMBELIUM_SERVICE_KEY is not set — the service is publicly exposed and this key is the only barrier in front of every provider credential',
    );
  } else if (env.SERVICE_KEYS.length === 0) {
    problems.push('UMBELIUM_SERVICE_KEY is set but contains no usable key (only separators?)');
  }

  for (const warning of envWarnings(env)) console.warn(`[env] ${warning}`);

  if (problems.length > 0) throw new EnvValidationError(problems);
}
