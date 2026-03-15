const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

// Credit packages: key = credit amount, price in cents
const CREDIT_PACKAGES = {
  '1000':   { credits: 1000,   price: 1000,   name: '1,000 Credits' },
  '6000':   { credits: 6000,   price: 5000,   name: '6,000 Credits (+20% Bonus)' },
  '13000':  { credits: 13000,  price: 10000,  name: '13,000 Credits (+30% Bonus)' },
  '75000':  { credits: 75000,  price: 50000,  name: '75,000 Credits (+50% Bonus)' },
  '165000': { credits: 165000, price: 100000, name: '165,000 Credits (+65% Bonus)' },
};

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try { return jwt.verify(authHeader.split(' ')[1], JWT_SECRET); } catch { return null; }
}

exports.handler = async (event) => {
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
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    // Verify auth
    const decoded = verifyToken(event.headers.authorization || event.headers.Authorization);
    if (!decoded) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const userId = decoded.userId;
    const { package: packageKey, credits } = JSON.parse(event.body);
    const pkg = CREDIT_PACKAGES[packageKey] || CREDIT_PACKAGES[String(credits)];

    if (!pkg) {
      return {
        statusCode: 400, headers,
        body: JSON.stringify({ error: 'Invalid credit package. Options: ' + Object.keys(CREDIT_PACKAGES).join(', ') })
      };
    }

    // Get user email for pre-filling checkout
    let customerEmail = null;
    try {
      const userResult = await pool.query('SELECT email FROM lr_users WHERE id = $1', [userId]);
      if (userResult.rows.length > 0) {
        customerEmail = userResult.rows[0].email;
      }
    } catch (e) {
      console.log('Could not fetch user email:', e.message);
    }

    const siteUrl = process.env.URL || 'https://leadripper.com';

    // Create Stripe Checkout Session
    const sessionParams = {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: {
            name: `LeadRipper ${pkg.name}`,
            description: `${pkg.credits.toLocaleString()} credits for LeadRipper`,
          },
          unit_amount: pkg.price,
        },
        quantity: 1,
      }],
      metadata: {
        userId: String(userId),
        credits: String(pkg.credits),
        type: 'credit_purchase',
        package: packageKey || String(credits),
      },
      success_url: `${siteUrl}/app?credits_purchased=${pkg.credits}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl}/app?credits_cancelled=1`,
    };

    // Pre-fill email if available
    if (customerEmail) {
      sessionParams.customer_email = customerEmail;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        url: session.url,
        sessionId: session.id,
        credits: pkg.credits,
        amount: pkg.price / 100,
      })
    };

  } catch (error) {
    console.error('Stripe checkout error:', error);
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
