const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
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

  try {
    // Admin accounts configuration
    const adminAccounts = [
      {
        email: 'admin@advancedmarketing.co',
        name: 'Admin Account',
        company: 'Advanced Marketing',
        password: 'AdminAccess2026!',
        plan: 'unlimited',
        leads_limit: -1, // -1 means unlimited
        is_admin: true
      },
      {
        email: 'ben@advancedmarketing.co',
        name: 'Ben',
        company: 'Advanced Marketing',
        password: 'BenAdmin2026!',
        plan: 'unlimited',
        leads_limit: -1,
        is_admin: true
      }
    ];

    const results = [];
    const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

    for (const admin of adminAccounts) {
      // Hash password
      const passwordHash = await bcrypt.hash(admin.password, 10);

      // Insert or update user
      const userResult = await pool.query(`
        INSERT INTO lr_users (email, password_hash, name, company, plan, leads_limit, is_admin, trial_ends_at, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
        ON CONFLICT (email)
        DO UPDATE SET
          plan = $5,
          leads_limit = $6,
          is_admin = $7,
          trial_ends_at = $8,
          updated_at = NOW()
        RETURNING id, email, name, plan, leads_limit
      `, [admin.email, passwordHash, admin.name, admin.company, admin.plan, admin.leads_limit, admin.is_admin, trialEndsAt]);

      const userId = userResult.rows[0].id;

      // Create user settings
      await pool.query(`
        INSERT INTO lr_user_settings (user_id, created_at)
        VALUES ($1, NOW())
        ON CONFLICT (user_id) DO NOTHING
      `, [userId]);

      // Create subscription record
      await pool.query(`
        INSERT INTO lr_subscriptions (user_id, plan, status, is_trial, trial_ends_at, current_period_end, created_at)
        VALUES ($1, $2, 'active', true, $3, $3, NOW())
        ON CONFLICT (user_id)
        DO UPDATE SET
          plan = $2,
          status = 'active',
          is_trial = true,
          trial_ends_at = $3,
          current_period_end = $3,
          updated_at = NOW()
      `, [userId, admin.plan, trialEndsAt]);

      results.push({
        email: admin.email,
        userId: userId,
        plan: admin.plan,
        trialEndsAt: trialEndsAt.toISOString(),
        tempPassword: admin.password
      });
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Admin accounts created successfully',
        accounts: results,
        note: 'Trial expires in 7 days, then full plan amount will be charged'
      })
    };

  } catch (error) {
    console.error('Admin account creation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create admin accounts',
        message: error.message
      })
    };
  }
};
