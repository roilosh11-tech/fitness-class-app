import pg from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is not set. In Railway: add a Postgres service and reference ${{Postgres.DATABASE_URL}}.');

export const pool = new pg.Pool({
  connectionString: url,
  ssl: /localhost|127\.0\.0\.1|railway\.internal/.test(url) ? false : { rejectUnauthorized: false },
  max: 10,
});

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0];
export const many = async (text, params) => (await pool.query(text, params)).rows;

// Run fn inside a transaction; fn receives a client with the same q/one/many helpers.
export async function tx(fn) {
  const c = await pool.connect();
  const h = { q: (t, p) => c.query(t, p), one: async (t, p) => (await c.query(t, p)).rows[0], many: async (t, p) => (await c.query(t, p)).rows };
  try { await c.query('begin'); const r = await fn(h); await c.query('commit'); return r; }
  catch (e) { await c.query('rollback'); throw e; }
  finally { c.release(); }
}

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

export async function migrate() {
  await q('create table if not exists _migrations (name text primary key, run_at timestamptz default now())');
  const done = new Set((await many('select name from _migrations')).map(r => r.name));
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = await fs.readFile(path.join(dir, f), 'utf8');
    await tx(async (t) => { await t.q(sql); await t.q('insert into _migrations(name) values ($1)', [f]); });
    console.log('migrated', f);
  }
}
