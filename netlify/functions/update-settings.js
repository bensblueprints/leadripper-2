const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

const JWT_SECRET = process.env.JWT_SECRET || 'leadripper-secret-key-2024';

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

  if (event.httpMethod !== 'POST') {
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
    const {
      ghlApiKey, ghlLocationId, ghlAutoSync, ghlPipelineId, ghlStageId, ghlIndustryPipelines,
      ghlDripEnabled, ghlDripInterval, resendApiKey, webhookUrl, name, company,
      // CRM Settings
      crmMode, elevenlabsApiKey, elevenlabsDefaultVoice, emailSignature,
      calendarTimezone, calendarWorkingHours, aiCallingEnabled,
      // Auto-call settings
      autoCallEnabled, autoCallAgentId, autoFollowupEnabled, followupAgentId
    } = JSON.parse(event.body);

    // Update user profile if provided
    if (name !== undefined || company !== undefined) {
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        values.push(name);
        paramIndex++;
      }
      if (company !== undefined) {
        updates.push(`company = $${paramIndex}`);
        values.push(company);
        paramIndex++;
      }

      values.push(decoded.userId);
      await pool.query(
        `UPDATE lr_users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${paramIndex}`,
        values
      );
    }

    // Update settings if provided
    const hasSettingsUpdate = ghlApiKey !== undefined || ghlLocationId !== undefined || ghlAutoSync !== undefined ||
      ghlPipelineId !== undefined || ghlStageId !== undefined || ghlIndustryPipelines !== undefined ||
      ghlDripEnabled !== undefined || ghlDripInterval !== undefined || resendApiKey !== undefined ||
      webhookUrl !== undefined || crmMode !== undefined || elevenlabsApiKey !== undefined ||
      elevenlabsDefaultVoice !== undefined || emailSignature !== undefined || calendarTimezone !== undefined ||
      calendarWorkingHours !== undefined || aiCallingEnabled !== undefined ||
      autoCallEnabled !== undefined || autoCallAgentId !== undefined ||
      autoFollowupEnabled !== undefined || followupAgentId !== undefined;

    if (hasSettingsUpdate) {
      // First ensure settings row exists
      await pool.query(
        `INSERT INTO lr_user_settings (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [decoded.userId]
      );

      const settingsUpdates = [];
      const settingsValues = [];
      let paramIndex = 1;

      if (ghlApiKey !== undefined) {
        settingsUpdates.push(`ghl_api_key = $${paramIndex}`);
        settingsValues.push(ghlApiKey);
        paramIndex++;
      }
      if (ghlLocationId !== undefined) {
        settingsUpdates.push(`ghl_location_id = $${paramIndex}`);
        settingsValues.push(ghlLocationId);
        paramIndex++;
      }
      if (ghlAutoSync !== undefined) {
        settingsUpdates.push(`ghl_auto_sync = $${paramIndex}`);
        settingsValues.push(ghlAutoSync);
        paramIndex++;
      }
      if (ghlPipelineId !== undefined) {
        settingsUpdates.push(`ghl_pipeline_id = $${paramIndex}`);
        settingsValues.push(ghlPipelineId);
        paramIndex++;
      }
      if (ghlStageId !== undefined) {
        settingsUpdates.push(`ghl_stage_id = $${paramIndex}`);
        settingsValues.push(ghlStageId);
        paramIndex++;
      }
      if (resendApiKey !== undefined) {
        settingsUpdates.push(`resend_api_key = $${paramIndex}`);
        settingsValues.push(resendApiKey);
        paramIndex++;
      }
      if (webhookUrl !== undefined) {
        settingsUpdates.push(`webhook_url = $${paramIndex}`);
        settingsValues.push(webhookUrl);
        paramIndex++;
      }
      if (ghlIndustryPipelines !== undefined) {
        settingsUpdates.push(`ghl_industry_pipelines = $${paramIndex}`);
        settingsValues.push(JSON.stringify(ghlIndustryPipelines));
        paramIndex++;
      }
      if (ghlDripEnabled !== undefined) {
        settingsUpdates.push(`ghl_drip_enabled = $${paramIndex}`);
        settingsValues.push(ghlDripEnabled);
        paramIndex++;
      }
      if (ghlDripInterval !== undefined) {
        settingsUpdates.push(`ghl_drip_interval = $${paramIndex}`);
        settingsValues.push(ghlDripInterval);
        paramIndex++;
      }

      // CRM Settings
      if (crmMode !== undefined) {
        settingsUpdates.push(`crm_mode = $${paramIndex}`);
        settingsValues.push(crmMode);
        paramIndex++;
      }
      if (elevenlabsApiKey !== undefined && elevenlabsApiKey !== '••••••••') {
        settingsUpdates.push(`elevenlabs_api_key = $${paramIndex}`);
        settingsValues.push(elevenlabsApiKey);
        paramIndex++;
      }
      if (elevenlabsDefaultVoice !== undefined) {
        settingsUpdates.push(`elevenlabs_default_voice = $${paramIndex}`);
        settingsValues.push(elevenlabsDefaultVoice);
        paramIndex++;
      }
      if (emailSignature !== undefined) {
        settingsUpdates.push(`email_signature = $${paramIndex}`);
        settingsValues.push(emailSignature);
        paramIndex++;
      }
      if (calendarTimezone !== undefined) {
        settingsUpdates.push(`calendar_timezone = $${paramIndex}`);
        settingsValues.push(calendarTimezone);
        paramIndex++;
      }
      if (calendarWorkingHours !== undefined) {
        settingsUpdates.push(`calendar_working_hours = $${paramIndex}`);
        settingsValues.push(JSON.stringify(calendarWorkingHours));
        paramIndex++;
      }
      if (aiCallingEnabled !== undefined) {
        settingsUpdates.push(`ai_calling_enabled = $${paramIndex}`);
        settingsValues.push(aiCallingEnabled);
        paramIndex++;
      }

      // Auto-call settings
      if (autoCallEnabled !== undefined) {
        settingsUpdates.push(`auto_call_enabled = $${paramIndex}`);
        settingsValues.push(autoCallEnabled);
        paramIndex++;
      }
      if (autoCallAgentId !== undefined) {
        settingsUpdates.push(`auto_call_agent_id = $${paramIndex}`);
        settingsValues.push(autoCallAgentId);
        paramIndex++;
      }
      if (autoFollowupEnabled !== undefined) {
        settingsUpdates.push(`auto_followup_enabled = $${paramIndex}`);
        settingsValues.push(autoFollowupEnabled);
        paramIndex++;
      }
      if (followupAgentId !== undefined) {
        settingsUpdates.push(`followup_agent_id = $${paramIndex}`);
        settingsValues.push(followupAgentId);
        paramIndex++;
      }

      if (settingsUpdates.length > 0) {
        settingsValues.push(decoded.userId);
        await pool.query(
          `UPDATE lr_user_settings SET ${settingsUpdates.join(', ')}, updated_at = NOW() WHERE user_id = $${paramIndex}`,
          settingsValues
        );
      }
    }

    // Fetch updated data
    const userResult = await pool.query(
      'SELECT id, email, name, company, plan, leads_used, leads_limit FROM lr_users WHERE id = $1',
      [decoded.userId]
    );
    const settingsResult = await pool.query(
      `SELECT ghl_api_key, ghl_location_id, ghl_auto_sync, ghl_pipeline_id, ghl_stage_id,
              ghl_industry_pipelines, ghl_drip_enabled, ghl_drip_interval, resend_api_key, webhook_url,
              crm_mode, elevenlabs_api_key, elevenlabs_default_voice, email_signature,
              calendar_timezone, calendar_working_hours, ai_calling_enabled
       FROM lr_user_settings WHERE user_id = $1`,
      [decoded.userId]
    );

    const user = userResult.rows[0];
    const settings = settingsResult.rows[0] || {};

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: 'Settings updated successfully',
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          company: user.company,
          plan: user.plan,
          leadsUsed: user.leads_used,
          leadsLimit: user.leads_limit
        },
        settings: {
          ghlApiKey: settings.ghl_api_key ? '••••••••' : null,
          ghlLocationId: settings.ghl_location_id,
          ghlAutoSync: settings.ghl_auto_sync,
          ghlPipelineId: settings.ghl_pipeline_id,
          ghlStageId: settings.ghl_stage_id,
          ghlIndustryPipelines: settings.ghl_industry_pipelines ? JSON.parse(settings.ghl_industry_pipelines) : {},
          ghlDripEnabled: settings.ghl_drip_enabled || false,
          ghlDripInterval: settings.ghl_drip_interval || 15,
          resendApiKey: settings.resend_api_key ? '••••••••' : null,
          webhookUrl: settings.webhook_url,
          hasGhlKey: !!settings.ghl_api_key,
          hasResendKey: !!settings.resend_api_key,
          // CRM Settings
          crmMode: settings.crm_mode || 'ghl',
          elevenlabsApiKey: settings.elevenlabs_api_key ? '••••••••' : null,
          elevenlabsDefaultVoice: settings.elevenlabs_default_voice,
          emailSignature: settings.email_signature,
          calendarTimezone: settings.calendar_timezone || 'America/New_York',
          calendarWorkingHours: settings.calendar_working_hours || { start: '09:00', end: '17:00', days: [1,2,3,4,5] },
          aiCallingEnabled: settings.ai_calling_enabled || false,
          hasElevenlabsKey: !!settings.elevenlabs_api_key
        }
      })
    };
  } catch (error) {
    console.error('Update settings error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to update settings', message: error.message })
    };
  }
};
