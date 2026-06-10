import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
};
Deno.serve(async (req)=>{
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: corsHeaders
    });
  }
  try {
    const supabaseClient = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0].substring(0, 5);
    console.log(`Starting ROTA status update at ${now.toISOString()}`);
    console.log(`Current date: ${currentDate}, Current time: ${currentTime}`);
    // Get all shifts that need status updates
    const { data: shifts, error: fetchError } = await supabaseClient.from('rota_shifts').select('id, status, date, start_time, end_time, employee_id').in('status', [
      'scheduled',
      'confirmed',
      'in_progress'
    ]).lte('date', currentDate);
    if (fetchError) {
      console.error('Error fetching shifts:', fetchError);
      throw fetchError;
    }
    console.log(`Found ${shifts?.length || 0} shifts to potentially update`);
    let updatedCount = 0;
    const updates = [];
    for (const shift of shifts || []){
      const shiftDate = shift.date;
      const shiftStartTime = shift.start_time;
      const shiftEndTime = shift.end_time;
      // Create datetime objects for comparison
      const shiftStart = new Date(`${shiftDate}T${shiftStartTime}`);
      const shiftEnd = new Date(`${shiftDate}T${shiftEndTime}`);
      let newStatus = shift.status;
      // Determine new status based on current time
      if (now >= shiftEnd) {
        // Shift has ended
        if (shift.status === 'in_progress') {
          newStatus = 'completed';
        } else if (shift.status === 'confirmed') {
          // Employee didn't show up for their shift
          newStatus = 'no_show';
        }
      } else if (now >= shiftStart && shift.status === 'confirmed') {
        // Shift has started and was confirmed
        newStatus = 'in_progress';
      }
      // Only update if status changed
      if (newStatus !== shift.status) {
        updates.push({
          id: shift.id,
          oldStatus: shift.status,
          newStatus: newStatus,
          shiftDate: shiftDate,
          startTime: shiftStartTime,
          endTime: shiftEndTime
        });
        const { error: updateError } = await supabaseClient.from('rota_shifts').update({
          status: newStatus,
          updated_at: now.toISOString()
        }).eq('id', shift.id);
        if (updateError) {
          console.error(`Error updating shift ${shift.id}:`, updateError);
        } else {
          updatedCount++;
          console.log(`Updated shift ${shift.id}: ${shift.status} → ${newStatus}`);
        }
      }
    }
    // Create notifications for significant status changes
    for (const update of updates){
      if (update.newStatus === 'no_show' || update.newStatus === 'completed') {
        try {
          const { error: notificationError } = await supabaseClient.rpc('create_notification', {
            target_user_id: update.id,
            notification_type: 'shift_update',
            notification_title: `Shift Status Updated`,
            notification_message: `Your shift on ${update.shiftDate} has been marked as ${update.newStatus.replace('_', ' ')}`,
            notification_metadata: {
              shift_id: update.id,
              old_status: update.oldStatus,
              new_status: update.newStatus,
              shift_date: update.shiftDate
            }
          });
          if (notificationError) {
            console.error('Error creating notification:', notificationError);
          }
        } catch (err) {
          console.error('Error creating notification:', err);
        }
      }
    }
    const result = {
      success: true,
      timestamp: now.toISOString(),
      totalShiftsChecked: shifts?.length || 0,
      shiftsUpdated: updatedCount,
      updates: updates
    };
    console.log('ROTA status update completed:', result);
    return new Response(JSON.stringify(result), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 200
    });
  } catch (error) {
    console.error('Error in update-rota-statuses function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    }), {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      status: 500
    });
  }
});
