const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const twilio = require('twilio');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2026';

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

exports.handler = async (event, context) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    // Get user's Twilio credentials from settings
    const result = await pool.query(
      'SELECT twilio_account_sid, twilio_auth_token, twilio_phone_number, twilio_twiml_app_sid, twilio_api_key_sid, twilio_api_key_secret FROM lr_user_settings WHERE user_id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'No Twilio settings configured. Go to Settings to add your Twilio credentials.' })
      };
    }

    const settings = result.rows[0];
    const accountSid = settings.twilio_account_sid;
    const authToken = settings.twilio_auth_token;
    const phoneNumber = settings.twilio_phone_number;

    if (!accountSid || !authToken || !phoneNumber) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'Missing Twilio credentials. Please configure Account SID, Auth Token, and Phone Number in Settings.' })
      };
    }

    // Create a Twilio client to manage TwiML App and API Key
    const client = twilio(accountSid, authToken);

    // Get or create TwiML App
    let twimlAppSid = settings.twilio_twiml_app_sid;
    if (!twimlAppSid) {
      // Determine the base URL for the voice handler
      const siteUrl = process.env.URL || 'https://leadripper.com';
      const voiceUrl = `${siteUrl}/.netlify/functions/twilio-voice?UserId=${decoded.userId}`;

      const app = await client.applications.create({
        friendlyName: `LeadRipper Softphone - User ${decoded.userId}`,
        voiceMethod: 'POST',
        voiceUrl: voiceUrl
      });
      twimlAppSid = app.sid;

      // Save TwiML App SID
      await pool.query(
        'UPDATE lr_user_settings SET twilio_twiml_app_sid = $1, updated_at = NOW() WHERE user_id = $2',
        [twimlAppSid, decoded.userId]
      );
    }

    // Get or create API Key for token generation
    let apiKeySid = settings.twilio_api_key_sid;
    let apiKeySecret = settings.twilio_api_key_secret;
    if (!apiKeySid || !apiKeySecret) {
      const key = await client.newKeys.create({
        friendlyName: `LeadRipper Softphone Key - User ${decoded.userId}`
      });
      apiKeySid = key.sid;
      apiKeySecret = key.secret;

      // Save API Key credentials
      await pool.query(
        'UPDATE lr_user_settings SET twilio_api_key_sid = $1, twilio_api_key_secret = $2, updated_at = NOW() WHERE user_id = $3',
        [apiKeySid, apiKeySecret, decoded.userId]
      );
    }

    // Generate AccessToken with VoiceGrant
    const { AccessToken } = twilio.jwt;
    const { VoiceGrant } = AccessToken;

    const identity = 'leadripper-user-' + decoded.userId;

    const accessToken = new AccessToken(
      accountSid,
      apiKeySid,
      apiKeySecret,
      { identity: identity, ttl: 3600 }
    );

    const voiceGrant = new VoiceGrant({
      outgoingApplicationSid: twimlAppSid,
      incomingAllow: true
    });
    accessToken.addGrant(voiceGrant);

    // Fetch all phone numbers from the Twilio account for the "call from" dropdown
    let phoneNumbers = [{ phoneNumber, friendlyName: phoneNumber }];
    try {
      const incomingNumbers = await client.incomingPhoneNumbers.list({ limit: 20 });
      if (incomingNumbers.length > 0) {
        phoneNumbers = incomingNumbers.map(n => ({
          phoneNumber: n.phoneNumber,
          friendlyName: n.friendlyName || n.phoneNumber,
          sid: n.sid
        }));
      }
    } catch (e) {
      console.log('Could not list Twilio numbers:', e.message);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        token: accessToken.toJwt(),
        identity: identity,
        phoneNumber: phoneNumber,
        phoneNumbers: phoneNumbers
      })
    };

  } catch (error) {
    console.error('Twilio token error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to generate Twilio token', message: error.message })
    };
  }
};
