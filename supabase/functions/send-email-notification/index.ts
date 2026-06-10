import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@2.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const supabaseUrl = Deno.env.get("SUPABASE_URL");
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const supabase = createClient(supabaseUrl, supabaseServiceKey);
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
const getEmailTemplate = (type, title, message, recipientName)=>{
  const typeIcons = {
    leave_request: '📅',
    leave_approved: '✅',
    leave_rejected: '❌',
    document_expiry: '📄',
    timesheet_reminder: '⏰',
    payslip_available: '💰',
    employee_update: '👥',
    system_alert: '🚨'
  };
  const icon = typeIcons[type] || '📢';
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 0; background-color: #f5f5f5; }
        .container { max-width: 600px; margin: 0 auto; background-color: white; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; }
        .content { padding: 30px; }
        .icon { font-size: 48px; margin-bottom: 20px; }
        .title { font-size: 24px; font-weight: bold; margin-bottom: 10px; color: #333; }
        .message { font-size: 16px; line-height: 1.6; color: #666; margin-bottom: 30px; }
        .footer { background-color: #f8f9fa; padding: 20px; text-align: center; font-size: 14px; color: #999; }
        .cta { background-color: #667eea; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 20px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="icon">${icon}</div>
          <h1 style="margin: 0; font-size: 28px;">HR Manager</h1>
          <p style="margin: 10px 0 0 0; opacity: 0.9;">Employee Management System</p>
        </div>
        <div class="content">
          <h2 class="title">${title}</h2>
          <div class="message">${message}</div>
          ${recipientName ? `<p><strong>Hello ${recipientName},</strong></p>` : ''}
          <a href="${supabaseUrl.replace('supabase.co', 'lovable.app')}" class="cta">View in HR Manager</a>
        </div>
        <div class="footer">
          <p>This is an automated notification from HR Manager.</p>
          <p>If you have questions, please contact your HR department.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};
const handler = async (req)=>{
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { type, title, message, recipient_email, recipient_name = 'Team Member', metadata = {} } = await req.json();
    console.log('Sending email notification:', {
      type,
      title,
      recipient_email
    });
    // Create email log entry
    const { data: emailLog, error: logError } = await supabase.from('email_logs').insert({
      recipient_email,
      subject: title,
      status: 'pending'
    }).select().single();
    if (logError) {
      console.error('Error creating email log:', logError);
    }
    // Send email
    const emailResponse = await resend.emails.send({
      from: "HR Manager <notifications@resend.dev>",
      to: [
        recipient_email
      ],
      subject: title,
      html: getEmailTemplate(type, title, message, recipient_name)
    });
    console.log('Email sent successfully:', emailResponse);
    // Update email log with success
    if (emailLog) {
      await supabase.from('email_logs').update({
        status: 'sent',
        sent_at: new Date().toISOString()
      }).eq('id', emailLog.id);
    }
    return new Response(JSON.stringify({
      success: true,
      emailId: emailResponse.data?.id,
      logId: emailLog?.id
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders
      }
    });
  } catch (error) {
    console.error("Error in send-email-notification function:", error);
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

