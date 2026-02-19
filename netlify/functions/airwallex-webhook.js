const { createClient } = require('@supabase/supabase-js');
const fetch = require('node-fetch');

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL || 'https://eyaitfxwjhsrizsbqcem.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV5YWl0Znh3amhzcml6c2JxY2VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAzODk0NDYsImV4cCI6MjA4NTk2NTQ0Nn0.xihzbULV2wrhX3JvB8ZER98wUKPlwX2xzEBuYrJVDNA'
);

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

// Plan configuration
const PLANS = {
  basic: { leads: 500 },
  starter: { leads: 500 },
  advanced: { leads: 2500 },
  premium: { leads: 10000 },
  enterprise: { leads: -1 },
  unlimited: { leads: -1 }
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

async function createSubscription(accessToken, billingCustomerId, priceId, paymentMethodId, userId, plan) {
  const payload = {
    request_id: `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    billing_customer_id: billingCustomerId,
    collection_method: 'AUTO_CHARGE',
    payment_method_id: paymentMethodId,
    items: [
      {
        price_id: priceId,
        quantity: 1
      }
    ],
    trial_period: {
      period_unit: 'DAY',
      period: 7
    },
    metadata: {
      user_id: userId.toString(),
      plan: plan,
      source: 'leadripper_webhook'
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
    const webhookData = JSON.parse(event.body);
    const { event_type, data } = webhookData;

    console.log('Airwallex webhook received:', event_type);

    // Handle payment intent succeeded
    if (event_type === 'payment_intent.succeeded') {
      const paymentIntentId = data.id;
      const metadata = data.metadata || {};
      let userId = metadata.user_id || metadata.userId;
      let plan = metadata.plan_id || metadata.plan;

      // If user_id not in metadata, check subscription table using Supabase
      if (!userId || !plan) {
        const { data: subData, error: subError } = await supabase
          .from('lr_subscriptions')
          .select('user_id, plan')
          .eq('payment_intent_id', paymentIntentId)
          .limit(1);

        if (subData && subData.length > 0) {
          userId = subData[0].user_id;
          plan = subData[0].plan;
        }
      }

      if (!userId || !plan) {
        console.error('Missing metadata in payment intent');
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid payment metadata' })
        };
      }

      // Update pending payment using Supabase
      await supabase
        .from('lr_pending_payments')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('payment_intent_id', paymentIntentId);

      // Get payment method from payment intent
      const paymentMethodId = data.payment_method_id || data.latest_payment_method_id;

      // Get billing customer ID from subscription record
      const { data: subData } = await supabase
        .from('lr_subscriptions')
        .select('airwallex_customer_id, airwallex_subscription_id')
        .eq('payment_intent_id', paymentIntentId)
        .single();

      if (!subData || !subData.airwallex_customer_id) {
        console.error('No billing customer found for payment intent');
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'No billing customer found' })
        };
      }

      // Only create subscription if it doesn't exist yet
      let subscriptionId = subData.airwallex_subscription_id;

      if (!subscriptionId && paymentMethodId) {
        // Get Airwallex token
        const accessToken = await getAirwallexToken();

        // Create subscription with payment method from successful payment
        console.log('Creating Airwallex subscription with payment method...');
        const subscription = await createSubscription(
          accessToken,
          subData.airwallex_customer_id,
          PRICE_IDS[plan],
          paymentMethodId,
          userId,
          plan
        );
        subscriptionId = subscription.id;
      }

      // Calculate trial end date (7 days from now)
      const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      // Update user plan and subscription using Supabase
      await supabase
        .from('lr_users')
        .update({
          plan: plan,
          leads_limit: PLANS[plan].leads,
          trial_ends_at: trialEndsAt,
          leads_used: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      // Update subscription with Airwallex subscription ID
      const { error: upsertError } = await supabase
        .from('lr_subscriptions')
        .update({
          status: 'active',
          is_trial: true,
          trial_ends_at: trialEndsAt,
          current_period_end: trialEndsAt,
          airwallex_subscription_id: subscriptionId,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      console.log(`Payment successful for user ${userId}, plan: ${plan}, subscription: ${subscriptionId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true })
      };
    }

    // Handle payment intent failed
    if (event_type === 'payment_intent.payment_failed') {
      const paymentIntentId = data.id;

      await supabase
        .from('lr_pending_payments')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        })
        .eq('payment_intent_id', paymentIntentId);

      console.log(`Payment failed for intent ${paymentIntentId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true })
      };
    }

    // Handle subscription activated (trial ended, first payment succeeded)
    if (event_type === 'subscription.activated' || event_type === 'subscription.updated') {
      const subscription = data;
      const subscriptionId = subscription.id;
      const metadata = subscription.metadata || {};
      const userId = metadata.user_id;
      const plan = metadata.plan;

      if (!userId || !plan) {
        console.error('Missing metadata in subscription');
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: 'Invalid subscription metadata' })
        };
      }

      // Update subscription status using Supabase
      await supabase
        .from('lr_subscriptions')
        .update({
          status: 'active',
          is_trial: false,
          updated_at: new Date().toISOString()
        })
        .eq('airwallex_subscription_id', subscriptionId);

      // Update user to full paid plan using Supabase
      await supabase
        .from('lr_users')
        .update({
          plan: plan,
          leads_limit: PLANS[plan].leads,
          trial_ends_at: null,
          updated_at: new Date().toISOString()
        })
        .eq('id', userId);

      console.log(`Subscription activated for user ${userId}, plan: ${plan}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true })
      };
    }

    // Handle subscription cancelled
    if (event_type === 'subscription.cancelled') {
      const subscription = data;
      const subscriptionId = subscription.id;

      // Get user from subscription using Supabase
      const { data: subData, error: subError } = await supabase
        .from('lr_subscriptions')
        .select('user_id')
        .eq('airwallex_subscription_id', subscriptionId)
        .limit(1);

      if (subData && subData.length > 0) {
        const userId = subData[0].user_id;

        // Update subscription status using Supabase
        await supabase
          .from('lr_subscriptions')
          .update({
            status: 'cancelled',
            updated_at: new Date().toISOString()
          })
          .eq('airwallex_subscription_id', subscriptionId);

        // Downgrade user to free plan using Supabase
        await supabase
          .from('lr_users')
          .update({
            plan: 'free',
            leads_limit: 50,
            updated_at: new Date().toISOString()
          })
          .eq('id', userId);

        console.log(`Subscription cancelled for user ${userId}`);
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true })
      };
    }

    // Handle subscription payment failed
    if (event_type === 'subscription.payment_failed') {
      const subscription = data;
      const subscriptionId = subscription.id;

      // Update subscription status to unpaid using Supabase
      await supabase
        .from('lr_subscriptions')
        .update({
          status: 'unpaid',
          updated_at: new Date().toISOString()
        })
        .eq('airwallex_subscription_id', subscriptionId);

      console.log(`Subscription payment failed for ${subscriptionId}`);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ received: true })
      };
    }

    // Other events - just acknowledge
    console.log(`Unhandled event type: ${event_type}`);
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ received: true })
    };

  } catch (error) {
    console.error('Webhook processing error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        error: 'Webhook processing failed',
        message: error.message
      })
    };
  }
};
