const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const fetch = require('node-fetch');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_BASE_URL = 'https://api.airwallex.com';

// Price IDs from Airwallex
const PRICE_IDS = {
  starter: 'pri_sgpd5s4zvhfjrnpp80d',
  advanced: 'pri_sgpd5s4zvhfjrnq7ki7',
  premium: 'pri_sgpdbmdcbhfjrnqkr1q',
  unlimited: 'pri_sgpdbmdcbhfjrnqy8dz'
};

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

async function createBillingCustomer(accessToken, email, name) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: 'INDIVIDUAL',
    email: email,
    name: name,
    metadata: {
      source: 'leadripper_trial',
      created_at: new Date().toISOString()
    }
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/billing_customers/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Billing customer creation failed: ${error}`);
  }

  return response.json();
}

async function createTrialPaymentIntent(accessToken, billingCustomerId, email, orderId) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    amount: 1.00,
    currency: 'USD',
    merchant_order_id: orderId,
    billing_customer_id: billingCustomerId,
    metadata: {
      customer_email: email,
      source: 'leadripper_trial_payment',
      type: 'trial_activation'
    },
    return_url: `${process.env.URL || 'https://leadripper.netlify.app'}/?payment=success&order=${orderId}`,
    descriptor: 'LeadRipper $1 Trial'
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
    throw new Error(`Trial payment intent creation failed: ${error}`);
  }

  return response.json();
}

async function createSubscription(accessToken, billingCustomerId, priceId, userId, plan) {
  const trialEndDate = new Date();
  trialEndDate.setDate(trialEndDate.getDate() + 7);

  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    billing_customer_id: billingCustomerId,
    collection_method: 'CHARGE_AUTOMATICALLY',
    items: [
      {
        price_id: priceId,
        quantity: 1
      }
    ],
    trial_ends_at: trialEndDate.toISOString(),
    metadata: {
      user_id: userId.toString(),
      plan: plan,
      source: 'leadripper_trial'
    }
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Subscription creation failed: ${error}`);
  }

  return response.json();
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
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
    const { email, password, name, company, plan = 'starter' } = JSON.parse(event.body);

    // Validation
    if (!email || !password || !name) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email, password, and name are required' })
      };
    }

    // Validate plan
    if (!PRICE_IDS[plan]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid plan selected' })
      };
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT id FROM lr_users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (existingUser.rows.length > 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Email already registered' })
      };
    }

    // Generate order ID
    const orderId = `LR_TRIAL_${Date.now()}_${plan}`;

    // Get Airwallex token
    const accessToken = await getAirwallexToken();

    // Create billing customer in Airwallex
    console.log('Creating billing customer...');
    const billingCustomer = await createBillingCustomer(accessToken, email, name);

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user with pending status
    const result = await pool.query(
      `INSERT INTO lr_users (email, password_hash, name, company, plan, leads_limit, leads_used)
       VALUES ($1, $2, $3, $4, 'pending', 0, 0)
       RETURNING id, email, name, company`,
      [email.toLowerCase(), passwordHash, name, company]
    );

    const user = result.rows[0];

    // Create user settings record
    await pool.query(
      'INSERT INTO lr_user_settings (user_id) VALUES ($1)',
      [user.id]
    );

    // Create subscription in Airwallex
    console.log('Creating subscription...');
    const subscription = await createSubscription(
      accessToken,
      billingCustomer.id,
      PRICE_IDS[plan],
      user.id,
      plan
    );

    // Create $1 trial payment intent
    console.log('Creating trial payment intent...');
    const paymentIntent = await createTrialPaymentIntent(
      accessToken,
      billingCustomer.id,
      email,
      orderId
    );

    // Store subscription in database
    await pool.query(
      `INSERT INTO lr_subscriptions (
        user_id,
        plan,
        status,
        payment_intent_id,
        airwallex_subscription_id,
        airwallex_customer_id,
        billing_cycle,
        is_trial,
        trial_ends_at
      )
       VALUES ($1, $2, 'pending', $3, $4, $5, 'monthly', true, NOW() + INTERVAL '7 days')`,
      [user.id, plan, paymentIntent.id, subscription.id, billingCustomer.id]
    );

    // Return payment intent details for Airwallex SDK
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        subscriptionId: subscription.id,
        billingCustomerId: billingCustomer.id,
        currency: 'USD',
        userId: user.id,
        email: user.email,
        plan: plan,
        orderId: orderId,
        message: '$1 trial payment + 7-day trial subscription created'
      })
    };
  } catch (error) {
    console.error('Trial signup error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create trial signup',
        message: error.message
      })
    };
  }
};
