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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    // Create OAuth states table for secure OAuth flow
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_oauth_states (
        state_token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        provider VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL
      )
    `);

    // Create auto-call queue table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_auto_call_queue (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        lead_id INTEGER NOT NULL,
        agent_id INTEGER NOT NULL,
        phone_number VARCHAR(50) NOT NULL,
        scheduled_at TIMESTAMP NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        priority VARCHAR(20) DEFAULT 'normal',
        purpose VARCHAR(50) DEFAULT 'collect_email',
        business_hours JSONB,
        attempts INTEGER DEFAULT 0,
        last_attempt_at TIMESTAMP,
        outcome VARCHAR(50),
        call_log_id INTEGER,
        email_collected VARCHAR(255),
        error_message TEXT,
        completed_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create indexes for auto-call queue
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_lr_auto_call_queue_user_status ON lr_auto_call_queue(user_id, status);
      CREATE INDEX IF NOT EXISTS idx_lr_auto_call_queue_scheduled ON lr_auto_call_queue(scheduled_at) WHERE status = 'pending';
    `);

    // Add new columns to lr_leads for email collection tracking
    await pool.query(`
      ALTER TABLE lr_leads
      ADD COLUMN IF NOT EXISTS email_source VARCHAR(50),
      ADD COLUMN IF NOT EXISTS email_collected_at TIMESTAMP,
      ADD COLUMN IF NOT EXISTS decision_maker_name VARCHAR(255),
      ADD COLUMN IF NOT EXISTS business_hours JSONB,
      ADD COLUMN IF NOT EXISTS place_id VARCHAR(255)
    `);

    // Add new columns to lr_call_logs for extracted data
    await pool.query(`
      ALTER TABLE lr_call_logs
      ADD COLUMN IF NOT EXISTS extracted_data JSONB,
      ADD COLUMN IF NOT EXISTS metadata JSONB
    `);

    // Add new columns to lr_user_settings for auto-call and follow-up
    await pool.query(`
      ALTER TABLE lr_user_settings
      ADD COLUMN IF NOT EXISTS auto_followup_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS followup_agent_id INTEGER,
      ADD COLUMN IF NOT EXISTS auto_call_enabled BOOLEAN DEFAULT false,
      ADD COLUMN IF NOT EXISTS auto_call_agent_id INTEGER,
      ADD COLUMN IF NOT EXISTS google_places_api_key VARCHAR(255)
    `);

    // Add 'collect_email' and 'reach_decision_maker' to valid agent goals
    // (This is informational - goals are validated in ai-agents.js)

    // Create calendar events table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_calendar_events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        deal_id INTEGER,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        start_time TIMESTAMP NOT NULL,
        end_time TIMESTAMP NOT NULL,
        attendee_email VARCHAR(255),
        attendee_phone VARCHAR(50),
        status VARCHAR(50) DEFAULT 'scheduled',
        external_id VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Clean up expired OAuth states
    await pool.query(`
      DELETE FROM lr_oauth_states WHERE expires_at < NOW()
    `);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Auto-call database setup completed successfully',
        tables: [
          'lr_oauth_states',
          'lr_auto_call_queue',
          'lr_calendar_events (if not exists)'
        ],
        columns_added: [
          'lr_leads: email_source, email_collected_at, decision_maker_name, business_hours, place_id',
          'lr_call_logs: extracted_data, metadata',
          'lr_user_settings: auto_followup_enabled, followup_agent_id, auto_call_enabled, auto_call_agent_id, google_places_api_key'
        ]
      })
    };

  } catch (error) {
    console.error('Auto-call DB setup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Database setup failed', message: error.message })
    };
  }
};
