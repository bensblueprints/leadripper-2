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
      `SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id, ghl_stage_id,
              ghl_industry_pipelines, ghl_drip_enabled, ghl_drip_interval, resend_api_key, webhook_url,
              crm_mode, elevenlabs_api_key, elevenlabs_default_voice, email_signature,
              calendar_timezone, calendar_working_hours, ai_calling_enabled, default_email_account_id,
              auto_call_enabled, auto_call_agent_id, auto_followup_enabled, followup_agent_id
       FROM lr_user_settings WHERE user_id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          ghl_api_key: null,
          ghl_location_id: null,
          ghl_auto_sync: false,
          ghl_pipeline_id: null,
          ghl_stage_id: null,
          ghl_industry_pipelines: {},
          ghl_drip_enabled: false,
          ghl_drip_interval: 15,
          resend_api_key: null,
          webhook_url: null,
          hasGhlKey: false,
          hasResendKey: false,
          // CRM defaults
          crmMode: 'ghl',
          elevenlabsApiKey: null,
          elevenlabsDefaultVoice: null,
          emailSignature: null,
          calendarTimezone: 'America/New_York',
          calendarWorkingHours: { start: '09:00', end: '17:00', days: [1,2,3,4,5] },
          aiCallingEnabled: false,
          hasElevenlabsKey: false,
          defaultEmailAccountId: null,
          // Auto-call settings
          autoCallEnabled: false,
          autoCallAgentId: null,
          autoFollowupEnabled: false,
          followupAgentId: null
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

    // Parse calendar working hours
    let calendarWorkingHours = { start: '09:00', end: '17:00', days: [1,2,3,4,5] };
    try {
      if (settings.calendar_working_hours) {
        calendarWorkingHours = typeof settings.calendar_working_hours === 'string'
          ? JSON.parse(settings.calendar_working_hours)
          : settings.calendar_working_hours;
      }
    } catch (e) {
      console.error('Failed to parse calendar working hours:', e);
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
        // CRM Settings
        crmMode: settings.crm_mode || 'ghl',
        elevenlabsApiKey: settings.elevenlabs_api_key ? '••••••••' : null,
        elevenlabsDefaultVoice: settings.elevenlabs_default_voice,
        emailSignature: settings.email_signature,
        calendarTimezone: settings.calendar_timezone || 'America/New_York',
        calendarWorkingHours: calendarWorkingHours,
        aiCallingEnabled: settings.ai_calling_enabled || false,
        hasElevenlabsKey: !!settings.elevenlabs_api_key,
        defaultEmailAccountId: settings.default_email_account_id,
        // Auto-call settings
        autoCallEnabled: settings.auto_call_enabled || false,
        autoCallAgentId: settings.auto_call_agent_id,
        autoFollowupEnabled: settings.auto_followup_enabled || false,
        followupAgentId: settings.followup_agent_id
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
