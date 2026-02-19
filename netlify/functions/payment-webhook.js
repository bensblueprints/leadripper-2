const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const AIRWALLEX_WEBHOOK_SECRET = process.env.AIRWALLEX_WEBHOOK_SECRET;

// LeadRipper Plans Configuration
const PLANS = {
  starter: {
    leads_limit: 500
  },
  advanced: {
    leads_limit: 2500
  },
  premium: {
    leads_limit: 10000
  },
  unlimited: {
    leads_limit: -1 // unlimited
  }
};

function verifyWebhookSignature(payload, signature, timestamp) {
  if (!AIRWALLEX_WEBHOOK_SECRET) {
    console.warn('Webhook secret not configured, skipping verification');
    return true;
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expectedSignature = crypto
    .createHmac('sha256', AIRWALLEX_WEBHOOK_SECRET)
    .update(signedPayload)
    .digest('hex');

  return signature === expectedSignature;
}

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  try {
    const signature = event.headers['x-signature'];
    const timestamp = event.headers['x-timestamp'];

    // Verify signature if configured
    if (AIRWALLEX_WEBHOOK_SECRET && !verifyWebhookSignature(event.body, signature, timestamp)) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Invalid signature' })
      };
    }

    const webhookEvent = JSON.parse(event.body);
    console.log('🔔 Webhook event received:', webhookEvent.name);

    // Handle different event types
    switch (webhookEvent.name) {
      case 'payment_intent.succeeded':
        await handlePaymentSuccess(webhookEvent.data.object);
        break;

      case 'payment_intent.payment_failed':
        await handlePaymentFailed(webhookEvent.data.object);
        break;

      case 'payment_intent.cancelled':
        await handlePaymentCancelled(webhookEvent.data.object);
        break;

      default:
        console.log('Unhandled event type:', webhookEvent.name);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true })
    };
  } catch (error) {
    console.error('❌ Webhook error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Webhook processing failed' })
    };
  }
};

async function handlePaymentSuccess(paymentIntent) {
  console.log('✅ Payment succeeded:', paymentIntent.id);
  console.log('📦 Payment metadata:', paymentIntent.metadata);

  // Find subscription by payment intent ID
  const subResult = await pool.query(
    'SELECT user_id, plan, billing_cycle, is_trial, trial_ends_at FROM lr_subscriptions WHERE payment_intent_id = $1',
    [paymentIntent.id]
  );

  if (subResult.rows.length === 0) {
    console.log('⚠️  No pending subscription found for payment intent:', paymentIntent.id);
    return;
  }

  const { user_id, plan, billing_cycle, is_trial, trial_ends_at } = subResult.rows[0];
  const planConfig = PLANS[plan] || PLANS.starter;

  // Calculate period end based on plan type
  let periodEnd = new Date();
  let trialEndsAtFinal = null;

  if (is_trial) {
    // This is a $1 trial - 7 days then need to charge full price
    periodEnd.setDate(periodEnd.getDate() + 7);
    trialEndsAtFinal = new Date(periodEnd);
    console.log(`🎯 Setting up 7-day $1 trial for user ${user_id}, ends ${periodEnd.toISOString()}`);
  } else if (billing_cycle === 'annual') {
    // Annual subscription
    periodEnd.setDate(periodEnd.getDate() + 365);
    console.log(`📅 User ${user_id} subscribed to ${plan} annual plan`);
  } else {
    // Monthly subscription
    periodEnd.setDate(periodEnd.getDate() + 30);
    console.log(`📅 User ${user_id} subscribed to ${plan} monthly plan`);
  }

  // Update subscription to active
  await pool.query(
    `UPDATE lr_subscriptions
     SET status = 'active',
         current_period_end = $1,
         updated_at = NOW()
     WHERE user_id = $2`,
    [periodEnd, user_id]
  );

  // Update user's plan and leads limit
  if (is_trial) {
    // Trial user - set trial_ends_at for auto-billing reminder
    await pool.query(
      `UPDATE lr_users
       SET plan = $1,
           leads_limit = $2,
           leads_used = 0,
           trial_ends_at = $3,
           updated_at = NOW()
       WHERE id = $4`,
      [plan, planConfig.leads_limit, trialEndsAtFinal, user_id]
    );
    console.log(`🎯 User ${user_id} started $1 trial until ${trialEndsAtFinal.toISOString()}`);
  } else {
    // Full subscription
    await pool.query(
      `UPDATE lr_users
       SET plan = $1,
           leads_limit = $2,
           leads_used = 0,
           trial_ends_at = NULL,
           updated_at = NOW()
       WHERE id = $3`,
      [plan, planConfig.leads_limit, user_id]
    );
    console.log(`🚀 User ${user_id} upgraded to ${plan} plan`);
  }

  console.log(`✅ Payment processed successfully for user ${user_id}`);
}

async function handlePaymentFailed(paymentIntent) {
  console.log('❌ Payment failed:', paymentIntent.id);

  // Update subscription status
  await pool.query(
    `UPDATE lr_subscriptions
     SET status = 'payment_failed',
         updated_at = NOW()
     WHERE payment_intent_id = $1`,
    [paymentIntent.id]
  );
}

async function handlePaymentCancelled(paymentIntent) {
  console.log('🚫 Payment cancelled:', paymentIntent.id);

  // Remove pending subscription
  await pool.query(
    `DELETE FROM lr_subscriptions WHERE payment_intent_id = $1 AND status = 'pending'`,
    [paymentIntent.id]
  );
}
