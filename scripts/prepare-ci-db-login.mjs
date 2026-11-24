import { randomBytes } from 'node:crypto';
import { appendFileSync, realpathSync } from 'node:fs';
import pg from 'pg';

if (process.env.GITHUB_ACTIONS !== 'true' || !process.env.GITHUB_ENV) {
  throw new Error('This command requires a GitHub Actions environment');
}

const adminUrl = new URL(process.env.DATABASE_URL);
if (adminUrl.hostname !== '127.0.0.1' || adminUrl.pathname !== '/orion') {
  throw new Error('Expected the disposable loopback CI database');
}

const client = new pg.Client({ connectionString: adminUrl.toString() });
await client.connect();
try {
  if (process.platform === 'win32') {
    const expected = process.env.ORION_PG_DATA;
    const { rows } = await client.query('SHOW data_directory');
    if (!expected || realpathSync(expected).toLowerCase() !== realpathSync(rows[0].data_directory).toLowerCase()) {
      throw new Error('PostgreSQL is not running from this job’s disposable cluster directory');
    }
  }

  const password = randomBytes(32).toString('hex');
  console.log('::add-mask::' + password);
  // Hex generation restricts this SQL literal to [0-9a-f].
  await client.query(`ALTER ROLE orion_app PASSWORD '${password}'`);
  adminUrl.username = 'orion_app';
  adminUrl.password = password;
  appendFileSync(process.env.GITHUB_ENV, `APP_DATABASE_URL=${adminUrl}\n`);
} finally {
  await client.end();
}
