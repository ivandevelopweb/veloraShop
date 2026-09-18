import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'

type RunOptions = { env?: NodeJS.ProcessEnv; capture?: boolean }

function run(command: string, args: string[], options: RunOptions = {}) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: options.env ?? process.env,
      shell: false,
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve(stdout)
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code}: ${stderr}`))
    })
  })
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitForPostgres(container: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await run(
        'docker',
        ['exec', container, 'pg_isready', '-U', 'velora_test', '-d', 'velora_test'],
        {
          capture: true,
        },
      )
      return
    } catch {
      await sleep(500)
    }
  }
  throw new Error('Timed out waiting for the isolated PostgreSQL test database')
}

const nonce = randomBytes(12).toString('hex')
const container = `velora-integration-${process.pid}-${nonce}`
const databasePassword = randomBytes(24).toString('base64url')
const testPassword = `Velora${randomBytes(12).toString('hex')}9`
const liqpayPrivateKey = randomBytes(32).toString('base64url')
let started = false

try {
  await run('docker', [
    'run',
    '--rm',
    '--detach',
    '--name',
    container,
    '--env',
    'POSTGRES_USER=velora_test',
    '--env',
    `POSTGRES_PASSWORD=${databasePassword}`,
    '--env',
    'POSTGRES_DB=velora_test',
    '--publish',
    '127.0.0.1::5432',
    'postgres:16-alpine',
  ])
  started = true
  await waitForPostgres(container)
  const portOutput = await run('docker', ['port', container, '5432/tcp'], { capture: true })
  const port = /:(\d+)\s*$/m.exec(portOutput)?.[1]
  if (!port) throw new Error('Could not determine PostgreSQL test port')
  const databaseUrl = `postgresql://velora_test:${databasePassword}@127.0.0.1:${port}/velora_test`
  const legacyDatabaseUrl = `postgresql://velora_test:${databasePassword}@127.0.0.1:${port}/velora_legacy`
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    CLIENT_ORIGINS: 'http://localhost:5173',
    CSRF_SECRET: randomBytes(32).toString('base64url'),
    SESSION_COOKIE_SECURE: 'false',
    COOKIE_SAME_SITE: 'lax',
    LIQPAY_PUBLIC_KEY: 'sandbox_test_public',
    LIQPAY_PRIVATE_KEY: liqpayPrivateKey,
    LIQPAY_SANDBOX: 'true',
    LIQPAY_CALLBACK_URL: 'https://example.test/api/payments/liqpay/callback',
    PAYMENT_RESERVATION_MINUTES: '15',
    PAYMENT_RECONCILIATION_GRACE_MINUTES: '10',
    GEMINI_API_KEY: '',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    GEMINI_TIMEOUT_MS: '2000',
    TEST_PASSWORD: testPassword,
    ADMIN_EMAIL: 'test-admin@example.test',
    ADMIN_PASSWORD: testPassword,
    CLOUDINARY_CLOUD_NAME: '',
    CLOUDINARY_API_KEY: '',
    CLOUDINARY_API_SECRET: '',
  }
  await run('docker', ['exec', container, 'createdb', '-U', 'velora_test', 'velora_legacy'])
  const legacyEnvironment = { ...environment, DATABASE_URL: legacyDatabaseUrl }
  await run(
    process.execPath,
    [
      'node_modules/node-pg-migrate/bin/node-pg-migrate.js',
      '-m',
      'server/migrations',
      '--database-url',
      legacyDatabaseUrl,
      '--verbose=false',
      'up',
      '4',
    ],
    { env: legacyEnvironment },
  )
  await run(
    process.execPath,
    ['--import', 'tsx', '--test', 'server/test/legacy-migration.test.mts'],
    {
      env: legacyEnvironment,
    },
  )
  await run(
    process.execPath,
    [
      'node_modules/node-pg-migrate/bin/node-pg-migrate.js',
      '-m',
      'server/migrations',
      '--database-url',
      databaseUrl,
      '--verbose=false',
      'up',
    ],
    { env: environment },
  )
  await run(process.execPath, ['--import', 'tsx', '--test', 'server/test/integration.test.mts'], {
    env: environment,
  })
  await run(
    process.execPath,
    ['--import', 'tsx', '--test', 'server/test/assistant.integration.test.mts'],
    {
      env: environment,
    },
  )
} finally {
  if (started) await run('docker', ['rm', '--force', container]).catch(() => undefined)
}
