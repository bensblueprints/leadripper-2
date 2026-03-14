const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

function verifyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  try {
    return jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
  } catch {
    return null;
  }
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
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  const userId = decoded.userId;

  try {
    const { leadId, listId, agentId, phoneNumber, contactName } = JSON.parse(event.body);

    if (!agentId || !phoneNumber) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'agentId and phoneNumber are required' }) };
    }

    // Get user's ElevenLabs API key from settings
    const settingsResult = await pool.query(
      'SELECT elevenlabs_api_key FROM lr_user_settings WHERE user_id = $1',
      [userId]
    );

    if (settingsResult.rows.length === 0 || !settingsResult.rows[0].elevenlabs_api_key) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'ElevenLabs API key not configured. Please add it in Settings.' })
      };
    }

    const elevenlabsApiKey = settingsResult.rows[0].elevenlabs_api_key;

    // Try the primary outbound call endpoint
    const callPayload = {
      agent_id: agentId,
      customer_phone_number: phoneNumber,
      customer_name: contactName || 'Unknown'
    };

    let callResponse;
    let conversationId;

    try {
      // Primary endpoint
      const res = await fetch('https://api.elevenlabs.io/v1/convai/conversation/create-call', {
        method: 'POST',
        headers: {
          'xi-api-key': elevenlabsApiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(callPayload)
      });

      callResponse = await res.json();

      if (!res.ok) {
        // Try fallback endpoint
        const fallbackRes = await fetch('https://api.elevenlabs.io/v1/convai/twilio/outbound-call', {
          method: 'POST',
          headers: {
            'xi-api-key': elevenlabsApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(callPayload)
        });

        callResponse = await fallbackRes.json();

        if (!fallbackRes.ok) {
          return {
            statusCode: 502,
            headers,
            body: JSON.stringify({
              error: 'Failed to initiate call via ElevenLabs',
              details: callResponse
            })
          };
        }
      }
    } catch (fetchError) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          error: 'Failed to connect to ElevenLabs API',
          message: fetchError.message
        })
      };
    }

    conversationId = callResponse.conversation_id || callResponse.id || null;

    // Store the call in lr_call_logs
    const logResult = await pool.query(
      `INSERT INTO lr_call_logs
        (user_id, lead_id, list_id, agent_id, elevenlabs_conversation_id,
         phone_number, contact_name, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'initiated', NOW(), NOW())
       RETURNING *`,
      [
        userId,
        leadId || null,
        listId || null,
        agentId,
        conversationId,
        phoneNumber,
        contactName || null
      ]
    );

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Call initiated successfully',
        callLog: logResult.rows[0],
        elevenlabsResponse: callResponse
      })
    };
  } catch (error) {
    console.error('Initiate call error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) };
  }
};
