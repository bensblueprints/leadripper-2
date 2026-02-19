const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

// Airwallex API Configuration
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_BASE_URL = 'https://api.airwallex.com';

// LeadRipper Plans - $1 trial for all plans
const PLANS = {
  starter: {
    name: 'Starter',
    monthly: { trial: 100, full: 2900 },  // $1 trial, $29/month
    annual: { trial: 100, full: 27840 },   // $1 trial, $278.40/year ($23.20/month - 20% off)
    currency: 'USD',
    leads_limit: 500,
    features: ['500 leads/month', 'CSV export', 'Email support', 'City tracking', 'Deduplication']
  },
  advanced: {
    name: 'Advanced',
    monthly: { trial: 100, full: 7900 },  // $1 trial, $79/month
    annual: { trial: 100, full: 75840 },   // $1 trial, $758.40/year ($63.20/month - 20% off)
    currency: 'USD',
    leads_limit: 2500,
    features: ['2,500 leads/month', 'GHL sync included', 'Priority support', 'Email verification', 'Webhook notifications', 'Bulk operations']
  },
  premium: {
    name: 'Premium',
    monthly: { trial: 100, full: 14900 }, // $1 trial, $149/month
    annual: { trial: 100, full: 143040 },  // $1 trial, $1,430.40/year ($119.20/month - 20% off)
    currency: 'USD',
    leads_limit: 10000,
    features: ['10,000 leads/month', 'Everything in Advanced', 'API access', 'Custom webhooks', 'Dedicated support', 'Team collaboration']
  },
  unlimited: {
    name: 'Unlimited',
    monthly: { trial: 100, full: 99700 }, // $1 trial, $997/month
    currency: 'USD',
    leads_limit: -1, // unlimited
    features: ['Unlimited leads', 'Scrape entire US', 'Everything in Premium', 'White-label exports', 'Custom integrations', 'Priority processing', 'SLA guarantee']
  }
};

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.split(' ')[1];
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

async function getAirwallexToken() {
  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/authentication/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': AIRWALLEX_CLIENT_ID,
      'x-api-key': AIRWALLEX_API_KEY
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Airwallex auth failed: ${error}`);
  }

  const data = await response.json();
  return data.token;
}

async function createPaymentIntent(accessToken, amount, currency, orderId, customerEmail, planId, userId) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    amount: amount / 100, // Airwallex expects amount in dollars, not cents
    currency: currency,
    merchant_order_id: orderId,
    metadata: {
      customer_email: customerEmail,
      plan_id: planId,
      user_id: String(userId || ''),
      source: 'leadripper'
    },
    return_url: `${process.env.URL || 'https://leadripper.com'}/?payment=success&order=${orderId}`,
    descriptor: 'LeadRipper Subscription'
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/pa/payment_intents/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Payment intent creation failed: ${error}`);
  }

  return response.json();
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const { plan: planId, billing = 'monthly', trial = true } = JSON.parse(event.body);

    // Get user from token
    const decoded = verifyToken(event.headers.authorization);
    if (!decoded) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Authentication required' })
      };
    }

    // Validate plan
    const plan = PLANS[planId];
    if (!plan) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid plan selected' })
      };
    }

    // Check if user exists
    const userResult = await pool.query(
      'SELECT id, email FROM lr_users WHERE id = $1',
      [decoded.userId]
    );
    if (userResult.rows.length === 0) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const user = userResult.rows[0];

    // Determine amount
    const billingPrices = plan[billing] || plan.monthly;
    const amount = trial ? billingPrices.trial : billingPrices.full;
    const planDescription = trial
      ? `${plan.name} - $1 Trial (7 days)`
      : `${plan.name} (${billing === 'annual' ? 'Annual' : 'Monthly'})`;

    // Generate order ID
    const orderId = `LR_${Date.now()}_${planId}_${billing}_${trial ? 'trial' : 'full'}`;

    // Get Airwallex access token
    const accessToken = await getAirwallexToken();

    // Create payment intent
    const paymentIntent = await createPaymentIntent(
      accessToken,
      amount,
      plan.currency,
      orderId,
      user.email,
      planId,
      user.id
    );

    // Calculate trial end date
    let trialEndsAt = null;
    if (trial) {
      trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 7); // 7-day trial
    }

    // Store pending subscription
    await pool.query(
      `INSERT INTO lr_subscriptions (user_id, plan, status, payment_intent_id, billing_cycle, is_trial, trial_ends_at)
       VALUES ($1, $2, 'pending', $3, $4, $5, $6)
       ON CONFLICT (user_id) DO UPDATE SET
         plan = $2,
         status = 'pending',
         payment_intent_id = $3,
         billing_cycle = $4,
         is_trial = $5,
         trial_ends_at = $6,
         updated_at = NOW()`,
      [user.id, planId, paymentIntent.id, billing, trial, trialEndsAt]
    );

    // Build checkout URL
    const checkoutUrl = `https://checkout.airwallex.com/pci/v2/checkout.html?` +
      `intent_id=${paymentIntent.id}&` +
      `client_secret=${paymentIntent.client_secret}&` +
      `mode=payment&` +
      `env=prod`;

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        url: checkoutUrl,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        amount: amount,
        currency: plan.currency,
        planName: planDescription,
        isTrial: trial,
        trialEndsAt: trialEndsAt
      })
    };
  } catch (error) {
    console.error('Checkout error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create checkout session',
        message: error.message
      })
    };
  }
};
