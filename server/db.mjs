import pg from 'pg';
const { Pool } = pg;

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL })
  : null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS plans (
  name                    TEXT PRIMARY KEY,
  max_recetas_month       INT  NOT NULL DEFAULT 10,
  max_bonos_month         INT  NOT NULL DEFAULT 10,
  max_transcriptions_month INT NOT NULL DEFAULT 20
);

INSERT INTO plans(name, max_recetas_month, max_bonos_month, max_transcriptions_month)
VALUES
  ('free', 10,   10,   20),
  ('pro',  9999, 9999, 9999)
ON CONFLICT(name) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  device_id  TEXT        PRIMARY KEY,
  plan       TEXT        NOT NULL DEFAULT 'free' REFERENCES plans(name),
  notes      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS usage (
  id         BIGSERIAL   PRIMARY KEY,
  device_id  TEXT        NOT NULL,
  action     TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_lookup
  ON usage(device_id, action, created_at);
`;

export async function setupDb() {
  if (!pool) {
    console.log('[db] DATABASE_URL not set — limits disabled');
    return;
  }
  try {
    await pool.query(SCHEMA);
    console.log('[db] schema ready');
  } catch (err) {
    console.error('[db] setup error', err.message);
  }
}

export async function checkAndRecord(deviceId, action) {
  if (!pool || !deviceId) return;

  try {
    await pool.query(
      `INSERT INTO users(device_id) VALUES($1) ON CONFLICT DO NOTHING`,
      [deviceId]
    );

    const { rows } = await pool.query(
      `SELECT p.max_recetas_month, p.max_bonos_month, p.max_transcriptions_month
       FROM users u JOIN plans p ON u.plan = p.name
       WHERE u.device_id = $1`,
      [deviceId]
    );

    if (rows.length === 0) return;

    const limits = rows[0];
    const limitKey =
      action === 'receta' ? 'max_recetas_month' :
      action === 'bono'   ? 'max_bonos_month' :
                            'max_transcriptions_month';
    const max = limits[limitKey];

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS count FROM usage
       WHERE device_id = $1 AND action = $2
         AND created_at >= date_trunc('month', NOW())`,
      [deviceId, action]
    );

    const count = parseInt(countRows[0].count, 10);
    if (count >= max) {
      const label =
        action === 'receta' ? 'análisis de recetas' :
        action === 'bono'   ? 'análisis de bonos' :
                              'transcripciones';
      const err = new Error(
        `Límite mensual alcanzado: ${count}/${max} ${label}. Contacta soporte para ampliar tu plan.`
      );
      err.code = 'LIMIT_EXCEEDED';
      throw err;
    }

    await pool.query(
      `INSERT INTO usage(device_id, action) VALUES($1, $2)`,
      [deviceId, action]
    );
  } catch (err) {
    if (err.code === 'LIMIT_EXCEEDED') throw err;
    console.error('[db] checkAndRecord error', err.message);
  }
}
