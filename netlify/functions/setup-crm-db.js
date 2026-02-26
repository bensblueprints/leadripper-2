const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const results = [];

  try {
    // ==========================================
    // CRM PIPELINES TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_pipelines (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        color VARCHAR(7) DEFAULT '#ff3e00',
        is_default BOOLEAN DEFAULT false,
        sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_crm_pipelines table');

    // Index for user queries
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_pipelines_user ON lr_crm_pipelines(user_id)
    `);

    // ==========================================
    // CRM STAGES TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_stages (
        id BIGSERIAL PRIMARY KEY,
        pipeline_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        color VARCHAR(7) DEFAULT '#333333',
        sort_order INTEGER DEFAULT 0,
        auto_move_days INTEGER,
        win_probability INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_crm_stages table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_stages_pipeline ON lr_crm_stages(pipeline_id)
    `);

    // ==========================================
    // CRM DEALS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_deals (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        lead_id BIGINT,
        pipeline_id BIGINT NOT NULL,
        stage_id BIGINT,
        title VARCHAR(255),
        value DECIMAL(12,2) DEFAULT 0,
        status VARCHAR(20) DEFAULT 'open',
        assigned_to VARCHAR(255),
        expected_close_date DATE,
        notes TEXT,
        tags TEXT[],
        last_activity_at TIMESTAMPTZ,
        won_at TIMESTAMPTZ,
        lost_at TIMESTAMPTZ,
        lost_reason TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_crm_deals table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_deals_user ON lr_crm_deals(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_deals_pipeline ON lr_crm_deals(pipeline_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON lr_crm_deals(stage_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_deals_status ON lr_crm_deals(user_id, status)
    `);

    // ==========================================
    // CRM ACTIVITIES TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_crm_activities (
        id BIGSERIAL PRIMARY KEY,
        deal_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        activity_type VARCHAR(50) NOT NULL,
        subject VARCHAR(255),
        content TEXT,
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_crm_activities table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON lr_crm_activities(deal_id)
    `);

    // ==========================================
    // EMAIL ACCOUNTS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_email_accounts (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        provider VARCHAR(50) NOT NULL,
        email_address VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        oauth_access_token TEXT,
        oauth_refresh_token TEXT,
        oauth_expires_at TIMESTAMPTZ,
        imap_host VARCHAR(255),
        imap_port INTEGER,
        smtp_host VARCHAR(255),
        smtp_port INTEGER,
        username VARCHAR(255),
        password_encrypted TEXT,
        is_default BOOLEAN DEFAULT false,
        is_active BOOLEAN DEFAULT true,
        daily_send_limit INTEGER DEFAULT 50,
        sends_today INTEGER DEFAULT 0,
        last_send_at TIMESTAMPTZ,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, email_address)
      )
    `);
    results.push('Created lr_email_accounts table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_accounts_user ON lr_email_accounts(user_id)
    `);

    // ==========================================
    // EMAIL TEMPLATES TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_email_templates (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(500),
        body TEXT,
        variables JSONB DEFAULT '[]',
        category VARCHAR(100),
        is_active BOOLEAN DEFAULT true,
        use_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_email_templates table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_email_templates_user ON lr_email_templates(user_id)
    `);

    // ==========================================
    // WORKFLOWS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflows (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        trigger_type VARCHAR(50) NOT NULL,
        trigger_config JSONB DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        run_count INTEGER DEFAULT 0,
        last_run_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_workflows table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_user ON lr_workflows(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON lr_workflows(trigger_type, is_active)
    `);

    // ==========================================
    // WORKFLOW ACTIONS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflow_actions (
        id BIGSERIAL PRIMARY KEY,
        workflow_id BIGINT NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        action_config JSONB DEFAULT '{}',
        sort_order INTEGER DEFAULT 0,
        delay_minutes INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_workflow_actions table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_actions_workflow ON lr_workflow_actions(workflow_id)
    `);

    // ==========================================
    // WORKFLOW EXECUTIONS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflow_executions (
        id BIGSERIAL PRIMARY KEY,
        workflow_id BIGINT NOT NULL,
        deal_id BIGINT NOT NULL,
        current_action_id BIGINT,
        status VARCHAR(20) DEFAULT 'running',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        next_action_at TIMESTAMPTZ,
        error_message TEXT,
        execution_log JSONB DEFAULT '[]'
      )
    `);
    results.push('Created lr_workflow_executions table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON lr_workflow_executions(status, next_action_at)
    `);

    // ==========================================
    // AI AGENTS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_ai_agents (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        voice_id VARCHAR(255),
        voice_name VARCHAR(255),
        system_prompt TEXT,
        greeting_script TEXT,
        objection_handlers JSONB DEFAULT '[]',
        goal VARCHAR(255) DEFAULT 'schedule_meeting',
        calendar_link VARCHAR(500),
        phone_number VARCHAR(50),
        max_call_duration INTEGER DEFAULT 300,
        is_active BOOLEAN DEFAULT true,
        total_calls INTEGER DEFAULT 0,
        successful_calls INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_ai_agents table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ai_agents_user ON lr_ai_agents(user_id)
    `);

    // ==========================================
    // CALL LOGS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_call_logs (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        deal_id BIGINT,
        agent_id BIGINT,
        phone_number VARCHAR(50),
        direction VARCHAR(10) DEFAULT 'outbound',
        status VARCHAR(20) DEFAULT 'initiated',
        duration_seconds INTEGER,
        recording_url TEXT,
        transcript TEXT,
        summary TEXT,
        sentiment VARCHAR(20),
        outcome VARCHAR(50),
        scheduled_meeting_at TIMESTAMPTZ,
        elevenlabs_call_id VARCHAR(255),
        elevenlabs_conversation_id VARCHAR(255),
        started_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_call_logs table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_call_logs_user ON lr_call_logs(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_call_logs_deal ON lr_call_logs(deal_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_call_logs_status ON lr_call_logs(status)
    `);

    // ==========================================
    // CALENDAR EVENTS TABLE
    // ==========================================
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_calendar_events (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        deal_id BIGINT,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        start_time TIMESTAMPTZ NOT NULL,
        end_time TIMESTAMPTZ NOT NULL,
        attendee_name VARCHAR(255),
        attendee_email VARCHAR(255),
        attendee_phone VARCHAR(50),
        meeting_link VARCHAR(500),
        location TEXT,
        status VARCHAR(20) DEFAULT 'scheduled',
        reminder_sent BOOLEAN DEFAULT false,
        confirmation_sent BOOLEAN DEFAULT false,
        source VARCHAR(50) DEFAULT 'manual',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('Created lr_calendar_events table');

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_calendar_events_user ON lr_calendar_events(user_id)
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_calendar_events_time ON lr_calendar_events(start_time, end_time)
    `);

    // ==========================================
    // ADD CRM COLUMNS TO lr_user_settings
    // ==========================================
    const settingsColumns = [
      { name: 'crm_mode', type: "VARCHAR(20) DEFAULT 'ghl'" },
      { name: 'elevenlabs_api_key', type: 'TEXT' },
      { name: 'elevenlabs_default_voice', type: 'VARCHAR(255)' },
      { name: 'default_email_account_id', type: 'BIGINT' },
      { name: 'email_signature', type: 'TEXT' },
      { name: 'calendar_timezone', type: "VARCHAR(50) DEFAULT 'America/New_York'" },
      { name: 'calendar_working_hours', type: 'JSONB' },
      { name: 'ai_calling_enabled', type: 'BOOLEAN DEFAULT false' }
    ];

    for (const col of settingsColumns) {
      try {
        await pool.query(`ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      } catch (e) {
        // Column might already exist
      }
    }
    results.push('Added CRM columns to lr_user_settings');

    // ==========================================
    // ADD CRM COLUMNS TO lr_leads
    // ==========================================
    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS crm_deal_id BIGINT`);
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS in_crm BOOLEAN DEFAULT false`);
    } catch (e) {
      // Columns might already exist
    }
    results.push('Added CRM columns to lr_leads');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'CRM database tables created successfully',
        results
      })
    };

  } catch (error) {
    console.error('CRM database setup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'CRM database setup failed',
        message: error.message,
        results
      })
    };
  }
};
