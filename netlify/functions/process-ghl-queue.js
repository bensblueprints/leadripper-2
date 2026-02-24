const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_sK7M4EbyDBiz@ep-aged-river-ah63sktg-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require",
  ssl: { rejectUnauthorized: false }
});

// GHL API Functions (shared with ghl-sync.js)
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
    }
  }

  return contactResult;
}

async function getFirstStageId(apiKey, pipelineId, locationId) {
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

  return stages[0].id;
}

async function addContactToPipeline(apiKey, contactId, pipelineId, locationId, configuredStageId = null) {
  const stageId = configuredStageId || await getFirstStageId(apiKey, pipelineId, locationId);

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

// Scheduled function - runs every 5 minutes
exports.handler = async (event, context) => {
  console.log('GHL Drip Queue Processor started at:', new Date().toISOString());

  try {
    // Get all users with drip enabled and pending queue items that are due
    const usersResult = await pool.query(`
      SELECT DISTINCT s.user_id, s.ghl_api_key, s.ghl_location_id, s.ghl_pipeline_id,
             s.ghl_stage_id, s.ghl_drip_interval, s.ghl_industry_pipelines, s.ghl_last_drip_at
      FROM lr_user_settings s
      INNER JOIN lr_ghl_queue q ON s.user_id = q.user_id
      WHERE s.ghl_drip_enabled = true
        AND s.ghl_api_key IS NOT NULL
        AND s.ghl_location_id IS NOT NULL
        AND q.status = 'pending'
        AND q.scheduled_for <= NOW()
    `);

    console.log(`Found ${usersResult.rows.length} users with pending drip items`);

    let totalProcessed = 0;
    let totalErrors = 0;

    for (const user of usersResult.rows) {
      const intervalMinutes = user.ghl_drip_interval || 15;

      // Check if enough time has passed since last drip
      if (user.ghl_last_drip_at) {
        const lastDrip = new Date(user.ghl_last_drip_at);
        const minutesSinceLastDrip = (Date.now() - lastDrip.getTime()) / (1000 * 60);

        if (minutesSinceLastDrip < intervalMinutes) {
          console.log(`User ${user.user_id}: Skipping - only ${minutesSinceLastDrip.toFixed(1)} min since last drip (interval: ${intervalMinutes})`);
          continue;
        }
      }

      // Get ONE pending item for this user (oldest first)
      const queueItemResult = await pool.query(`
        SELECT q.id, q.lead_id, l.business_name, l.phone, l.email, l.address,
               l.city, l.state, l.industry, l.website
        FROM lr_ghl_queue q
        JOIN lr_leads l ON q.lead_id = l.id
        WHERE q.user_id = $1 AND q.status = 'pending' AND q.scheduled_for <= NOW()
        ORDER BY q.scheduled_for ASC
        LIMIT 1
      `, [user.user_id]);

      if (queueItemResult.rows.length === 0) {
        continue;
      }

      const queueItem = queueItemResult.rows[0];
      const lead = {
        id: queueItem.lead_id,
        business_name: queueItem.business_name,
        phone: queueItem.phone,
        email: queueItem.email,
        address: queueItem.address,
        city: queueItem.city,
        state: queueItem.state,
        industry: queueItem.industry,
        website: queueItem.website
      };

      // Mark as processing
      await pool.query(
        `UPDATE lr_ghl_queue SET status = 'processing', attempts = attempts + 1 WHERE id = $1`,
        [queueItem.id]
      );

      try {
        // Parse industry pipelines
        let industryPipelines = {};
        try {
          if (user.ghl_industry_pipelines) {
            let parsed = user.ghl_industry_pipelines;
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            if (typeof parsed === 'string') parsed = JSON.parse(parsed);
            industryPipelines = parsed;
          }
        } catch (e) {
          console.error('Failed to parse industry pipelines:', e);
        }

        // Determine pipeline and stage
        let pipelineId = user.ghl_pipeline_id || null;
        let stageId = user.ghl_stage_id || null;

        // Check for industry-specific pipeline
        if (lead.industry && Object.keys(industryPipelines).length > 0) {
          const leadIndustry = lead.industry.toLowerCase().trim();
          for (const [configuredIndustry, configuredValue] of Object.entries(industryPipelines)) {
            const configLower = configuredIndustry.toLowerCase().trim();
            const isMatch = configLower === leadIndustry ||
              leadIndustry.includes(configLower) ||
              configLower.includes(leadIndustry);

            if (isMatch) {
              if (typeof configuredValue === 'object' && configuredValue !== null) {
                pipelineId = configuredValue.pipelineId || pipelineId;
                stageId = configuredValue.stageId || stageId;
              } else if (typeof configuredValue === 'string') {
                pipelineId = configuredValue;
                stageId = null;
              }
              break;
            }
          }
        }

        // Create GHL contact
        const ghlContact = await createGHLContact(
          user.ghl_api_key,
          user.ghl_location_id,
          lead,
          pipelineId,
          stageId
        );

        const contactId = ghlContact.contact?.id || ghlContact.id;

        // Mark queue item as completed
        await pool.query(
          `UPDATE lr_ghl_queue SET status = 'completed', processed_at = NOW() WHERE id = $1`,
          [queueItem.id]
        );

        // Mark lead as synced
        await pool.query(
          `UPDATE lr_leads SET ghl_synced = true, ghl_contact_id = $1 WHERE id = $2`,
          [contactId, lead.id]
        );

        // Update user's last drip time
        await pool.query(
          `UPDATE lr_user_settings SET ghl_last_drip_at = NOW() WHERE user_id = $1`,
          [user.user_id]
        );

        console.log(`User ${user.user_id}: Synced lead ${lead.id} (${lead.business_name}) to GHL`);
        totalProcessed++;

      } catch (error) {
        console.error(`User ${user.user_id}: Failed to sync lead ${lead.id}:`, error.message);

        // Mark as failed if too many attempts, otherwise back to pending for retry
        const maxAttempts = 3;
        const queueCheck = await pool.query(`SELECT attempts FROM lr_ghl_queue WHERE id = $1`, [queueItem.id]);
        const attempts = queueCheck.rows[0]?.attempts || 0;

        if (attempts >= maxAttempts) {
          await pool.query(
            `UPDATE lr_ghl_queue SET status = 'failed', last_error = $1 WHERE id = $2`,
            [error.message, queueItem.id]
          );
        } else {
          // Reschedule for later
          await pool.query(
            `UPDATE lr_ghl_queue SET status = 'pending', last_error = $1, scheduled_for = NOW() + INTERVAL '5 minutes' WHERE id = $2`,
            [error.message, queueItem.id]
          );
        }

        totalErrors++;
      }
    }

    console.log(`GHL Drip Queue Processor completed: ${totalProcessed} synced, ${totalErrors} errors`);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        processed: totalProcessed,
        errors: totalErrors,
        timestamp: new Date().toISOString()
      })
    };

  } catch (error) {
    console.error('GHL Drip Queue Processor error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: error.message
      })
    };
  }
};
