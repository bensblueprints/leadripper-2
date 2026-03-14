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

    // 1. Lead Lists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_lead_lists (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_lead_lists created');

    // 2. Lead List Items
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_lead_list_items (
        id BIGSERIAL PRIMARY KEY,
        list_id BIGINT REFERENCES lr_lead_lists(id) ON DELETE CASCADE,
        lead_id BIGINT REFERENCES lr_leads(id) ON DELETE CASCADE,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(list_id, lead_id)
      )
    `);
    results.push('lr_lead_list_items created');

    // 3. Call Logs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_call_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        lead_id BIGINT REFERENCES lr_leads(id) ON DELETE SET NULL,
        list_id BIGINT REFERENCES lr_lead_lists(id) ON DELETE SET NULL,
        agent_id VARCHAR(255),
        elevenlabs_conversation_id VARCHAR(255),
        phone_number VARCHAR(50),
        contact_name VARCHAR(255),
        status VARCHAR(30) DEFAULT 'initiated',
        duration INTEGER DEFAULT 0,
        recording_url TEXT,
        transcript TEXT,
        outcome VARCHAR(50),
        email_collected VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_call_logs created');

    // 4. Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_lead_lists_user ON lr_lead_lists(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_lead_list_items_list ON lr_lead_list_items(list_id)',
      'CREATE INDEX IF NOT EXISTS idx_lead_list_items_lead ON lr_lead_list_items(lead_id)',
      'CREATE INDEX IF NOT EXISTS idx_call_logs_user ON lr_call_logs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_call_logs_lead ON lr_call_logs(lead_id)',
      'CREATE INDEX IF NOT EXISTS idx_call_logs_list ON lr_call_logs(list_id)',
      'CREATE INDEX IF NOT EXISTS idx_call_logs_conversation ON lr_call_logs(elevenlabs_conversation_id)'
    ];

    for (const indexQuery of indexes) {
      await pool.query(indexQuery);
    }
    results.push('All indexes created');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Lead lists and call logs tables created successfully',
        details: results
      })
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
