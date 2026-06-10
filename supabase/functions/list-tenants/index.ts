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
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    // Get all tenants
    const { data: tenants, error } = await supabase.from('tenants').select('*').order('created_at', {
      ascending: false
    });
    if (error) {
      console.error('Failed to fetch tenants:', error);
      throw new Error('Failed to fetch tenants');
    }
    // Mask service role keys before returning
    const sanitizedTenants = tenants.map((tenant)=>({
        ...tenant,
        service_role_key: tenant.service_role_key ? '••••••••••••••••' + tenant.service_role_key.slice(-8) : null
      }));
    // Calculate stats
    const stats = {
      total: tenants.length,
      active: tenants.filter((t)=>t.status === 'active').length,
      pending: tenants.filter((t)=>t.status === 'pending').length,
      paused: tenants.filter((t)=>t.status === 'paused').length,
      deleted: tenants.filter((t)=>t.status === 'deleted').length
    };
    return new Response(JSON.stringify({
      success: true,
      tenants: sanitizedTenants,
      stats
    }), {
      status: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Error fetching tenants:', error);
    return new Response(JSON.stringify({
      error: error.message || 'Failed to fetch tenants',
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

