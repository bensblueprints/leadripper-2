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
    const results = [];

    // 1. Credits ledger
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_credits (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES lr_users(id) ON DELETE CASCADE,
        balance INTEGER DEFAULT 0,
        lifetime_credits INTEGER DEFAULT 0,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id)
      )
    `);
    results.push('lr_credits created');

    // 2. Credit transactions log
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_credit_transactions (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES lr_users(id) ON DELETE CASCADE,
        amount INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        type VARCHAR(50) NOT NULL,
        description TEXT,
        reference_id VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_credit_transactions created');

    // 3. Indexes
    await pool.query('CREATE INDEX IF NOT EXISTS idx_credits_user ON lr_credits(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON lr_credit_transactions(user_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_credit_tx_type ON lr_credit_transactions(type)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_credit_tx_created ON lr_credit_transactions(created_at DESC)');
    results.push('indexes created');

    // 4. Seed free credits for existing users who don't have a credits row yet
    await pool.query(`
      INSERT INTO lr_credits (user_id, balance, lifetime_credits, updated_at)
      SELECT id, 50, 50, NOW()
      FROM lr_users
      WHERE id NOT IN (SELECT user_id FROM lr_credits)
    `);
    results.push('seeded existing users with 50 free credits');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Credits tables migrated successfully',
        results
      })
    };
  } catch (error) {
    console.error('Credits migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
