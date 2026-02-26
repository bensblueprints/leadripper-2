const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

/**
 * Migration to add email discovery columns to lr_leads table
 */
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
    // Add contact_name column for email discovery
    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`);
      results.push('✅ Added contact_name column');
    } catch (e) {
      results.push(`⚠️ contact_name: ${e.message}`);
    }

    // Add email discovery tracking columns
    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_discovered BOOLEAN DEFAULT false`);
      results.push('✅ Added email_discovered column');
    } catch (e) {
      results.push(`⚠️ email_discovered: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_discovery_attempted BOOLEAN DEFAULT false`);
      results.push('✅ Added email_discovery_attempted column');
    } catch (e) {
      results.push(`⚠️ email_discovery_attempted: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_discovery_confidence INTEGER`);
      results.push('✅ Added email_discovery_confidence column');
    } catch (e) {
      results.push(`⚠️ email_discovery_confidence: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_discovery_date TIMESTAMP`);
      results.push('✅ Added email_discovery_date column');
    } catch (e) {
      results.push(`⚠️ email_discovery_date: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_discovery_error TEXT`);
      results.push('✅ Added email_discovery_error column');
    } catch (e) {
      results.push(`⚠️ email_discovery_error: ${e.message}`);
    }

    // Add email validation columns if not exists
    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_verified BOOLEAN`);
      results.push('✅ Added email_verified column');
    } catch (e) {
      results.push(`⚠️ email_verified: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_score INTEGER`);
      results.push('✅ Added email_score column');
    } catch (e) {
      results.push(`⚠️ email_score: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_validation_date TIMESTAMP`);
      results.push('✅ Added email_validation_date column');
    } catch (e) {
      results.push(`⚠️ email_validation_date: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS email_warnings TEXT`);
      results.push('✅ Added email_warnings column');
    } catch (e) {
      results.push(`⚠️ email_warnings: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS is_disposable BOOLEAN DEFAULT false`);
      results.push('✅ Added is_disposable column');
    } catch (e) {
      results.push(`⚠️ is_disposable: ${e.message}`);
    }

    try {
      await pool.query(`ALTER TABLE lr_leads ADD COLUMN IF NOT EXISTS is_role_based BOOLEAN DEFAULT false`);
      results.push('✅ Added is_role_based column');
    } catch (e) {
      results.push(`⚠️ is_role_based: ${e.message}`);
    }

    // Create indexes for faster querying
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_lr_leads_email_discovery ON lr_leads(email_discovered, email_discovery_attempted)`);
      results.push('✅ Created email discovery index');
    } catch (e) {
      results.push(`⚠️ Index creation: ${e.message}`);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Email discovery migration completed',
        results
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
        results
      })
    };
  }
};
