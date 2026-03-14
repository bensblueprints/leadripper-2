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
    const { ghlApiKey, ghlLocationId, ghlAutoSync, ghlPipelineId, ghlStageId, ghlIndustryPipelines, ghlDripEnabled, ghlDripInterval, resendApiKey, webhookUrl, name, company, elevenlabsApiKey, elevenlabsDefaultVoice, aiCallingEnabled, autoCallEnabled, autoCallAgentId, autoFollowupEnabled, followupAgentId, crmMode, emailSignature, calendarTimezone, calendarWorkingHours, twilioAccountSid, twilioAuthToken, twilioPhoneNumber, netlifyToken, githubToken, githubUsername } = JSON.parse(event.body);

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
    const hasSettingsUpdate = [ghlApiKey, ghlLocationId, ghlAutoSync, ghlPipelineId, ghlStageId, ghlIndustryPipelines, ghlDripEnabled, ghlDripInterval, resendApiKey, webhookUrl, elevenlabsApiKey, elevenlabsDefaultVoice, aiCallingEnabled, autoCallEnabled, autoCallAgentId, autoFollowupEnabled, followupAgentId, crmMode, emailSignature, calendarTimezone, calendarWorkingHours, twilioAccountSid, twilioAuthToken, twilioPhoneNumber, netlifyToken, githubToken, githubUsername].some(v => v !== undefined);
    if (hasSettingsUpdate) {
      // First ensure settings row exists
      await pool.query(
        `INSERT INTO lr_user_settings (user_id, created_at, updated_at) VALUES ($1, NOW(), NOW())
         ON CONFLICT (user_id) DO NOTHING`,
        [decoded.userId]
      );

      // Auto-migrate: add deployment credential columns if they don't exist
      await pool.query(`
        ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS netlify_token TEXT;
        ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS github_token TEXT;
        ALTER TABLE lr_user_settings ADD COLUMN IF NOT EXISTS github_username VARCHAR(255);
      `);

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
      if (elevenlabsApiKey !== undefined) {
        settingsUpdates.push(`elevenlabs_api_key = $${paramIndex}`);
        settingsValues.push(elevenlabsApiKey);
        paramIndex++;
      }
      if (elevenlabsDefaultVoice !== undefined) {
        settingsUpdates.push(`elevenlabs_default_voice = $${paramIndex}`);
        settingsValues.push(elevenlabsDefaultVoice);
        paramIndex++;
      }
      if (aiCallingEnabled !== undefined) {
        settingsUpdates.push(`ai_calling_enabled = $${paramIndex}`);
        settingsValues.push(aiCallingEnabled);
        paramIndex++;
      }
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
      if (crmMode !== undefined) {
        settingsUpdates.push(`crm_mode = $${paramIndex}`);
        settingsValues.push(crmMode);
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
      if (twilioAccountSid !== undefined) {
        settingsUpdates.push(`twilio_account_sid = $${paramIndex}`);
        settingsValues.push(twilioAccountSid);
        paramIndex++;
        // Clear auto-generated keys when SID changes so they get re-created
        settingsUpdates.push(`twilio_twiml_app_sid = NULL`);
        settingsUpdates.push(`twilio_api_key_sid = NULL`);
        settingsUpdates.push(`twilio_api_key_secret = NULL`);
      }
      if (twilioAuthToken !== undefined) {
        settingsUpdates.push(`twilio_auth_token = $${paramIndex}`);
        settingsValues.push(twilioAuthToken);
        paramIndex++;
      }
      if (twilioPhoneNumber !== undefined) {
        settingsUpdates.push(`twilio_phone_number = $${paramIndex}`);
        settingsValues.push(twilioPhoneNumber);
        paramIndex++;
      }
      if (netlifyToken !== undefined) {
        settingsUpdates.push(`netlify_token = $${paramIndex}`);
        settingsValues.push(netlifyToken);
        paramIndex++;
      }
      if (githubToken !== undefined) {
        settingsUpdates.push(`github_token = $${paramIndex}`);
        settingsValues.push(githubToken);
        paramIndex++;
      }
      if (githubUsername !== undefined) {
        settingsUpdates.push(`github_username = $${paramIndex}`);
        settingsValues.push(githubUsername);
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
      'SELECT * FROM lr_user_settings WHERE user_id = $1',
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
          hasTwilioCredentials: !!(settings.twilio_account_sid && settings.twilio_auth_token && settings.twilio_phone_number),
          netlifyToken: settings.netlify_token ? '••••••••' : null,
          githubToken: settings.github_token ? '••••••••' : null,
          githubUsername: settings.github_username || null,
          hasNetlifyToken: !!settings.netlify_token,
          hasGithubToken: !!settings.github_token
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
