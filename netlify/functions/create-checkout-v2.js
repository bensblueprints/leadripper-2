const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');
const fetch = require('node-fetch');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://eyaitfxwjhsrizsbqcem.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5YWl0Znh3amhzcml6c2JxY2VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODk0NDYsImV4cCI6MjA4NTk2NTQ0Nn0.xihzbULV2wrhX3JvB8ZER98wUKPlwX2xzEBuYrJVDNA'
);

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_BASE_URL = 'https://api.airwallex.com';

// Price IDs from Airwallex
const PRICE_IDS = {
  basic: 'pri_sgpdrm4wghfjrwxkqaq',
  starter: 'pri_sgpd5s4zvhfjrnpp80d',
  advanced: 'pri_sgpd5s4zvhfjrnq7ki7',
  premium: 'pri_sgpdbmdcbhfjrnqkr1q',
  enterprise: 'pri_sgpdbmdcbhfjrwy1phi',
  unlimited: 'pri_sgpdbmdcbhfjrnqy8dz'
};

const PLAN_CONFIG = {
  basic: { name: 'Basic', leads: 500, price: 29 },
  starter: { name: 'Starter', leads: 500, price: 29 },
  advanced: { name: 'Advanced', leads: 2500, price: 79 },
  premium: { name: 'Premium', leads: 10000, price: 149 },
  enterprise: { name: 'Enterprise', leads: -1, price: 297 },
  unlimited: { name: 'Unlimited', leads: -1, price: 997 }
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
      source: 'leadripper_upgrade',
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

async function createSubscription(accessToken, billingCustomerId, priceId, userId, plan) {
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
    metadata: {
      user_id: userId.toString(),
      plan: plan,
      source: 'leadripper_upgrade'
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

async function updateSubscription(accessToken, subscriptionId, priceId) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    items: [
      {
        price_id: priceId,
        quantity: 1
      }
    ]
  };

  const response = await fetch(`${AIRWALLEX_BASE_URL}/api/v1/subscriptions/${subscriptionId}/update`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Subscription update failed: ${error}`);
  }

  return response.json();
}

async function createPaymentIntent(accessToken, billingCustomerId, amount, email, orderId, plan) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    amount: amount,
    currency: 'USD',
    merchant_order_id: orderId,
    billing_customer_id: billingCustomerId,
    metadata: {
      customer_email: email,
      plan: plan,
      source: 'leadripper_upgrade'
    },
    return_url: `${process.env.URL || 'https://leadripper.com'}/?payment=success&order=${orderId}`,
    descriptor: `LeadRipper ${PLAN_CONFIG[plan].name} Plan`
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
    const { planId } = JSON.parse(event.body);

    // Verify JWT token
    const authHeader = event.headers.authorization || event.headers.Authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized' })
      };
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET);
    const userId = decoded.userId;

    // Validate plan
    if (!PRICE_IDS[planId] || !PLAN_CONFIG[planId]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid plan selected' })
      };
    }

    // Get user details using Supabase
    const { data: userData, error: userError } = await supabase
      .from('lr_users')
      .select('id, email, name')
      .eq('id', userId)
      .single();

    if (userError || !userData) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({ error: 'User not found' })
      };
    }

    const user = userData;
    const orderId = `LR_UPGRADE_${Date.now()}_${planId}`;

    // Get Airwallex token
    const accessToken = await getAirwallexToken();

    // Check if user has existing subscription using Supabase
    const { data: subData, error: subError } = await supabase
      .from('lr_subscriptions')
      .select('airwallex_subscription_id, airwallex_customer_id')
      .eq('user_id', userId)
      .limit(1);

    let billingCustomerId;
    let subscriptionId;
    let paymentIntent;

    if (subData && subData.length > 0 && subData[0].airwallex_customer_id) {
      // User has existing subscription - update it
      billingCustomerId = subData[0].airwallex_customer_id;
      subscriptionId = subData[0].airwallex_subscription_id;

      // Subscription will be created/updated by webhook after payment succeeds
      console.log('Using existing customer, subscription will be created by webhook...');

      // Create payment intent for immediate charge
      paymentIntent = await createPaymentIntent(
        accessToken,
        billingCustomerId,
        PLAN_CONFIG[planId].price,
        user.email,
        orderId,
        planId
      );

      // Update subscription record with payment intent ID
      await supabase
        .from('lr_subscriptions')
        .update({
          payment_intent_id: paymentIntent.id,
          plan: planId,
          status: 'pending_payment',
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
    } else {
      // New customer - create billing customer (subscription will be created by webhook)
      console.log('Creating new billing customer...');
      const billingCustomer = await createBillingCustomer(accessToken, user.email, user.name);
      billingCustomerId = billingCustomer.id;

      console.log('Creating payment intent...');
      paymentIntent = await createPaymentIntent(
        accessToken,
        billingCustomerId,
        PLAN_CONFIG[planId].price,
        user.email,
        orderId,
        planId
      );

      // Create subscription record (Airwallex subscription will be created by webhook)
      await supabase
        .from('lr_subscriptions')
        .upsert({
          user_id: userId,
          plan: planId,
          status: 'pending_payment',
          payment_intent_id: paymentIntent.id,
          airwallex_customer_id: billingCustomerId,
          billing_cycle: 'monthly',
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id'
        });
    }

    // Return payment intent for Airwallex checkout
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        paymentIntentId: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        currency: 'USD',
        amount: PLAN_CONFIG[planId].price,
        planName: PLAN_CONFIG[planId].name,
        message: 'Payment created - subscription will be activated after payment'
      })
    };
  } catch (error) {
    console.error('Checkout error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create checkout',
        message: error.message
      })
    };
  }
};
