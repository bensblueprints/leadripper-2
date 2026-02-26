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

  const results = [];

  try {
    // ==========================================
    // SENT EMAILS TABLE (for cold outreach tracking)
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_sent_emails (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        lead_id BIGINT,
        email_account_id BIGINT,
        tracking_id VARCHAR(255) UNIQUE,
        to_email VARCHAR(255) NOT NULL,
        subject VARCHAR(500),
        body TEXT,
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        opened_at TIMESTAMPTZ,
        clicked_at TIMESTAMPTZ,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'sent',
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_sent_emails table');

    // Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sent_emails_user ON lr_sent_emails(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sent_emails_lead ON lr_sent_emails(lead_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sent_emails_tracking ON lr_sent_emails(tracking_id)`);
    results.push('Created indexes for lr_sent_emails');

    // Reset daily sends (function to be called by cron)
    await pool.query(`
      UPDATE lr_email_accounts SET sends_today = 0
      WHERE DATE(last_send_at) < CURRENT_DATE
    `);
    results.push('Reset daily email send counts');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Email tracking tables created successfully',
        results
      })
    };

  } catch (error) {
    console.error('Setup email DB error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error', message: error.message, results })
    };
  }
};
