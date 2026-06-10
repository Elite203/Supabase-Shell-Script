import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const { messages, userId } = await req.json();
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '');
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }
    // Fetch user context if userId provided
    let userContext = '';
    if (userId) {
      const { data: employee } = await supabaseClient.from('employees').select('*, leave_balances(*)').eq('user_id', userId).single();
      if (employee) {
        userContext = `User context: Employee ${employee.first_name} ${employee.last_name}, Department: ${employee.department}, Job Title: ${employee.job_title}. `;
        if (employee.leave_balances && employee.leave_balances.length > 0) {
          const balance = employee.leave_balances[0];
          userContext += `Leave balance: ${balance.annual_leave_balance} days annual leave remaining. `;
        }
      }
    }
    const systemPrompt = `You are an intelligent HR assistant chatbot. You help employees with:
- HR policy questions and company guidelines
- Leave balance inquiries and leave request guidance
- Document status checks and requirements
- Timesheet and payroll questions
- Benefits and training information
- General workflow guidance

${userContext}

Provide helpful, accurate, and professional responses. If you need to access specific employee data or perform actions, guide users on how to do so through the HR system. Be concise but informative.`;
    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: systemPrompt
          },
          ...messages
        ],
        stream: true
      })
    });
    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({
          error: 'Rate limit exceeded. Please try again later.'
        }), {
          status: 429,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({
          error: 'AI credits depleted. Please contact administrator.'
        }), {
          status: 402,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json'
          }
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }
    // Stream the response
    return new Response(response.body, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/event-stream'
      }
    });
  } catch (error) {
    console.error('Error in hr-chatbot:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
