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

    // 1. CRM Pipelines
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_pipelines (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_crm_pipelines created');

    // 2. CRM Stages
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_stages (
        id BIGSERIAL PRIMARY KEY,
        pipeline_id BIGINT REFERENCES lr_crm_pipelines(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        position INTEGER DEFAULT 0,
        color VARCHAR(20) DEFAULT '#4a9eff',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_crm_stages created');

    // 3. CRM Deals
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_deals (
        id BIGSERIAL PRIMARY KEY,
        pipeline_id BIGINT REFERENCES lr_crm_pipelines(id) ON DELETE CASCADE,
        stage_id BIGINT REFERENCES lr_crm_stages(id) ON DELETE SET NULL,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        value DECIMAL(12,2) DEFAULT 0,
        contact_name VARCHAR(255),
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        notes TEXT,
        expected_close_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_crm_deals created');

    // 4. CRM Activities
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_activities (
        id BIGSERIAL PRIMARY KEY,
        deal_id BIGINT REFERENCES lr_crm_deals(id) ON DELETE CASCADE,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        type VARCHAR(20) DEFAULT 'note',
        content TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_crm_activities created');

    // 5. AI Agents
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_ai_agents (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        voice_id VARCHAR(100),
        greeting TEXT,
        goal TEXT,
        max_duration INTEGER DEFAULT 300,
        phone_number VARCHAR(50),
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_ai_agents created');

    // 6. Email Templates
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_email_templates (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        subject TEXT,
        body TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_email_templates created');

    // 7. Sent Emails
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_sent_emails (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES lr_users(id) ON DELETE CASCADE,
        account_id BIGINT REFERENCES lr_email_accounts(id) ON DELETE SET NULL,
        lead_id BIGINT REFERENCES lr_leads(id) ON DELETE SET NULL,
        to_email VARCHAR(255) NOT NULL,
        to_name VARCHAR(255),
        subject TEXT,
        body TEXT,
        status VARCHAR(20) DEFAULT 'sent',
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        opened_at TIMESTAMPTZ
      )
    `);
    results.push('lr_sent_emails created');

    // 8. Create indexes on foreign keys
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_crm_pipelines_user ON lr_crm_pipelines(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline ON lr_crm_stages(pipeline_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_deals_pipeline ON lr_crm_deals(pipeline_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON lr_crm_deals(stage_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_deals_user ON lr_crm_deals(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON lr_crm_activities(deal_id)',
      'CREATE INDEX IF NOT EXISTS idx_crm_activities_user ON lr_crm_activities(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_ai_agents_user ON lr_ai_agents(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_email_templates_user ON lr_email_templates(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_sent_emails_user ON lr_sent_emails(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_sent_emails_account ON lr_sent_emails(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_sent_emails_lead ON lr_sent_emails(lead_id)'
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
        message: 'All CRM tables and indexes created successfully',
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
