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

    // 1. Workflows
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflows (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL REFERENCES lr_users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        status VARCHAR(20) DEFAULT 'draft',
        trigger_type VARCHAR(50) NOT NULL,
        trigger_config JSONB DEFAULT '{}',
        nodes JSONB DEFAULT '[]',
        edges JSONB DEFAULT '[]',
        settings JSONB DEFAULT '{}',
        stats JSONB DEFAULT '{"enrolled": 0, "completed": 0, "active": 0}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_workflows created');

    // 2. Workflow Executions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflow_executions (
        id BIGSERIAL PRIMARY KEY,
        workflow_id BIGINT NOT NULL REFERENCES lr_workflows(id) ON DELETE CASCADE,
        user_id BIGINT NOT NULL REFERENCES lr_users(id) ON DELETE CASCADE,
        contact_id BIGINT,
        status VARCHAR(20) DEFAULT 'running',
        current_node VARCHAR(50),
        execution_data JSONB DEFAULT '{}',
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        next_action_at TIMESTAMPTZ,
        error TEXT
      )
    `);
    results.push('lr_workflow_executions created');

    // 3. Workflow Logs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_workflow_logs (
        id BIGSERIAL PRIMARY KEY,
        execution_id BIGINT NOT NULL REFERENCES lr_workflow_executions(id) ON DELETE CASCADE,
        node_id VARCHAR(50),
        action_type VARCHAR(50),
        status VARCHAR(20),
        input_data JSONB,
        output_data JSONB,
        error TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_workflow_logs created');

    // 4. Indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_workflows_user ON lr_workflows(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_workflows_status ON lr_workflows(status)',
      'CREATE INDEX IF NOT EXISTS idx_workflows_trigger ON lr_workflows(trigger_type)',
      'CREATE INDEX IF NOT EXISTS idx_wf_exec_workflow ON lr_workflow_executions(workflow_id)',
      'CREATE INDEX IF NOT EXISTS idx_wf_exec_user ON lr_workflow_executions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_wf_exec_status ON lr_workflow_executions(status)',
      'CREATE INDEX IF NOT EXISTS idx_wf_exec_next_action ON lr_workflow_executions(next_action_at) WHERE status = \'waiting\'',
      'CREATE INDEX IF NOT EXISTS idx_wf_exec_contact ON lr_workflow_executions(contact_id)',
      'CREATE INDEX IF NOT EXISTS idx_wf_logs_exec ON lr_workflow_logs(execution_id)',
      'CREATE INDEX IF NOT EXISTS idx_wf_logs_node ON lr_workflow_logs(node_id)'
    ];

    for (const indexQuery of indexes) {
      await pool.query(indexQuery);
    }
    results.push('All workflow indexes created');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'All workflow tables and indexes created successfully',
        details: results
      })
    };
  } catch (error) {
    console.error('Workflow migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
