import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
const handler = async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', {
      global: {
        headers: {
          Authorization: req.headers.get('Authorization')
        }
      }
    });
    // Verify user authentication
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({
        error: 'Unauthorized'
      }), {
        status: 401,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const { action, category, data } = await req.json();
    if (action === 'get') {
      return await handleGetSettings(supabaseClient, category);
    } else if (action === 'update') {
      return await handleUpdateSettings(supabaseClient, category, data, user.id);
    }
    return new Response(JSON.stringify({
      error: 'Invalid action'
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  } catch (error) {
    console.error('Settings API error:', error);
    return new Response(JSON.stringify({
      error: 'Internal server error'
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
};
async function handleGetSettings(supabaseClient, category) {
  let tableName;
  switch(category){
    case 'notification':
      tableName = 'notification_settings';
      break;
    case 'security':
      tableName = 'security_settings';
      break;
    case 'branding':
      tableName = 'branding_settings';
      break;
    case 'system':
      tableName = 'system_settings';
      break;
    default:
      return new Response(JSON.stringify({
        error: 'Invalid category'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
  }
  const { data, error } = await supabaseClient.from(tableName).select('*').limit(1).single();
  if (error && error.code !== 'PGRST116') {
    console.error(`Error fetching ${category} settings:`, error);
    return new Response(JSON.stringify({
      error: `Failed to fetch ${category} settings`
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  return new Response(JSON.stringify({
    data
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
async function handleUpdateSettings(supabaseClient, category, data, userId) {
  let tableName;
  // Validate user permissions based on category
  const { data: userProfile } = await supabaseClient.from('profiles').select('role').eq('id', userId).single();
  if (!userProfile) {
    return new Response(JSON.stringify({
      error: 'User profile not found'
    }), {
      status: 403,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  // Check permissions based on category
  const userRole = userProfile.role;
  switch(category){
    case 'notification':
      if (![
        'admin',
        'hr'
      ].includes(userRole)) {
        return new Response(JSON.stringify({
          error: 'Insufficient permissions for notification settings'
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      tableName = 'notification_settings';
      break;
    case 'security':
      if (userRole !== 'admin') {
        return new Response(JSON.stringify({
          error: 'Admin access required for security settings'
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      tableName = 'security_settings';
      break;
    case 'branding':
      if (![
        'admin',
        'hr'
      ].includes(userRole)) {
        return new Response(JSON.stringify({
          error: 'Insufficient permissions for branding settings'
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      tableName = 'branding_settings';
      break;
    case 'system':
      if (![
        'admin',
        'hr'
      ].includes(userRole)) {
        return new Response(JSON.stringify({
          error: 'Insufficient permissions for system settings'
        }), {
          status: 403,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      tableName = 'system_settings';
      break;
    default:
      return new Response(JSON.stringify({
        error: 'Invalid category'
      }), {
        status: 400,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
  }
  // Validate and sanitize input data
  if (!data || typeof data !== 'object') {
    return new Response(JSON.stringify({
      error: 'Invalid data format'
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  // Check if settings exist, if not create them
  const { data: existing } = await supabaseClient.from(tableName).select('id').limit(1).single();
  let result;
  if (existing) {
    // Update existing settings
    result = await supabaseClient.from(tableName).update(data).eq('id', existing.id).select().single();
  } else {
    // Create new settings
    result = await supabaseClient.from(tableName).insert(data).select().single();
  }
  if (result.error) {
    console.error(`Error updating ${category} settings:`, result.error);
    return new Response(JSON.stringify({
      error: `Failed to update ${category} settings`
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
  return new Response(JSON.stringify({
    data: result.data
  }), {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json'
    }
  });
}
serve(handler);

