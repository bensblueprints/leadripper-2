const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const teamMembers = [
      { name: 'Benjamin Boyce', email: 'ben@advancedmarketing.co' },
      { name: 'Prathamesh Mali', email: 'pratham@advancedmarketing.co' },
      { name: 'Saurebh', email: 'saurebh@advancedmarketing.co' },
    ];

    const results = [];

    for (const member of teamMembers) {
      const tempPassword = `LeadRipper${Math.random().toString(36).substring(2, 10)}!`;
      const passwordHash = await bcrypt.hash(tempPassword, 10);

      try {
        // Create or update user
        const userResult = await pool.query(`
          INSERT INTO lr_users (email, password_hash, name, company, plan, leads_limit, is_admin, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
          ON CONFLICT (email)
          DO UPDATE SET
            plan = $5,
            leads_limit = $6,
            is_admin = $7,
            updated_at = NOW()
          RETURNING id, email, name
        `, [member.email.toLowerCase(), passwordHash, member.name, 'Advanced Marketing', 'unlimited', -1, true]);

        const userId = userResult.rows[0].id;

        // Create user settings
        await pool.query(`
          INSERT INTO lr_user_settings (user_id, created_at)
          VALUES ($1, NOW())
          ON CONFLICT (user_id) DO NOTHING
        `, [userId]);

        // Create/update subscription
        await pool.query(`
          INSERT INTO lr_subscriptions (user_id, plan, status, is_trial, created_at)
          VALUES ($1, $2, 'active', false, NOW())
          ON CONFLICT (user_id)
          DO UPDATE SET
            plan = $2,
            status = 'active',
            is_trial = false,
            updated_at = NOW()
        `, [userId, 'unlimited']);

        results.push({
          name: member.name,
          email: member.email,
          tempPassword: tempPassword,
          userId: userId
        });

      } catch (error) {
        results.push({
          name: member.name,
          email: member.email,
          error: error.message
        });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Team accounts created',
        accounts: results,
        loginUrl: 'https://leadripper-2.netlify.app/app'
      })
    };

  } catch (error) {
    console.error('Team account creation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to create team accounts', message: error.message })
    };
  }
};
