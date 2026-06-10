import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
    const supabase = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const { templateId } = await req.json();
    console.log('Template generator request:', {
      templateId
    });
    console.log('Starting template generation...');
    if (!templateId) {
      throw new Error('Template ID is required');
    }
    // Get template
    const { data: template, error: templateError } = await supabase.from('import_templates').select('*').eq('id', templateId).single();
    if (templateError || !template) {
      throw new Error('Template not found');
    }
    console.log('Template data:', JSON.stringify(template, null, 2));
    console.log('Field mappings:', JSON.stringify(template.field_mappings, null, 2));
    // Generate CSV content
    const csvContent = generateCSVTemplate(template);
    console.log('Generated CSV content:', csvContent);
    return new Response(csvContent, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${template.module_name}_template.csv"`
      }
    });
  } catch (error) {
    console.error('Template generation error:', error);
    return new Response(JSON.stringify({
      error: error.message
    }), {
      status: 400,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json'
      }
    });
  }
});
function generateCSVTemplate(template) {
  console.log('Generating CSV for template:', template.module_name);
  console.log('Field mappings:', JSON.stringify(template.field_mappings, null, 2));
  console.log('Required fields:', template.required_fields);
  console.log('Optional fields:', template.optional_fields);
  // Get field mappings
  const fieldMappings = template.field_mappings || {};
  // sample_data is already a JSON object from the database, not a string
  const sampleData = Array.isArray(template.sample_data) ? template.sample_data : [];
  console.log('Sample data:', JSON.stringify(sampleData, null, 2));
  // Create header row with mapped field names
  const headers = [
    ...template.required_fields.map((field)=>fieldMappings[field] || field),
    ...template.optional_fields.map((field)=>fieldMappings[field] || field)
  ];
  console.log('Generated headers:', headers);
  // Create CSV content
  let csvContent = headers.join(',') + '\n';
  // Add sample data rows
  if (sampleData.length > 0) {
    for (const sample of sampleData){
      const row = headers.map((header)=>{
        // Find the original field name for this header
        const originalField = Object.keys(fieldMappings).find((key)=>fieldMappings[key] === header) || header;
        return `"${sample[originalField] || ''}"`;
      });
      csvContent += row.join(',') + '\n';
    }
  } else {
    // Add empty sample row
    const emptyRow = headers.map(()=>'""');
    csvContent += emptyRow.join(',') + '\n';
  }
  return csvContent;
}

