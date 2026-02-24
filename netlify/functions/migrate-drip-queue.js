const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const MIGRATION_SQL = `
-- Migration: Add GHL Drip Queue System and Marketing Emails
-- Date: 2026-02-24

-- 1. Create GHL Drip Queue Table
CREATE TABLE IF NOT EXISTS lr_ghl_queue (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
  lead_id BIGINT REFERENCES lr_leads(id) ON DELETE CASCADE,
  status VARCHAR(20) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  scheduled_for TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(lead_id)
);

CREATE INDEX IF NOT EXISTS idx_ghl_queue_user_status ON lr_ghl_queue(user_id, status);
CREATE INDEX IF NOT EXISTS idx_ghl_queue_scheduled ON lr_ghl_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_ghl_queue_processing ON lr_ghl_queue(status) WHERE status = 'pending';

-- 2. Create Marketing Emails Table (LeadRipper Prospects)
CREATE TABLE IF NOT EXISTS lr_marketing_emails (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  source VARCHAR(50) DEFAULT 'free_trial_gate',
  ip_address VARCHAR(45),
  user_agent TEXT,
  opted_in BOOLEAN DEFAULT true,
  subscribed_at TIMESTAMPTZ DEFAULT NOW(),
  unsubscribed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_marketing_emails_email ON lr_marketing_emails(email);
CREATE INDEX IF NOT EXISTS idx_marketing_emails_source ON lr_marketing_emails(source);

-- 3. Add drip settings columns to lr_user_settings
ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS ghl_drip_enabled BOOLEAN DEFAULT false;
ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS ghl_drip_interval INTEGER DEFAULT 15;
ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS ghl_stage_id VARCHAR(255);
ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS ghl_industry_pipelines TEXT;
ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS ghl_last_drip_at TIMESTAMPTZ;

-- 4. Add industry column to lr_leads if not exists
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS industry VARCHAR(100);

-- 5. Add email validation columns to lr_leads if not exists
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT false;
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_score INTEGER DEFAULT 0;
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_warnings TEXT;
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_validation_date TIMESTAMPTZ;
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS is_disposable BOOLEAN DEFAULT false;
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS is_role_based BOOLEAN DEFAULT false;
ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
`;

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    console.log('Running GHL Drip Queue migration...');

    // Execute migration SQL
    await pool.query(MIGRATION_SQL);

    console.log('Migration completed successfully');

    // Verify new tables exist
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('lr_ghl_queue', 'lr_marketing_emails')
      ORDER BY table_name
    `);

    // Check new columns in lr_user_settings
    const columnsResult = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'lr_user_settings'
      AND column_name IN ('ghl_drip_enabled', 'ghl_drip_interval', 'ghl_stage_id', 'ghl_last_drip_at')
    `);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'GHL Drip Queue migration completed successfully',
        newTables: tablesResult.rows.map(r => r.table_name),
        newColumns: columnsResult.rows.map(r => r.column_name)
      })
    };

  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Migration failed',
        message: error.message,
        detail: error.detail || null
      })
    };
  }
};
