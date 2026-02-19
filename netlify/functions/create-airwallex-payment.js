const fetch = require('node-fetch');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Airwallex credentials from environment
const AIRWALLEX_CLIENT_ID = process.env.AIRWALLEX_CLIENT_ID || 'VBU4oeFdS_Of60Y-ZK5bmg';
const AIRWALLEX_API_KEY = process.env.AIRWALLEX_API_KEY || '79e1f2c28f844cacbf445e7189c4ca9c66d0bd096e187a980549b8a049d89956e6cfad686023912eb4f9ab9ad222457d';
const AIRWALLEX_ENV = 'prod';

// Plan pricing
const PLANS = {
  starter: { name: 'Starter', price: 29.00, leads: 500 },
  advanced: { name: 'Advanced', price: 79.00, leads: 2500 },
  premium: { name: 'Premium', price: 149.00, leads: 10000 },
  unlimited: { name: 'Unlimited', price: 997.00, leads: -1 }
};

// Get Airwallex access token
async function getAirwallexToken() {
  const response = await fetch('https://api.airwallex.com/api/v1/authentication/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-client-id': AIRWALLEX_CLIENT_ID,
      'x-api-key': AIRWALLEX_API_KEY
    },
    body: JSON.stringify({})
  });

  const data = await response.json();
  return data.token;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
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
    const { plan, userId, couponCode, email, name } = JSON.parse(event.body);

    // Validate plan
    if (!PLANS[plan]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Invalid plan selected' })
      };
    }

    const planDetails = PLANS[plan];
    let finalPrice = 1.00; // $1 trial
    let discount = 0;

    // Check coupon code if provided
    if (couponCode) {
      const couponResult = await pool.query(
        `SELECT * FROM lr_coupons
         WHERE code = $1
         AND active = true
         AND (expires_at IS NULL OR expires_at > NOW())
         AND (max_uses IS NULL OR uses < max_uses)`,
        [couponCode.toUpperCase()]
      );

      if (couponResult.rows.length > 0) {
        const coupon = couponResult.rows[0];
        if (coupon.discount_type === 'percentage') {
          discount = (finalPrice * coupon.discount_value) / 100;
        } else {
          discount = Math.min(coupon.discount_value, finalPrice);
        }
        finalPrice = Math.max(0, finalPrice - discount);

        // Increment coupon usage
        await pool.query(
          'UPDATE lr_coupons SET uses = uses + 1 WHERE code = $1',
          [couponCode.toUpperCase()]
        );
      }
    }

    // Get Airwallex token
    const token = await getAirwallexToken();

    // Create payment intent
    const paymentIntent = await fetch('https://api.airwallex.com/api/v1/pa/payment_intents/create', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        request_id: `lr_${userId}_${Date.now()}`,
        amount: finalPrice.toFixed(2),
        currency: 'USD',
        merchant_order_id: `LF-${plan.toUpperCase()}-${userId}-${Date.now()}`,
        descriptor: 'LeadRipper Trial',
        metadata: {
          userId: userId,
          plan: plan,
          planPrice: planDetails.price,
          trialPrice: finalPrice,
          couponCode: couponCode || null,
          discount: discount
        },
        customer: {
          email: email,
          name: name
        },
        return_url: `https://leadripper.advancedmarketing.co?payment=success`,
        cancel_url: `https://leadripper.advancedmarketing.co?payment=cancelled`
      })
    });

    const paymentData = await paymentIntent.json();

    if (!paymentData.id) {
      throw new Error('Failed to create payment intent');
    }

    // Store pending payment in database
    await pool.query(
      `INSERT INTO lr_pending_payments (user_id, payment_intent_id, plan, amount, status, created_at)
       VALUES ($1, $2, $3, $4, 'pending', NOW())`,
      [userId, paymentData.id, plan, finalPrice]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        clientSecret: paymentData.client_secret,
        paymentIntentId: paymentData.id,
        amount: finalPrice,
        plan: planDetails.name,
        discount: discount
      })
    };

  } catch (error) {
    console.error('Payment creation error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Failed to create payment',
        message: error.message
      })
    };
  }
};
