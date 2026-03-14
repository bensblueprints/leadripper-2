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
    // Add Twilio columns to lr_user_settings
    const columns = [
      { name: 'twilio_account_sid', type: 'VARCHAR(255)' },
      { name: 'twilio_auth_token', type: 'TEXT' },
      { name: 'twilio_phone_number', type: 'VARCHAR(50)' },
      { name: 'twilio_twiml_app_sid', type: 'VARCHAR(255)' },
      { name: 'twilio_api_key_sid', type: 'VARCHAR(255)' },
      { name: 'twilio_api_key_secret', type: 'TEXT' }
    ];

    for (const col of columns) {
      await pool.query(`
        ALTER TABLE lr_user_settings
        ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}
      `);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ success: true, message: 'Twilio columns added to lr_user_settings' })
    };
  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Migration failed', message: error.message })
    };
  }
};
