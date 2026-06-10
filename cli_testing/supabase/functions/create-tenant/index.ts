import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { name, subdomain } = await req.json();
    if (!name || !subdomain) {
      return new Response(JSON.stringify({
        error: 'Name and subdomain are required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Validate subdomain format
    const subdomainRegex = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
    if (!subdomainRegex.test(subdomain)) {
      return new Response(JSON.stringify({
        error: 'Invalid subdomain format'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client for master database
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Check if subdomain already exists
    const { data: existingTenant } = await supabase.from('tenants').select('id').eq('subdomain', subdomain).single();
    if (existingTenant) {
      return new Response(JSON.stringify({
        error: 'Subdomain already exists'
      }), {
        status: 409,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Creating tenant: ${name} with subdomain: ${subdomain}`);
    // Create new Supabase project using Management API
    const managementApiToken = Deno.env.get('SUPABASE_MANAGEMENT_API_TOKEN');
    if (!managementApiToken) {
      throw new Error('Supabase Management API token not configured');
    }
    // Create project via Supabase Management API
    const createProjectResponse = await fetch('https://api.supabase.com/v1/projects', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${managementApiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `${name} (${subdomain})`,
        organization_id: Deno.env.get('SUPABASE_ORG_ID'),
        plan: 'free',
        region: 'us-east-1'
      })
    });
    if (!createProjectResponse.ok) {
      const errorData = await createProjectResponse.text();
      console.error('Failed to create Supabase project:', errorData);
      throw new Error(`Failed to create Supabase project: ${createProjectResponse.status}`);
    }
    const newProject = await createProjectResponse.json();
    console.log('Created Supabase project:', newProject.id);
    // Wait for project to be ready (this might take a few minutes)
    let projectReady = false;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes timeout
    while(!projectReady && attempts < maxAttempts){
      await new Promise((resolve)=>setTimeout(resolve, 5000)); // Wait 5 seconds
      const statusResponse = await fetch(`https://api.supabase.com/v1/projects/${newProject.id}`, {
        headers: {
          'Authorization': `Bearer ${managementApiToken}`
        }
      });
      if (statusResponse.ok) {
        const projectStatus = await statusResponse.json();
        if (projectStatus.status === 'ACTIVE_HEALTHY') {
          projectReady = true;
        }
      }
      attempts++;
    }
    if (!projectReady) {
      throw new Error('Project creation timed out');
    }
    // Get project API keys
    const keysResponse = await fetch(`https://api.supabase.com/v1/projects/${newProject.id}/api-keys`, {
      headers: {
        'Authorization': `Bearer ${managementApiToken}`
      }
    });
    if (!keysResponse.ok) {
      throw new Error('Failed to fetch project API keys');
    }
    const keys = await keysResponse.json();
    const anonKey = keys.find((key)=>key.name === 'anon')?.api_key;
    const serviceRoleKey = keys.find((key)=>key.name === 'service_role')?.api_key;
    // Initialize the new project's schema by copying from master
    // This is a simplified version - you might want to export/import specific tables
    const newProjectUrl = `https://${newProject.id}.supabase.co`;
    const newProjectClient = createClient(newProjectUrl, serviceRoleKey);
    // Here you would run your schema migrations on the new project
    // For now, we'll just store the tenant info
    // Store tenant information in master database
    const { data: tenant, error: insertError } = await supabase.from('tenants').insert({
      name,
      subdomain,
      supabase_project_id: newProject.id,
      supabase_url: newProjectUrl,
      anon_key: anonKey,
      service_role_key: serviceRoleKey,
      status: 'active'
    }).select().single();
    if (insertError) {
      console.error('Failed to store tenant:', insertError);
      throw new Error('Failed to store tenant information');
    }
    console.log(`Successfully created tenant: ${tenant.id}`);
    return new Response(JSON.stringify({
      success: true,
      tenant: {
        ...tenant,
        service_role_key: '••••••••••••••••' + serviceRoleKey.slice(-8)
      }
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error creating tenant:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Failed to create tenant',
      details: error.toString()
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});

