const { Pool } = require('pg');
const jwt = require('jsonwebtoken');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require",
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

async function createGHLContact(apiKey, locationId, lead, pipelineId = null, stageId = null) {
  const contactData = {
    firstName: lead.business_name.split(' ')[0] || 'Business',
    lastName: lead.business_name.split(' ').slice(1).join(' ') || 'Owner',
    name: lead.business_name,
    email: lead.email || undefined,
    phone: lead.phone || undefined,
    address1: lead.address || undefined,
    city: lead.city || undefined,
    state: lead.state || undefined,
    companyName: lead.business_name,
    website: lead.website || undefined,
    source: 'LeadRipper AI',
    locationId: locationId,
    tags: ['leadripper', lead.industry || 'general'].filter(Boolean)
  };

  const response = await fetch('https://services.leadconnectorhq.com/contacts/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    body: JSON.stringify(contactData)
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GHL API error: ${error}`);
  }

  const contactResult = await response.json();
  const contactId = contactResult.contact?.id || contactResult.id;

  // If we have a pipeline ID, add the contact to the pipeline
  if (pipelineId && contactId) {
    try {
      await addContactToPipeline(apiKey, contactId, pipelineId, locationId, stageId);
    } catch (pipelineError) {
      console.error('Failed to add contact to pipeline:', pipelineError.message);
      // Continue even if pipeline assignment fails
    }
  }

  return contactResult;
}

async function getFirstStageId(apiKey, pipelineId, locationId) {
  // Fetch the pipeline to get its stages
  const response = await fetch(`https://services.leadconnectorhq.com/opportunities/pipelines/${pipelineId}?locationId=${locationId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    }
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to fetch pipeline stages: ${error}`);
  }

  const pipelineData = await response.json();
  const stages = pipelineData.pipeline?.stages || pipelineData.stages || [];

  if (stages.length === 0) {
    throw new Error('Pipeline has no stages configured');
  }

  // Return the first stage ID
  return stages[0].id;
}

async function addContactToPipeline(apiKey, contactId, pipelineId, locationId, configuredStageId = null) {
  // Use configured stageId or fall back to first stage
  const stageId = configuredStageId || await getFirstStageId(apiKey, pipelineId, locationId);

  // Create an opportunity in the pipeline for this contact
  const response = await fetch('https://services.leadconnectorhq.com/opportunities/', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28'
    },
    body: JSON.stringify({
      pipelineId: pipelineId,
      pipelineStageId: stageId,
      contactId: contactId,
      name: 'LeadRipper Lead',
      status: 'open',
      locationId: locationId
    })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to add to pipeline: ${error}`);
  }

  return await response.json();
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
    const { leadIds } = JSON.parse(event.body);

    // Get user's GHL settings
    const settingsResult = await pool.query(
      'SELECT ghl_api_key, ghl_location_id, ghl_pipeline_id, ghl_stage_id, ghl_industry_pipelines FROM lr_user_settings WHERE user_id = $1',
      [decoded.userId]
    );

    const settings = settingsResult.rows[0];

    if (!settings || !settings.ghl_api_key || !settings.ghl_location_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'GHL API not configured. Please add your API key and Location ID in settings.' })
      };
    }

    // Check if slow-drip is enabled - redirect to queue instead of bulk sync
    if (settings.ghl_drip_enabled) {
      // Queue leads for drip instead of instant sync
      let leadsQuery = `
        SELECT l.id
        FROM lr_leads l
        LEFT JOIN lr_ghl_queue q ON l.id = q.lead_id
        WHERE l.user_id = $1
          AND l.ghl_synced = false
          AND l.email IS NOT NULL
          AND l.email != ''
          AND (l.email_verified = true OR l.email_score >= 60)
          AND (l.is_disposable = false OR l.is_disposable IS NULL)
          AND q.id IS NULL
      `;
      const queueValues = [decoded.userId];

      if (leadIds && leadIds.length > 0) {
        leadsQuery += ` AND l.id = ANY($2)`;
        queueValues.push(leadIds);
      }

      const leadsResult = await pool.query(leadsQuery, queueValues);
      const leads = leadsResult.rows;

      if (leads.length === 0) {
        return {
          statusCode: 200,
          headers,
          body: JSON.stringify({
            success: true,
            message: 'No new leads to queue',
            queuedCount: 0,
            mode: 'drip'
          })
        };
      }

      // Calculate scheduled times based on drip interval
      const intervalMinutes = settings.ghl_drip_interval || 15;
      const now = new Date();
      let queuedCount = 0;

      // Get current queue position for this user
      const queueCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM lr_ghl_queue WHERE user_id = $1 AND status = 'pending'`,
        [decoded.userId]
      );
      let queuePosition = parseInt(queueCountResult.rows[0]?.count || 0);

      for (const lead of leads) {
        const scheduledFor = new Date(now.getTime() + (queuePosition * intervalMinutes * 60 * 1000));

        await pool.query(
          `INSERT INTO lr_ghl_queue (user_id, lead_id, status, scheduled_for)
           VALUES ($1, $2, 'pending', $3)
           ON CONFLICT (lead_id) DO NOTHING`,
          [decoded.userId, lead.id, scheduledFor]
        );

        queuePosition++;
        queuedCount++;
      }

      const totalMinutes = queuePosition * intervalMinutes;
      const estimatedCompletion = new Date(now.getTime() + (totalMinutes * 60 * 1000));

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: `Added ${queuedCount} leads to the slow-drip queue. They will sync automatically every ${intervalMinutes} minutes.`,
          queuedCount,
          totalInQueue: queuePosition,
          intervalMinutes,
          estimatedCompletion: estimatedCompletion.toISOString(),
          mode: 'drip'
        })
      };
    }

    // Parse industry pipelines
    let industryPipelines = {};
    try {
      if (settings.ghl_industry_pipelines) {
        let parsed = settings.ghl_industry_pipelines;
        // Handle double-stringified data (legacy fix)
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        if (typeof parsed === 'string') {
          parsed = JSON.parse(parsed);
        }
        industryPipelines = parsed;
        console.log('Parsed industry pipelines:', JSON.stringify(industryPipelines));
      }
    } catch (e) {
      console.error('Failed to parse industry pipelines:', e, 'Raw value:', settings.ghl_industry_pipelines);
    }

    // Get leads to sync - ONLY VALIDATED EMAILS (no bounces)
    let leadsQuery = `
      SELECT id, business_name, phone, email, address, city, state, industry, website,
             email_verified, email_score, is_disposable
      FROM lr_leads
      WHERE user_id = $1
        AND ghl_synced = false
        AND email IS NOT NULL
        AND email != ''
        AND (email_verified = true OR email_score >= 60)
        AND (is_disposable = false OR is_disposable IS NULL)
    `;
    const values = [decoded.userId];

    if (leadIds && leadIds.length > 0) {
      leadsQuery += ` AND id = ANY($2)`;
      values.push(leadIds);
    }

    leadsQuery += ' LIMIT 50';

    const leadsResult = await pool.query(leadsQuery, values);
    const leads = leadsResult.rows;

    // Count how many leads were filtered out due to validation issues
    let filteredCountQuery = `
      SELECT COUNT(*) as filtered_count
      FROM lr_leads
      WHERE user_id = $1
        AND ghl_synced = false
        AND (
          email IS NULL
          OR email = ''
          OR (email_verified = false AND email_score < 60)
          OR is_disposable = true
        )
    `;
    const filteredCountResult = await pool.query(filteredCountQuery, [decoded.userId]);
    const filteredCount = parseInt(filteredCountResult.rows[0]?.filtered_count || 0);

    if (leads.length === 0) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          message: 'No leads to sync',
          syncedCount: 0,
          filteredCount,
          filteredMessage: filteredCount > 0 ? `${filteredCount} leads have invalid/unverified emails and cannot be synced. Run email validation to fix.` : null
        })
      };
    }

    let syncedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const lead of leads) {
      try {
        // Determine the pipeline ID and stage ID: industry-specific or default
        let pipelineId = settings.ghl_pipeline_id || null;
        let stageId = settings.ghl_stage_id || null;

        // Check for industry-specific pipeline (case-insensitive matching)
        if (lead.industry && Object.keys(industryPipelines).length > 0) {
          const leadIndustry = lead.industry.toLowerCase().trim();
          console.log(`Matching lead industry "${leadIndustry}" against configured industries:`, Object.keys(industryPipelines));

          for (const [configuredIndustry, configuredValue] of Object.entries(industryPipelines)) {
            const configLower = configuredIndustry.toLowerCase().trim();
            const isMatch = configLower === leadIndustry ||
                leadIndustry.includes(configLower) ||
                configLower.includes(leadIndustry);

            if (isMatch) {
              console.log(`MATCH FOUND: "${leadIndustry}" matches "${configuredIndustry}"`);
              // Support both old format (string) and new format (object)
              if (typeof configuredValue === 'object' && configuredValue !== null) {
                pipelineId = configuredValue.pipelineId || pipelineId;
                stageId = configuredValue.stageId || stageId;
                console.log(`Using industry pipeline: ${pipelineId}, stage: ${stageId}`);
              } else if (typeof configuredValue === 'string') {
                pipelineId = configuredValue;
                stageId = null;
              }
              break;
            }
          }
        }

        console.log(`Final pipeline for lead ${lead.id} (${lead.industry}): pipeline=${pipelineId}, stage=${stageId}`);

        const ghlContact = await createGHLContact(
          settings.ghl_api_key,
          settings.ghl_location_id,
          lead,
          pipelineId,
          stageId
        );

        // Update lead as synced
        await pool.query(
          'UPDATE lr_leads SET ghl_synced = true, ghl_contact_id = $1 WHERE id = $2',
          [ghlContact.contact?.id || ghlContact.id, lead.id]
        );

        syncedCount++;
      } catch (error) {
        errorCount++;
        errors.push({ leadId: lead.id, error: error.message });
      }
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: `Synced ${syncedCount} leads to GoHighLevel`,
        syncedCount,
        errorCount,
        filteredCount,
        filteredMessage: filteredCount > 0 ? `${filteredCount} leads skipped due to invalid/unverified emails` : null,
        errors: errors.slice(0, 5) // Only return first 5 errors
      })
    };
  } catch (error) {
    console.error('GHL sync error:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to sync leads', message: error.message })
    };
  }
};
