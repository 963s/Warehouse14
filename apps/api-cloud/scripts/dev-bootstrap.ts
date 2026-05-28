/**
 * dev-bootstrap.ts — "open my laptop, type one command, work" (Basel directive).
 *
 * Idempotent. Runs as part of `pnpm dev` BEFORE the Fastify server starts.
 * The whole point is to make the gap between `git clone` and "API answering
 * requests" ZERO manual steps.
 *
 * What it does, in order:
 *   1. Refuse to run in NODE_ENV=production. (Hard guard against accidental
 *      seeding of dev creds into prod.)
 *   2. Ensure the Postgres container is up:
 *        docker compose up -d postgres
 *      from infrastructure/docker/. If `docker` isn't available, prints the
 *      manual instructions and exits 1.
 *   3. Apply migrations 1..N via the warehouse14_migrator role IF the
 *      database is empty (idempotent — re-running on a populated DB is a
 *      no-op).
 *   4. Ensure a self-signed mTLS dev cert exists in
 *      `apps/api-cloud/dev-certs/`. Generates a fresh one if missing or if
 *      expiry is < 7 days away. Stores fingerprint as SHA-256 hex.
 *   5. Upsert the matching `devices` row keyed on `cert_serial = <fingerprint>`.
 *      Re-runs are no-ops thanks to `ON CONFLICT DO NOTHING`.
 *   6. Upsert Basel's Owner account (`basel@warehouse14.local`) and set
 *      its PIN to `0000` via @warehouse14/auth-pin (the production-blacklist
 *      explicitly does NOT apply here — dev seed only).
 *
 * Production-safety belt-and-braces:
 *   • The cert CN is `warehouse14-dev-*`; production rejects any cert with
 *     this CN at boot (see `src/lib/prod-safety.ts` — Phase 1.5).
 *   • The Owner email pattern `*@warehouse14.local` is a dev-only TLD.
 *   • The script logs every step so re-runs are debuggable from the terminal.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir, readFile as fsReadFile } from 'node:fs/promises';
// node-forge is CommonJS — Node 24's strict ESM resolver doesn't surface
// every nested export as a named ESM symbol. Default-import the whole
// module + destructure at runtime; this works on Node 18 / 20 / 22 / 24.
import forge from 'node-forge';
const { pki, md, util: forgeUtil } = forge;
import postgres, { type Sql } from 'postgres';

import { hashPin } from '@warehouse14/auth-pin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEV_CERTS_DIR = resolve(__dirname, '..', 'dev-certs');
const MIGRATIONS_DIR = resolve(REPO_ROOT, 'packages', 'db', 'migrations');
const DOCKER_COMPOSE_DIR = resolve(REPO_ROOT, 'infrastructure', 'docker');

const OWNER_EMAIL = 'basel@warehouse14.local';
const OWNER_NAME = 'Basel';
const OWNER_PIN = '0000';
const CERT_VALIDITY_DAYS = 90;
const CERT_RENEW_BEFORE_DAYS = 7;

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

function log(step: string, msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[dev-bootstrap] ${step}: ${msg}`);
}

function fatal(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[dev-bootstrap] FATAL: ${msg}`);
  process.exit(1);
}

// ────────────────────────────────────────────────────────────────────────
// 1. Production guard
// ────────────────────────────────────────────────────────────────────────
function refuseInProduction(): void {
  if (process.env.NODE_ENV === 'production') {
    fatal('dev-bootstrap.ts must NOT run in NODE_ENV=production');
  }
}

// ────────────────────────────────────────────────────────────────────────
// 2. Docker compose up -d postgres
// ────────────────────────────────────────────────────────────────────────
function ensurePostgresUp(): void {
  // Detect docker / docker compose plugin presence.
  const which = spawnSync('which', ['docker'], { encoding: 'utf8' });
  if (which.status !== 0) {
    log('docker', 'docker CLI not found — assuming caller manages Postgres manually');
    return;
  }

  if (!existsSync(resolve(DOCKER_COMPOSE_DIR, 'docker-compose.yml')) &&
      !existsSync(resolve(DOCKER_COMPOSE_DIR, 'compose.yml'))) {
    log('docker', `no compose file at ${DOCKER_COMPOSE_DIR} — skipping container start`);
    return;
  }

  // Check the postgres service status — `docker compose ps -q postgres` returns
  // the container id if it's running.
  const psResult = spawnSync(
    'docker',
    ['compose', '-f', resolve(DOCKER_COMPOSE_DIR, 'docker-compose.yml'), 'ps', '-q', 'postgres'],
    { encoding: 'utf8' },
  );
  if (psResult.stdout.trim().length > 0) {
    log('docker', 'postgres container already up');
    return;
  }

  log('docker', 'starting postgres container via docker compose up -d…');
  const up = spawnSync(
    'docker',
    ['compose', '-f', resolve(DOCKER_COMPOSE_DIR, 'docker-compose.yml'), 'up', '-d', 'postgres'],
    { stdio: 'inherit' },
  );
  if (up.status !== 0) {
    fatal('docker compose up -d postgres failed; check the output above');
  }

  // Wait up to 30 s for Postgres to accept connections.
  log('docker', 'waiting for postgres to be ready…');
  for (let i = 0; i < 30; i++) {
    const ready = spawnSync(
      'docker',
      [
        'compose', '-f', resolve(DOCKER_COMPOSE_DIR, 'docker-compose.yml'),
        'exec', '-T', 'postgres', 'pg_isready', '-U', 'warehouse14_migrator',
      ],
      { encoding: 'utf8' },
    );
    if (ready.status === 0) return;
    execSync('sleep 1');
  }
  fatal('postgres did not become ready in 30s');
}

// ────────────────────────────────────────────────────────────────────────
// 3. Apply migrations if empty
// ────────────────────────────────────────────────────────────────────────
async function applyMigrationsIfEmpty(sql: Sql): Promise<void> {
  const rows = await sql<{ exists: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'users'
    ) AS exists`;
  if (rows[0]?.exists) {
    log('migrations', 'users table exists — skipping migration apply');
    return;
  }

  log('migrations', 'fresh database — applying all migrations…');
  const all = await readdir(MIGRATIONS_DIR);
  const files = all.filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
  for (const file of files) {
    const text = await fsReadFile(resolve(MIGRATIONS_DIR, file), 'utf8');
    await sql.unsafe(text);
    log('migrations', `  ✓ applied ${file}`);
  }
}

// ────────────────────────────────────────────────────────────────────────
// 4. Self-signed dev cert
// ────────────────────────────────────────────────────────────────────────
interface DevCert {
  certPem: string;
  keyPem: string;
  fingerprintSha256Hex: string;
}

function loadOrGenerateDevCert(): DevCert {
  mkdirSync(DEV_CERTS_DIR, { recursive: true });
  const certPath = resolve(DEV_CERTS_DIR, 'dev-client.crt');
  const keyPath = resolve(DEV_CERTS_DIR, 'dev-client.key');

  // Check existing cert validity.
  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = pki.certificateFromPem(readFileSync(certPath, 'utf8'));
      const daysLeft = (cert.validity.notAfter.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
      if (daysLeft > CERT_RENEW_BEFORE_DAYS) {
        const fp = computeCertFingerprint(cert);
        log('cert', `using existing dev cert (expires in ${Math.round(daysLeft)} days, fp=${fp.slice(0, 16)}…)`);
        return {
          certPem: readFileSync(certPath, 'utf8'),
          keyPem: readFileSync(keyPath, 'utf8'),
          fingerprintSha256Hex: fp,
        };
      }
      log('cert', `existing cert expires in ${Math.round(daysLeft)} days — regenerating`);
    } catch (err) {
      log('cert', `failed to parse existing cert — regenerating (${(err as Error).message})`);
    }
  }

  log('cert', `generating fresh self-signed cert valid ${CERT_VALIDITY_DAYS} days…`);
  const keys = pki.rsa.generateKeyPair(2048);
  const cert = pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01' + Date.now().toString(16);
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date(Date.now() + CERT_VALIDITY_DAYS * 24 * 60 * 60_000);

  const attrs = [
    { name: 'commonName', value: `warehouse14-dev-${process.platform}-${process.arch}` },
    { name: 'organizationName', value: 'Warehouse14 (dev)' },
    { name: 'countryName', value: 'DE' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs); // self-signed
  cert.sign(keys.privateKey, md.sha256.create());

  const certPem = pki.certificateToPem(cert);
  const keyPem = pki.privateKeyToPem(keys.privateKey);
  writeFileSync(certPath, certPem, { mode: 0o600 });
  writeFileSync(keyPath, keyPem, { mode: 0o600 });

  const fp = computeCertFingerprint(cert);
  log('cert', `  ✓ written ${certPath} (fp=${fp.slice(0, 16)}…)`);
  return { certPem, keyPem, fingerprintSha256Hex: fp };
}

function computeCertFingerprint(cert: pki.Certificate): string {
  const der = forgeUtil.encode64(pki.pemToDer(pki.certificateToPem(cert)).getBytes());
  // SHA-256 of the DER encoding, hex string lowercase — matches the
  // `Cf-Client-Cert-Sha256` shape that Cloudflare Access sends in prod.
  return createHash('sha256').update(Buffer.from(der, 'base64')).digest('hex');
}

// ────────────────────────────────────────────────────────────────────────
// 5. Upsert dev device row + 6. Upsert Owner with PIN 0000
// ────────────────────────────────────────────────────────────────────────
async function seedDevDeviceAndOwner(sql: Sql, fingerprint: string): Promise<void> {
  // 5. Upsert the device row first (Owner is paired_by_user_id of the device,
  //    but the FK is users → devices, so we insert user → device → re-link).
  //
  // We use a two-step pattern:
  //   • Upsert user (gets an id).
  //   • Upsert device with paired_by_user_id = user.id.

  // Hash the PIN once.
  const pinHash = await hashPin(OWNER_PIN);

  await sql.begin(async (tx) => {
    // Look up existing user.
    const existing = await tx<{ id: string; is_owner: boolean }[]>`
      SELECT id, is_owner FROM users WHERE email = ${OWNER_EMAIL}`;

    let userId: string;
    if (existing.length === 0) {
      const inserted = await tx<{ id: string }[]>`
        INSERT INTO users (
          email, email_verified, name, role, is_owner,
          pos_pin_hash, pos_pin_set_at
        ) VALUES (
          ${OWNER_EMAIL}, TRUE, ${OWNER_NAME}, 'ADMIN'::user_role, TRUE,
          ${pinHash}, now()
        )
        RETURNING id`;
      userId = inserted[0]!.id;
      log('seed', `  ✓ created Owner user ${OWNER_EMAIL} (id=${userId.slice(0, 8)}…) with PIN ${OWNER_PIN}`);
    } else {
      userId = existing[0]!.id;
      // Refresh PIN hash + clear any lockout from previous dev sessions.
      await tx`
        UPDATE users SET
          pos_pin_hash = ${pinHash},
          pos_pin_set_at = now(),
          pos_pin_failed_attempts = 0,
          pos_pin_locked_until = NULL
        WHERE id = ${userId}`;
      log('seed', `  ✓ refreshed Owner ${OWNER_EMAIL} PIN to ${OWNER_PIN} (cleared any lockout)`);
    }

    // Upsert the dev device. cert_serial is UNIQUE — ON CONFLICT DO NOTHING.
    await tx`
      INSERT INTO devices (
        device_class, cert_serial, cert_issued_at, cert_expires_at, paired_by_user_id, status
      ) VALUES (
        'POS_TERMINAL'::device_class,
        ${fingerprint},
        now(),
        now() + ${`${CERT_VALIDITY_DAYS} days`}::interval,
        ${userId},
        'active'::device_status
      )
      ON CONFLICT (cert_serial) DO UPDATE SET
        cert_expires_at = EXCLUDED.cert_expires_at,
        paired_by_user_id = EXCLUDED.paired_by_user_id,
        status = 'active'::device_status`;
    log('seed', `  ✓ upserted dev device with fingerprint ${fingerprint.slice(0, 16)}…`);
  });
}

// ────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  log('start', `Warehouse14 dev-bootstrap — NODE_ENV=${process.env.NODE_ENV ?? 'development'}`);
  refuseInProduction();

  ensurePostgresUp();

  // Connect as migrator (which exists from the docker initdb step).
  const migratorUrl =
    process.env.MIGRATOR_DATABASE_URL ??
    'postgres://warehouse14_migrator:warehouse14_migrator_dev_pw@localhost:5432/warehouse14';
  const sql = postgres(migratorUrl, { max: 1, onnotice: () => {} });

  try {
    await applyMigrationsIfEmpty(sql);
    const cert = loadOrGenerateDevCert();
    await seedDevDeviceAndOwner(sql, cert.fingerprintSha256Hex);
    log('done', '✓ dev environment ready. Run `pnpm dev` (server next).');
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[dev-bootstrap] fatal:', err);
  process.exit(1);
});
