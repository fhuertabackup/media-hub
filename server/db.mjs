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

CREATE TABLE IF NOT EXISTS recetas (
  id                BIGSERIAL PRIMARY KEY,
  device_id         TEXT NOT NULL REFERENCES users(device_id),
  photo_uri         TEXT,
  raw_text          TEXT NOT NULL,
  institution       TEXT,
  doctor_name       TEXT,
  doctor_license   TEXT,
  patient_name     TEXT,
  prescription_date DATE,
  indications     TEXT,
  medications     JSONB NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recetas_device ON recetas(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_recetas_patient ON recetas(patient_name);

CREATE TABLE IF NOT EXISTS bonos (
  id                   BIGSERIAL PRIMARY KEY,
  device_id            TEXT NOT NULL REFERENCES users(device_id),
  photo_uri            TEXT,
  raw_text             TEXT NOT NULL,
  provider             TEXT,
  numero_bono         TEXT,
  fecha_emision       DATE,
  fecha_atencion      DATE,
  beneficiario_nombre  TEXT,
  beneficiario_rut    TEXT,
  titular_nombre      TEXT,
  titular_rut         TEXT,
  prestador_nombre    TEXT,
  prestador_rut       TEXT,
  profesional_nombre  TEXT,
  profesional_rut     TEXT,
  items               JSONB NOT NULL,
  monto_total         INTEGER,
  bonificacion_total   INTEGER,
  copago_total        INTEGER,
  monto_a_pagar      INTEGER,
  confidence         REAL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bonos_device ON bonos(device_id, created_at);
CREATE INDEX IF NOT EXISTS idx_bonos_beneficiary ON bonos(beneficiario_rut);
CREATE INDEX IF NOT EXISTS idx_bonos_provider ON bonos(provider);
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

export async function saveReceta(deviceId, data) {
  if (!pool || !deviceId) return;
  if (!data) return;
  try {
    await pool.query(
      `INSERT INTO recetas(device_id, photo_uri, raw_text, institution, doctor_name, 
         doctor_license, patient_name, prescription_date, indications, medications)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        deviceId,
        data.photoUri || null,
        data.rawText || data.raw_text || '',
        data.institution || null,
        data.doctorName || data.doctor_name || null,
        data.doctorLicense || data.doctor_license || null,
        data.patientName || data.patient_name || null,
        data.date || data.prescription_date || null,
        data.indicationsGeneral || data.indications || null,
        JSON.stringify(data.medications || [])
      ]
    );
    console.log('[db] receta saved for device', deviceId);
  } catch (err) {
    console.error('[db] saveReceta error', err.message);
  }
}

export async function saveBono(deviceId, data) {
  if (!pool || !deviceId) return;
  if (!data) return;
  try {
    await pool.query(
      `INSERT INTO bonos(device_id, photo_uri, raw_text, provider, numero_bono,
         fecha_emision, fecha_atencion, beneficiario_nombre, beneficiario_rut,
         titular_nombre, titular_rut, prestador_nombre, prestador_rut,
         profesional_nombre, profesional_rut, items, monto_total, bonificacion_total,
         copago_total, monto_a_pagar, confidence)
       VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)`,
      [
        deviceId,
        data.photoUri || null,
        data.raw_text || '',
        data.provider || null,
        data.numero_bono || null,
        data.fecha_emision || null,
        data.fecha_atencion || null,
        data.beneficiario_nombre || null,
        data.beneficiario_rut || null,
        data.titular_nombre || null,
        data.titular_rut || null,
        data.prestador_nombre || null,
        data.prestador_rut || null,
        data.profesional_nombre || null,
        data.profesional_rut || null,
        JSON.stringify(data.items || []),
        parseInt(data.monto_total) || null,
        parseInt(data.bonificacion_total) || null,
        parseInt(data.copago_total) || null,
        parseInt(data.monto_a_pagar) || null,
        data.confidence || null
      ]
    );
    console.log('[db] bono saved for device', deviceId);
  } catch (err) {
    console.error('[db] saveBono error', err.message);
  }
}

export async function getRecetasHistory(deviceId, limit = 50) {
  if (!pool || !deviceId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, device_id, photo_uri, institution, doctor_name, patient_name, 
              prescription_date, medications, created_at
       FROM recetas
       WHERE device_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [deviceId, limit]
    );
    return rows;
  } catch (err) {
    console.error('[db] getRecetasHistory error', err.message);
    return [];
  }
}

export async function getBonosHistory(deviceId, limit = 50) {
  if (!pool || !deviceId) return [];
  try {
    const { rows } = await pool.query(
      `SELECT id, device_id, photo_uri, provider, numero_bono, fecha_emision,
              fecha_atencion, beneficiario_nombre, prestador_nombre, monto_total,
              monto_a_pagar, created_at
       FROM bonos
       WHERE device_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [deviceId, limit]
    );
    return rows;
  } catch (err) {
    console.error('[db] getBonosHistory error', err.message);
    return [];
  }
}

export async function getUsageSummary(deviceId) {
  if (!pool || !deviceId) return null;
  try {
    const { rows } = await pool.query(
      `SELECT 
         (SELECT COUNT(*) FROM recetas WHERE device_id = $1) as total_recetas,
         (SELECT COUNT(*) FROM bonos WHERE device_id = $1) as total_bonos,
         (SELECT COUNT(*) FROM usage WHERE device_id = $1 AND action = 'transcripcion') as total_transcripciones,
         (SELECT MIN(created_at) FROM recetas WHERE device_id = $1) as first_receta_at,
         (SELECT MAX(created_at) FROM recetas WHERE device_id = $1) as last_receta_at`,
      [deviceId]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[db] getUsageSummary error', err.message);
    return null;
  }
}
