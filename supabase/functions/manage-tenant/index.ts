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
    const url = new URL(req.url);
    const tenantId = url.pathname.split('/').pop();
    const { action, ...updateData } = await req.json();
    if (!tenantId) {
      return new Response(JSON.stringify({
        error: 'Tenant ID is required'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Get tenant information
    const { data: tenant, error: fetchError } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
    if (fetchError || !tenant) {
      return new Response(JSON.stringify({
        error: 'Tenant not found'
      }), {
        status: 404,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    console.log(`Managing tenant ${tenantId} with action: ${action}`);
    let updatePayload = {};
    switch(action){
      case 'pause':
        updatePayload = {
          status: 'paused'
        };
        break;
      case 'activate':
        updatePayload = {
          status: 'active'
        };
        break;
      case 'delete':
        updatePayload = {
          status: 'deleted'
        };
        break;
      case 'update':
        // Allow updating specific fields
        if (updateData.name) updatePayload.name = updateData.name;
        if (updateData.subdomain) updatePayload.subdomain = updateData.subdomain;
        break;
      case 'sync':
        // Trigger schema sync for this tenant
        updatePayload = {
          last_sync: new Date().toISOString()
        };
        // Here you would implement the actual schema sync logic
        console.log(`Syncing schema for tenant ${tenantId}`);
        break;
      default:
        return new Response(JSON.stringify({
          error: 'Invalid action'
        }), {
          status: 400,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
    }
    // Update tenant in database
    const { data: updatedTenant, error: updateError } = await supabase.from('tenants').update(updatePayload).eq('id', tenantId).select().single();
    if (updateError) {
      console.error('Failed to update tenant:', updateError);
      throw new Error('Failed to update tenant');
    }
    // Mask service role key before returning
    const responseData = {
      ...updatedTenant,
      service_role_key: updatedTenant.service_role_key ? '••••••••••••••••' + updatedTenant.service_role_key.slice(-8) : null
    };
    return new Response(JSON.stringify({
      success: true,
      tenant: responseData,
      message: `Tenant ${action} successful`
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error managing tenant:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Failed to manage tenant',
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

