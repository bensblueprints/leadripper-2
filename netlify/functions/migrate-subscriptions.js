const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    console.log('Adding airwallex_subscription_id column...');
    await pool.query('ALTER TABLE lr_subscriptions ADD COLUMN IF NOT EXISTS airwallex_subscription_id VARCHAR(255)');

    console.log('Adding airwallex_customer_id column...');
    await pool.query('ALTER TABLE lr_subscriptions ADD COLUMN IF NOT EXISTS airwallex_customer_id VARCHAR(255)');

    console.log('Creating index on airwallex_subscription_id...');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lr_subscriptions_airwallex_sub ON lr_subscriptions(airwallex_subscription_id)');

    console.log('Creating index on airwallex_customer_id...');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_lr_subscriptions_airwallex_customer ON lr_subscriptions(airwallex_customer_id)');

    console.log('Verifying columns...');
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'lr_subscriptions'
      ORDER BY ordinal_position
    `);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Migration completed successfully',
        columns: result.rows
      })
    };
  } catch (error) {
    console.error('Migration error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Migration failed',
        message: error.message
      })
    };
  }
};
