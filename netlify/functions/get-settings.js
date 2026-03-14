const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

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
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'GET') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: 'Method not allowed' })
    };
  }

  const decoded = verifyToken(event.headers.authorization);
  if (!decoded) {
    return {
      statusCode: 401,
      headers,
      body: JSON.stringify({ error: 'Unauthorized' })
    };
  }

  try {
    const result = await pool.query(
      `SELECT * FROM lr_user_settings WHERE user_id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ghl_api_key: null, ghl_location_id: null, ghl_auto_sync: false,
          ghl_pipeline_id: null, ghl_stage_id: null, ghl_industry_pipelines: {},
          ghl_drip_enabled: false, ghl_drip_interval: 15,
          resend_api_key: null, webhook_url: null,
          hasGhlKey: false, hasResendKey: false,
          elevenlabsApiKey: null, elevenlabsDefaultVoice: null,
          aiCallingEnabled: false, autoCallEnabled: false, autoCallAgentId: null,
          autoFollowupEnabled: false, followupAgentId: null,
          crmMode: 'ghl', emailSignature: null,
          calendarTimezone: null, calendarWorkingHours: null,
          twilioAccountSid: null, twilioPhoneNumber: null, hasTwilioCredentials: false
        })
      };
    }

    const settings = result.rows[0];

    let industryPipelines = {};
    try {
      if (settings.ghl_industry_pipelines) {
        industryPipelines = JSON.parse(settings.ghl_industry_pipelines);
      }
    } catch (e) {
      console.error('Failed to parse industry pipelines:', e);
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ghl_api_key: settings.ghl_api_key ? '••••••••' : null,
        ghl_location_id: settings.ghl_location_id,
        ghl_auto_sync: settings.ghl_auto_sync,
        ghl_pipeline_id: settings.ghl_pipeline_id,
        ghl_stage_id: settings.ghl_stage_id,
        ghl_industry_pipelines: industryPipelines,
        ghl_drip_enabled: settings.ghl_drip_enabled || false,
        ghl_drip_interval: settings.ghl_drip_interval || 15,
        resend_api_key: settings.resend_api_key ? '••••••••' : null,
        webhook_url: settings.webhook_url,
        hasGhlKey: !!settings.ghl_api_key,
        hasResendKey: !!settings.resend_api_key,
        elevenlabsApiKey: settings.elevenlabs_api_key || null,
        elevenlabsDefaultVoice: settings.elevenlabs_default_voice || null,
        aiCallingEnabled: settings.ai_calling_enabled || false,
        autoCallEnabled: settings.auto_call_enabled || false,
        autoCallAgentId: settings.auto_call_agent_id || null,
        autoFollowupEnabled: settings.auto_followup_enabled || false,
        followupAgentId: settings.followup_agent_id || null,
        crmMode: settings.crm_mode || 'ghl',
        emailSignature: settings.email_signature || null,
        calendarTimezone: settings.calendar_timezone || null,
        calendarWorkingHours: settings.calendar_working_hours ? JSON.parse(settings.calendar_working_hours) : null,
        twilioAccountSid: settings.twilio_account_sid ? '••••••••' : null,
        twilioPhoneNumber: settings.twilio_phone_number || null,
        hasTwilioCredentials: !!(settings.twilio_account_sid && settings.twilio_auth_token && settings.twilio_phone_number)
      })
    };
  } catch (error) {
    console.error('Get settings error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to get settings', message: error.message })
    };
  }
};
