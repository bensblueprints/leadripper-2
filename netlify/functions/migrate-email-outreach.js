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

    // 1. Outreach campaigns
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_campaigns (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        name VARCHAR(255) NOT NULL,
        status VARCHAR(20) DEFAULT 'draft',
        subject VARCHAR(500),
        body TEXT,
        from_account_id BIGINT,
        sequence_steps JSONB DEFAULT '[]',
        settings JSONB DEFAULT '{}',
        stats JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_campaigns created');

    // 2. Add new columns to lr_sent_emails if they don't exist
    const columnsToAdd = [
      { name: 'campaign_id', type: 'BIGINT' },
      { name: 'from_account_id', type: 'BIGINT' },
      { name: 'tracking_id', type: 'VARCHAR(64)' },
      { name: 'clicked_at', type: 'TIMESTAMPTZ' },
      { name: 'replied_at', type: 'TIMESTAMPTZ' },
      { name: 'bounced_at', type: 'TIMESTAMPTZ' },
      { name: 'open_count', type: 'INTEGER DEFAULT 0' },
      { name: 'click_count', type: 'INTEGER DEFAULT 0' },
      { name: 'sequence_step', type: 'INTEGER DEFAULT 1' },
      { name: 'variant_id', type: 'VARCHAR(10)' }
    ];

    for (const col of columnsToAdd) {
      try {
        await pool.query(`ALTER TABLE lr_sent_emails ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
      } catch (e) {
        // Column might already exist, that's fine
        console.log(`Column ${col.name} may already exist:`, e.message);
      }
    }
    results.push('lr_sent_emails columns updated');

    // 3. Create unique index on tracking_id
    try {
      await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sent_emails_tracking ON lr_sent_emails(tracking_id) WHERE tracking_id IS NOT NULL`);
    } catch (e) {
      console.log('Tracking index may already exist:', e.message);
    }
    results.push('tracking_id index created');

    // 4. Reply inbox
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_inbox (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        account_id BIGINT,
        lead_id BIGINT,
        campaign_id BIGINT,
        sent_email_id BIGINT,
        from_email VARCHAR(255),
        from_name VARCHAR(255),
        to_email VARCHAR(255),
        subject VARCHAR(500),
        body TEXT,
        body_snippet VARCHAR(500),
        message_id VARCHAR(255),
        in_reply_to VARCHAR(255),
        sentiment VARCHAR(20),
        is_read BOOLEAN DEFAULT false,
        is_starred BOOLEAN DEFAULT false,
        labels JSONB DEFAULT '[]',
        received_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_inbox created');

    // 5. Tracking events
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lr_tracking_events (
        id BIGSERIAL PRIMARY KEY,
        tracking_id VARCHAR(64),
        event_type VARCHAR(20),
        ip_address VARCHAR(45),
        user_agent TEXT,
        link_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    results.push('lr_tracking_events created');

    // 6. Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_campaigns_user ON lr_campaigns(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_campaigns_status ON lr_campaigns(status)',
      'CREATE INDEX IF NOT EXISTS idx_sent_emails_campaign ON lr_sent_emails(campaign_id)',
      'CREATE INDEX IF NOT EXISTS idx_sent_emails_tracking_id ON lr_sent_emails(tracking_id)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_user ON lr_inbox(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_account ON lr_inbox(account_id)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_sentiment ON lr_inbox(sentiment)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_is_read ON lr_inbox(is_read)',
      'CREATE INDEX IF NOT EXISTS idx_inbox_received ON lr_inbox(received_at)',
      'CREATE INDEX IF NOT EXISTS idx_tracking_events_tracking ON lr_tracking_events(tracking_id)',
      'CREATE INDEX IF NOT EXISTS idx_tracking_events_type ON lr_tracking_events(event_type)'
    ];

    for (const indexQuery of indexes) {
      try {
        await pool.query(indexQuery);
      } catch (e) {
        console.log('Index may already exist:', e.message);
      }
    }
    results.push('All indexes created');

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Email outreach tables and indexes created successfully',
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
