const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { addCredits, PLAN_CREDITS } = require('./credits');

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let stripeEvent;

  try {
    // Verify webhook signature if secret is configured
    if (STRIPE_WEBHOOK_SECRET) {
      const sig = event.headers['stripe-signature'];
      if (!sig) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Missing stripe-signature header' }) };
      }
      stripeEvent = stripe.webhooks.constructEvent(event.body, sig, STRIPE_WEBHOOK_SECRET);
    } else {
      // No webhook secret configured — parse body directly (less secure, for initial setup)
      console.warn('STRIPE_WEBHOOK_SECRET not set — skipping signature verification');
      stripeEvent = JSON.parse(event.body);
    }
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Webhook signature verification failed' }) };
  }

  try {
    console.log('Stripe webhook event:', stripeEvent.type);

    // ── checkout.session.completed ──
    if (stripeEvent.type === 'checkout.session.completed') {
      const session = stripeEvent.data.object;
      const metadata = session.metadata || {};

      // Credit purchase
      if (metadata.type === 'credit_purchase' && metadata.credits && metadata.userId) {
        const creditAmount = parseInt(metadata.credits);
        const userId = parseInt(metadata.userId);

        console.log(`Stripe credit purchase: ${creditAmount} credits for user ${userId} (session ${session.id})`);

        const result = await addCredits(
          userId,
          creditAmount,
          'purchase',
          `Purchased ${creditAmount.toLocaleString()} credits (Stripe: ${session.id})`
        );

        console.log('Credits added successfully:', result);

        return {
          statusCode: 200, headers,
          body: JSON.stringify({ received: true, credits_added: creditAmount })
        };
      }

      // Subscription checkout (future use)
      if (metadata.type === 'subscription') {
        console.log('Subscription checkout completed:', session.id);
        // Handle subscription activation here if needed
      }

      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // ── invoice.paid (subscription renewals) ──
    if (stripeEvent.type === 'invoice.paid') {
      const invoice = stripeEvent.data.object;
      const metadata = invoice.subscription_details?.metadata || invoice.metadata || {};
      const userId = metadata.userId ? parseInt(metadata.userId) : null;
      const plan = metadata.plan;

      if (userId && plan) {
        const planCredits = PLAN_CREDITS[plan] || PLAN_CREDITS.free;
        if (planCredits > 0) {
          try {
            await addCredits(
              userId,
              planCredits,
              'subscription',
              `Monthly credit grant (${plan} plan): ${planCredits.toLocaleString()} credits (Stripe invoice: ${invoice.id})`
            );
            console.log(`Granted ${planCredits} monthly credits to user ${userId} (${plan} plan)`);
          } catch (e) {
            console.error('Failed to grant monthly credits:', e.message);
          }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // ── customer.subscription.deleted ──
    if (stripeEvent.type === 'customer.subscription.deleted') {
      const subscription = stripeEvent.data.object;
      const metadata = subscription.metadata || {};
      console.log('Subscription cancelled:', subscription.id, metadata);
      // Could downgrade user here if needed
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // ── payment_intent.payment_failed ──
    if (stripeEvent.type === 'payment_intent.payment_failed') {
      const pi = stripeEvent.data.object;
      console.log('Payment failed:', pi.id, pi.last_payment_error?.message);
      return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };
    }

    // All other events — just acknowledge
    console.log('Unhandled Stripe event type:', stripeEvent.type);
    return { statusCode: 200, headers, body: JSON.stringify({ received: true }) };

  } catch (error) {
    console.error('Stripe webhook processing error:', error);
    return {
      statusCode: 500, headers,
      body: JSON.stringify({ error: 'Webhook processing failed', message: error.message })
    };
  }
};
