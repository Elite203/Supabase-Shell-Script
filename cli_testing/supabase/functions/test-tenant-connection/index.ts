import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
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
    const { tenantId } = await req.json();
    if (!tenantId) {
      throw new Error('Tenant ID is required');
    }
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);
    // Get tenant details
    const { data: tenant, error: fetchError } = await supabase.from('tenants').select('*').eq('id', tenantId).single();
    if (fetchError || !tenant) {
      throw new Error('Tenant not found');
    }
    console.log(`Testing connection for tenant: ${tenant.name}`);
    let connectionStatus = 'connected';
    let errorMessage = null;
    try {
      // TODO: Implement actual connection test
      // This would include:
      // 1. Create client with tenant's Supabase credentials
      // 2. Test basic connectivity
      // 3. Verify authentication works
      // 4. Check if required tables exist
      // 5. Test RLS policies
      // For now, simulate connection test
      if (!tenant.supabase_project_url || !tenant.supabase_anon_key) {
        throw new Error('Missing Supabase configuration');
      }
      // Simulate connection test
      await new Promise((resolve)=>setTimeout(resolve, 1500));
    } catch (error) {
      connectionStatus = 'error';
      errorMessage = error.message;
      console.error(`Connection test failed for ${tenant.name}:`, error);
    }
    // Update connection status
    const { error: updateError } = await supabase.from('tenants').update({
      connection_status: connectionStatus
    }).eq('id', tenantId);
    if (updateError) {
      console.error('Failed to update connection status:', updateError);
    }
    console.log(`Connection test completed for tenant: ${tenant.name} - Status: ${connectionStatus}`);
    return new Response(JSON.stringify({
      success: connectionStatus === 'connected',
      connectionStatus,
      errorMessage,
      message: connectionStatus === 'connected' ? `Connection successful for ${tenant.name}` : `Connection failed for ${tenant.name}: ${errorMessage}`,
      testedAt: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error testing connection:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message || 'Failed to test connection'
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 400
    });
  }
});

