import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const handler = async (req)=>{
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { user_id, type, title, message, metadata = {}, priority = 'medium', related_entity_type, related_entity_id, send_email = true } = await req.json();
    console.log('Creating notification:', {
      user_id,
      type,
      title
    });
    // Create notification using the database function
    const { data: notificationId, error: notificationError } = await supabase.rpc('create_notification', {
      target_user_id: user_id,
      notification_type: type,
      notification_title: title,
      notification_message: message,
      notification_metadata: metadata,
      notification_priority: priority,
      entity_type: related_entity_type,
      entity_id: related_entity_id
    });
    if (notificationError) {
      throw notificationError;
    }
    console.log('Notification created with ID:', notificationId);
    // Check if email should be sent
    if (send_email) {
      // Get user's email and notification settings
      const { data: profile, error: profileError } = await supabase.from('profiles').select('email, first_name, last_name').eq('id', user_id).single();
      if (profileError) {
        console.error('Error fetching user profile:', profileError);
      } else if (profile?.email) {
        // Get notification settings
        const { data: settings, error: settingsError } = await supabase.from('notification_settings').select('email_enabled, email_types').eq('user_id', user_id).single();
        const shouldSendEmail = !settingsError && settings?.email_enabled && settings?.email_types?.[type] !== false;
        if (shouldSendEmail) {
          // Send email notification
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-email-notification`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseServiceKey}`
            },
            body: JSON.stringify({
              type,
              title,
              message,
              recipient_email: profile.email,
              recipient_name: `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
              metadata
            })
          });
          if (!emailResponse.ok) {
            console.error('Failed to send email notification');
          } else {
            console.log('Email notification sent successfully');
          }
        } else {
          console.log('Email notifications disabled for user or type');
        }
      }
    }
    return new Response(JSON.stringify({
      success: true,
      notificationId,
      message: 'Notification created successfully'
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error("Error in create-notification function:", error);
    return new Response(JSON.stringify({
      error: error.message,
      success: false
    }), {
      status: 500,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  }
};
serve(handler);

//hello testting123