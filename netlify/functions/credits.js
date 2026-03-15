const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

// Credit costs per action
/* eslint-disable */
// @formatter:off
// 1 credit = $0.01
const CREDIT_COSTS = {
  scrape: 25, place_details: 3,
  email_scrape: 1, email_validate: 2,  // email scrape free on all plans, validation costs 2
  website_score: 8, website_rebuild: 30,
  ai_call_per_min: 48, sms: 3, email_send: 1, pdf_report: 8
};

// Monthly credit grants by plan
const PLAN_CREDITS = {
  free: 500, starter: 5000, pro: 10000, growth: 10000, paid: 10000, unlimited: 50000
};

// Lifetime plans — one-time purchase, monthly email allowances
// Email scraping is FREE on all plans
const LIFETIME_PLANS = {
  starter_lifetime: {
    name: 'Starter Lifetime',
    price: 250,
    emails_per_month: 10000,
    email_scrape_free: true,
    email_validate_free: false,
    description: '10,000 email sends/month + free email scraping'
  },
  pro_lifetime: {
    name: 'Pro Lifetime',
    price: 450,
    emails_per_month: 100000,
    email_scrape_free: true,
    email_validate_free: true,
    description: '100,000 email sends/month + free email scraping & validation'
  },
  enterprise_lifetime: {
    name: 'Enterprise Lifetime',
    price: 900,
    emails_per_month: 500000,
    email_scrape_free: true,
    email_validate_free: true,
    description: '500,000 email sends/month + free email scraping & validation'
  }
};
// @formatter:on
/* eslint-enable */

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try { return jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch { return null; }
}

async function spendCredits(userId, amount, type, description, referenceId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO lr_credits (user_id, balance, lifetime_credits, updated_at) VALUES ($1, 0, 0, NOW()) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    const result = await client.query('SELECT balance FROM lr_credits WHERE user_id = $1 FOR UPDATE', [userId]);
    const currentBalance = result.rows[0]?.balance || 0;
    if (currentBalance < amount) {
      await client.query('ROLLBACK');
      return { success: false, balance: currentBalance, required: amount };
    }
    const newBalance = currentBalance - amount;
    await client.query('UPDATE lr_credits SET balance = $1, updated_at = NOW() WHERE user_id = $2', [newBalance, userId]);
    await client.query(
      `INSERT INTO lr_credit_transactions (user_id, amount, balance_after, type, description, reference_id, created_at) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
      [userId, -amount, newBalance, type, description || null, referenceId || null]
    );
    await client.query('COMMIT');
    return { success: true, balance: newBalance };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('spendCredits error:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function addCredits(userId, amount, type, description) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO lr_credits (user_id, balance, lifetime_credits, updated_at) VALUES ($1, 0, 0, NOW()) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    );
    const result = await client.query(
      `UPDATE lr_credits SET balance = balance + $1, lifetime_credits = lifetime_credits + $1, updated_at = NOW() WHERE user_id = $2 RETURNING balance`,
      [amount, userId]
    );
    const newBalance = result.rows[0].balance;
    await client.query(
      `INSERT INTO lr_credit_transactions (user_id, amount, balance_after, type, description, created_at) VALUES ($1, $2, $3, $4, $5, NOW())`,
      [userId, amount, newBalance, type, description || null]
    );
    await client.query('COMMIT');
    return { success: true, balance: newBalance };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('addCredits error:', error);
    throw error;
  } finally {
    client.release();
  }
}

async function getBalance(userId) {
  await pool.query(
    `INSERT INTO lr_credits (user_id, balance, lifetime_credits, updated_at) VALUES ($1, 0, 0, NOW()) ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
  const result = await pool.query('SELECT balance, lifetime_credits, updated_at FROM lr_credits WHERE user_id = $1', [userId]);
  return result.rows[0] || { balance: 0, lifetime_credits: 0 };
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };

  const userId = decoded.userId;

  if (event.httpMethod === 'GET') {
    try {
      const balance = await getBalance(userId);
      const params = event.queryStringParameters || {};
      const limit = Math.min(parseInt(params.limit) || 50, 200);
      const offset = parseInt(params.offset) || 0;

      const txResult = await pool.query(
        `SELECT id, amount, balance_after, type, description, reference_id, created_at FROM lr_credit_transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
      const countResult = await pool.query('SELECT COUNT(*) as total FROM lr_credit_transactions WHERE user_id = $1', [userId]);

      return {
        statusCode: 200, headers,
        body: JSON.stringify({
          success: true,
          balance: balance.balance,
          lifetime_credits: balance.lifetime_credits,
          updated_at: balance.updated_at,
          transactions: txResult.rows,
          total_transactions: parseInt(countResult.rows[0].total),
          costs: CREDIT_COSTS,
          plan_credits: PLAN_CREDITS,
          lifetime_plans: LIFETIME_PLANS
        })
      };
    } catch (error) {
      console.error('Credits GET error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { action } = body;

      if (action === 'purchase') {
        const creditAmount = parseInt(body.amount) || 0;
        if (creditAmount <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid credit amount' }) };
        const packageNames = { 100: '$10 - 100 Credits', 500: '$40 - 500 Credits', 1000: '$70 - 1,000 Credits', 5000: '$300 - 5,000 Credits' };
        const result = await addCredits(userId, creditAmount, 'purchase', packageNames[creditAmount] || `Purchased ${creditAmount} credits`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result, message: `Added ${creditAmount} credits` }) };
      }

      if (action === 'spend') {
        const { amount, type, description, referenceId } = body;
        const creditAmount = parseInt(amount) || 0;
        if (creditAmount <= 0 || !type) return { statusCode: 400, headers, body: JSON.stringify({ error: 'amount and type are required' }) };
        const result = await spendCredits(userId, creditAmount, type, description, referenceId);
        if (!result.success) return { statusCode: 402, headers, body: JSON.stringify({ error: 'Insufficient credits', balance: result.balance, required: result.required }) };
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result }) };
      }

      if (action === 'add') {
        const creditAmount = parseInt(body.amount) || 0;
        if (creditAmount <= 0) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid credit amount' }) };
        const result = await addCredits(userId, creditAmount, 'bonus', body.description || `Bonus: ${creditAmount} credits`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result, message: `Added ${creditAmount} bonus credits` }) };
      }

      if (action === 'grant_monthly') {
        const userResult = await pool.query('SELECT plan FROM lr_users WHERE id = $1', [userId]);
        const plan = userResult.rows[0]?.plan || 'free';
        const creditsToGrant = PLAN_CREDITS[plan] || PLAN_CREDITS.free;
        const result = await addCredits(userId, creditsToGrant, 'subscription', `Monthly credit grant (${plan} plan): ${creditsToGrant} credits`);
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, ...result, plan, granted: creditsToGrant, message: `Granted ${creditsToGrant} monthly credits for ${plan} plan` }) };
      }

      if (action === 'get_costs') {
        return { statusCode: 200, headers, body: JSON.stringify({ success: true, costs: CREDIT_COSTS, plan_credits: PLAN_CREDITS, lifetime_plans: LIFETIME_PLANS }) };
      }

      if (action === 'activate_lifetime') {
        const planKey = body.plan;
        const plan = LIFETIME_PLANS[planKey];
        if (!plan) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid plan. Options: ' + Object.keys(LIFETIME_PLANS).join(', ') }) };

        // Add lifetime plan columns if needed
        await pool.query(`
          ALTER TABLE lr_users ADD COLUMN IF NOT EXISTS lifetime_plan VARCHAR(50);
          ALTER TABLE lr_users ADD COLUMN IF NOT EXISTS emails_per_month INTEGER DEFAULT 0;
          ALTER TABLE lr_users ADD COLUMN IF NOT EXISTS emails_sent_this_month INTEGER DEFAULT 0;
          ALTER TABLE lr_users ADD COLUMN IF NOT EXISTS lifetime_activated_at TIMESTAMP;
        `).catch(() => {});

        // Activate the plan
        await pool.query(
          `UPDATE lr_users SET lifetime_plan = $1, emails_per_month = $2, emails_sent_this_month = 0, lifetime_activated_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [planKey, plan.emails_per_month, userId]
        );

        return { statusCode: 200, headers, body: JSON.stringify({ success: true, plan: planKey, name: plan.name, emails_per_month: plan.emails_per_month, message: `Activated ${plan.name} — ${plan.emails_per_month.toLocaleString()} emails/month` }) };
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: `Unknown action: ${action}` }) };
    } catch (error) {
      console.error('Credits POST error:', error);
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};

exports.spendCredits = spendCredits;
exports.addCredits = addCredits;
exports.getBalance = getBalance;
exports.CREDIT_COSTS = CREDIT_COSTS;
exports.PLAN_CREDITS = PLAN_CREDITS;
exports.LIFETIME_PLANS = LIFETIME_PLANS;
