const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_email_accounts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        provider VARCHAR(20) NOT NULL DEFAULT 'imap',
        email_address VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        imap_host VARCHAR(255),
        imap_port INTEGER DEFAULT 993,
        smtp_host VARCHAR(255),
        smtp_port INTEGER DEFAULT 587,
        username VARCHAR(255),
        password TEXT,
        is_active BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        last_tested_at TIMESTAMPTZ,
        test_error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON lr_email_accounts(user_id)
    `);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'lr_email_accounts table created' })
    };
  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
