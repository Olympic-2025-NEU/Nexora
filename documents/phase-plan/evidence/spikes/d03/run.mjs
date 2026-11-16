// SPDX-License-Identifier: AGPL-3.0-only
// P00-D03: prove one PoolClient owns document + inventory + outbox writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const { Pool } = pg;
const connectionString = process.env.P00_DATABASE_URL;
if (!connectionString) throw new Error('Set P00_DATABASE_URL for disposable nexora_p00 DB');
const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5_000 });
const sql = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
const checksum = createHash('sha256').update(sql).digest('hex');

async function withTransaction(work) {
  const tx = await pool.connect();
  try {
    await tx.query('BEGIN');
    const result = await work(tx);
    await tx.query('COMMIT');
    return result;
  } catch (error) {
    await tx.query('ROLLBACK');
    throw error;
  } finally {
    tx.release();
  }
}

async function migrate() {
  await pool.query('CREATE SCHEMA IF NOT EXISTS p00_d03');
  await pool.query(`CREATE TABLE IF NOT EXISTS p00_d03.schema_migrations (
    version integer PRIMARY KEY, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  return withTransaction(async (tx) => {
    const row = await tx.query('SELECT checksum FROM p00_d03.schema_migrations WHERE version=1 FOR UPDATE');
    if (row.rowCount) {
      assert.equal(row.rows[0].checksum, checksum, 'modified migration must be rejected');
      return 'unchanged';
    }
    await tx.query(sql);
    await tx.query('INSERT INTO p00_d03.schema_migrations(version,checksum) VALUES(1,$1)', [checksum]);
    return 'applied';
  });
}

const documentRepository = {
  insert: (tx, id, quantity) => tx.query(
    "INSERT INTO p00_d03.document(id,kind,quantity) VALUES($1,'issue',$2)", [id, quantity],
  ),
};
const inventoryRepository = {
  issue: async (tx, quantity) => {
    const result = await tx.query(
      'UPDATE p00_d03.balance SET quantity=quantity-$1::numeric WHERE id=1 AND quantity >= $1::numeric RETURNING quantity',
      [quantity],
    );
    if (!result.rowCount) throw new Error('INSUFFICIENT_STOCK');
    return result.rows[0].quantity;
  },
};
const outboxRepository = {
  append: (tx, id, quantity) => tx.query(
    'INSERT INTO p00_d03.outbox(id,document_id,event_type,payload) VALUES($1,$1,$2,$3::jsonb)',
    [id, 'trading.issue.confirmed.v1', JSON.stringify({ documentId: id, quantity })],
  ),
};
const movementRepository = {
  insert: (tx, id, quantity, balanceAfter) => tx.query(
    'INSERT INTO p00_d03.movement(id,document_id,delta,balance_after) VALUES($1,$1,-$2::numeric,$3::numeric)',
    [id, quantity, balanceAfter],
  ),
};
const auditRepository = {
  append: (tx, id) => tx.query(
    "INSERT INTO p00_d03.audit(id,document_id,action) VALUES($1,$1,'issue.confirmed')", [id],
  ),
};

async function confirmIssue(id, quantity, injectFailure = false) {
  return withTransaction(async (tx) => {
    await documentRepository.insert(tx, id, quantity);
    const balanceAfter = await inventoryRepository.issue(tx, quantity);
    await movementRepository.insert(tx, id, quantity, balanceAfter);
    await auditRepository.append(tx, id);
    await outboxRepository.append(tx, id, quantity);
    if (injectFailure) throw new Error('INJECTED_AFTER_OUTBOX');
    return balanceAfter;
  });
}

async function snapshot() {
  const [balance, documents, movements, audits, outbox] = await Promise.all([
    pool.query('SELECT quantity FROM p00_d03.balance WHERE id=1'),
    pool.query('SELECT count(*)::integer AS n FROM p00_d03.document'),
    pool.query('SELECT count(*)::integer AS n FROM p00_d03.movement'),
    pool.query('SELECT count(*)::integer AS n FROM p00_d03.audit'),
    pool.query('SELECT count(*)::integer AS n FROM p00_d03.outbox'),
  ]);
  return { balance: balance.rows[0].quantity, documents: documents.rows[0].n, movements: movements.rows[0].n, audits: audits.rows[0].n, outbox: outbox.rows[0].n };
}

try {
  const db = await pool.query('SELECT current_database() AS name, current_setting(\'server_version\') AS version');
  assert.equal(db.rows[0].name, 'nexora_p00', 'refuse to touch a non-spike DB');
  const firstMigration = await migrate();
  assert.ok(['applied', 'unchanged'].includes(firstMigration));
  assert.equal(await migrate(), 'unchanged');
  await pool.query("UPDATE p00_d03.schema_migrations SET checksum=repeat('0',64) WHERE version=1");
  try {
    await assert.rejects(migrate(), /modified migration must be rejected/);
  } finally {
    await pool.query('UPDATE p00_d03.schema_migrations SET checksum=$1 WHERE version=1', [checksum]);
  }

  // Reset only inside the guarded disposable DB so this spike can be rerun.
  await pool.query('TRUNCATE p00_d03.outbox, p00_d03.audit, p00_d03.movement, p00_d03.document, p00_d03.balance');
  await pool.query("INSERT INTO p00_d03.balance(id,quantity) VALUES(1,'20.000')");
  const first = await snapshot();
  assert.deepEqual(first, { balance: '20.000', documents: 0, movements: 0, audits: 0, outbox: 0 });

  await assert.rejects(
    confirmIssue('00000000-0000-4000-8000-000000000001', '12', true),
    /INJECTED_AFTER_OUTBOX/,
  );
  assert.deepEqual(await snapshot(), first, 'all three writes must roll back');

  assert.equal(await confirmIssue('00000000-0000-4000-8000-000000000002', '12'), '8.000');
  assert.deepEqual(await snapshot(), { balance: '8.000', documents: 1, movements: 1, audits: 1, outbox: 1 });

  const contenders = await Promise.allSettled([
    confirmIssue('00000000-0000-4000-8000-000000000003', '5'),
    confirmIssue('00000000-0000-4000-8000-000000000004', '5'),
  ]);
  assert.equal(contenders.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(contenders.filter((x) => x.status === 'rejected' && x.reason.message === 'INSUFFICIENT_STOCK').length, 1);
  const final = await snapshot();
  assert.deepEqual(final, { balance: '3.000', documents: 2, movements: 2, audits: 2, outbox: 2 });
  console.log(JSON.stringify({ result: 'PASS', pgVersion: db.rows[0].version, migration: `${firstMigration}+rerun-unchanged+checksum-mismatch-rejected`, rollback: first, committed: final, concurrency: 'one-of-two' }));
} finally {
  await pool.end();
}
