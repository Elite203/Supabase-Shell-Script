//import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }
    // Get user from auth header
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      throw new Error('Invalid authentication');
    }
    // Check if user is admin or HR
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
    if (!profile || ![
      'admin',
      'hr'
    ].includes(profile.role)) {
      return new Response(JSON.stringify({
        error: 'Access denied. Admin privileges required.'
      }), {
        status: 403,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    const formData = await req.formData();
    const file = formData.get('file');
    const templateId = formData.get('templateId');
    const action = formData.get('action');
    console.log('Data import request:', {
      filename: file?.name,
      templateId,
      action,
      fileSize: file?.size
    });
    if (!file || !templateId) {
      throw new Error('File and template ID are required');
    }
    // Validate file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('File size exceeds 10MB limit');
    }
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.csv')) {
      throw new Error('Only CSV files are allowed');
    }
    // Get template
    const { data: template, error: templateError } = await supabase.from('import_templates').select('*').eq('id', templateId).single();
    if (templateError || !template) {
      throw new Error('Invalid template');
    }
    // Parse CSV
    const csvText = await file.text();
    const rows = parseCSV(csvText);
    if (rows.length === 0) {
      throw new Error('CSV file is empty or invalid');
    }
    // Create import job
    const { data: job, error: jobError } = await supabase.from('import_jobs').insert({
      user_id: user.id,
      template_id: templateId,
      filename: file.name,
      file_size: file.size,
      total_rows: rows.length - 1,
      status: 'validating'
    }).select().single();
    if (jobError || !job) {
      throw new Error('Failed to create import job');
    }
    // Validate data
    const validation = validateData(rows, template);
    if (action === 'validate') {
      // Store preview data
      await supabase.from('import_previews').insert({
        job_id: job.id,
        preview_data: {
          rows: rows.slice(0, 100)
        },
        validation_results: validation
      });
      // Update job with validation results
      await supabase.from('import_jobs').update({
        status: validation.valid ? 'validated' : 'validation_failed',
        error_rows: validation.errors.length,
        warning_rows: validation.warnings.length,
        progress: 100
      }).eq('id', job.id);
      return new Response(JSON.stringify({
        success: true,
        jobId: job.id,
        validation,
        totalRows: rows.length - 1,
        validRows: rows.length - 1 - validation.errors.length
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    if (action === 'import' && validation.valid) {
      // Perform actual import
      await performImport(supabase, job.id, rows, template);
      // Get final job status
      const { data: finalJob } = await supabase.from('import_jobs').select('status, success_rows, error_rows, warning_rows, total_rows').eq('id', job.id).single();
      const success = finalJob && finalJob.status === 'completed' && finalJob.error_rows === 0;
      const hasErrors = finalJob && finalJob.error_rows > 0;
      return new Response(JSON.stringify({
        success: success,
        jobId: job.id,
        message: success ? 'Import completed successfully' : hasErrors ? `Import completed with ${finalJob.error_rows} errors` : 'Import failed',
        totalRows: finalJob?.total_rows || rows.length - 1,
        successRows: finalJob?.success_rows || 0,
        errorRows: finalJob?.error_rows || 0,
        warningRows: finalJob?.warning_rows || 0,
        status: success ? 'success' : hasErrors ? 'partial' : 'failed'
      }), {
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json'
        }
      });
    }
    throw new Error('Invalid action or validation failed');
  } catch (error) {
    console.error('Import error:', error);
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
function parseCSV(csvText) {
  const lines = csvText.split('\n').filter((line)=>line.trim());
  if (lines.length === 0) return [];
  const headers = lines[0].split(',').map((h)=>h.trim().replace(/"/g, ''));
  const rows = [];
  for(let i = 1; i < lines.length; i++){
    const values = lines[i].split(',').map((v)=>v.trim().replace(/"/g, ''));
    const row = {};
    headers.forEach((header, index)=>{
      row[header] = values[index] || '';
    });
    rows.push(row);
  }
  return [
    {
      ...Object.fromEntries(headers.map((h)=>[
          h,
          h
        ]))
    },
    ...rows
  ];
}
function validateData(rows, template) {
  const errors = [];
  const warnings = [];
  const headers = Object.keys(rows[0]);
  // Check required fields exist
  for (const required of template.required_fields){
    const mappedField = template.field_mappings[required];
    if (!headers.includes(mappedField)) {
      errors.push({
        row: 0,
        field: required,
        error: `Required field '${mappedField}' is missing`,
        value: null
      });
    }
  }
  // Validate data rows
  for(let i = 1; i < rows.length; i++){
    const row = rows[i];
    // Check required fields have values
    for (const required of template.required_fields){
      const mappedField = template.field_mappings[required];
      const value = row[mappedField];
      if (!value || value.trim() === '') {
        errors.push({
          row: i,
          field: required,
          error: `Required field '${mappedField}' is empty`,
          value: value
        });
      }
    }
    // Validate field formats
    const validationRules = template.validation_rules || {};
    for (const [field, rules] of Object.entries(validationRules)){
      const mappedField = template.field_mappings[field];
      const value = row[mappedField];
      if (value && value.trim()) {
        if (rules.type === 'email' && !isValidEmail(value)) {
          errors.push({
            row: i,
            field: field,
            error: `Invalid email format`,
            value: value
          });
        }
        if (rules.type === 'date' && !isValidDate(value)) {
          errors.push({
            row: i,
            field: field,
            error: `Invalid date format. Supported formats: YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, Jan 15 2024`,
            value: value
          });
        }
        if (rules.type === 'number' && isNaN(Number(value))) {
          errors.push({
            row: i,
            field: field,
            error: `Invalid number format`,
            value: value
          });
        }
        if (rules.type === 'enum') {
          const caseInsensitive = rules.case_insensitive === true;
          const normalizedValue = caseInsensitive ? value.toLowerCase() : value;
          const allowedValues = caseInsensitive ? rules.values.map((v)=>v.toLowerCase()) : rules.values;
          if (!allowedValues.includes(normalizedValue)) {
            errors.push({
              row: i,
              field: field,
              error: `Invalid value "${value}". Allowed values: ${rules.values.join(', ')}${caseInsensitive ? ' (case insensitive)' : ''}`,
              value: value
            });
          }
        }
      }
    }
  }
  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
function isValidDate(date) {
  return convertDateToISO(date) !== null;
}
function convertDateToISO(date) {
  if (!date || !date.trim()) return null;
  const dateValue = date.trim();
  // Common date format patterns
  const patterns = [
    // ISO format (YYYY-MM-DD) - already correct
    {
      regex: /^\d{4}-\d{2}-\d{2}$/,
      format: 'iso'
    },
    // US format (MM/DD/YYYY)
    {
      regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      format: 'us'
    },
    // UK format (DD/MM/YYYY)
    {
      regex: /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
      format: 'uk'
    },
    // Dash formats (MM-DD-YYYY, DD-MM-YYYY)
    {
      regex: /^(\d{1,2})-(\d{1,2})-(\d{4})$/,
      format: 'dash'
    },
    // Dot formats (DD.MM.YYYY)
    {
      regex: /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
      format: 'dot'
    },
    // Text month formats (Jan 15, 2024 or 15 Jan 2024)
    {
      regex: /^([A-Za-z]{3})\s+(\d{1,2}),?\s+(\d{4})$/,
      format: 'monthFirst'
    },
    {
      regex: /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/,
      format: 'dayFirst'
    }
  ];
  // Try ISO format first
  const isoMatch = dateValue.match(/^\d{4}-\d{2}-\d{2}$/);
  if (isoMatch) {
    const testDate = new Date(dateValue);
    return !isNaN(testDate.getTime()) ? dateValue : null;
  }
  // Try other formats
  for (const pattern of patterns){
    const match = dateValue.match(pattern.regex);
    if (match) {
      let year, month, day;
      switch(pattern.format){
        case 'us':
          month = parseInt(match[1]);
          day = parseInt(match[2]);
          year = parseInt(match[3]);
          break;
        case 'uk':
        case 'dot':
          day = parseInt(match[1]);
          month = parseInt(match[2]);
          year = parseInt(match[3]);
          break;
        case 'dash':
          // If first number > 12, assume DD-MM-YYYY
          if (parseInt(match[1]) > 12) {
            day = parseInt(match[1]);
            month = parseInt(match[2]);
          } else if (parseInt(match[2]) > 12) {
            // If second number > 12, assume MM-DD-YYYY
            month = parseInt(match[1]);
            day = parseInt(match[2]);
          } else {
            // Default to DD-MM-YYYY for ambiguous cases
            day = parseInt(match[1]);
            month = parseInt(match[2]);
          }
          year = parseInt(match[3]);
          break;
        case 'monthFirst':
          month = getMonthNumber(match[1]);
          day = parseInt(match[2]);
          year = parseInt(match[3]);
          break;
        case 'dayFirst':
          day = parseInt(match[1]);
          month = getMonthNumber(match[2]);
          year = parseInt(match[3]);
          break;
      }
      // Validate ranges
      if (year < 1900 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
        continue;
      }
      // Create date and validate it's real
      const testDate = new Date(year, month - 1, day);
      if (testDate.getFullYear() === year && testDate.getMonth() === month - 1 && testDate.getDate() === day) {
        // Format as ISO string
        const isoString = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        return isoString;
      }
    }
  }
  return null;
}
function getMonthNumber(monthStr) {
  const months = {
    'jan': 1,
    'january': 1,
    'feb': 2,
    'february': 2,
    'mar': 3,
    'march': 3,
    'apr': 4,
    'april': 4,
    'may': 5,
    'jun': 6,
    'june': 6,
    'jul': 7,
    'july': 7,
    'aug': 8,
    'august': 8,
    'sep': 9,
    'september': 9,
    'oct': 10,
    'october': 10,
    'nov': 11,
    'november': 11,
    'dec': 12,
    'december': 12
  };
  return months[monthStr.toLowerCase()] || 0;
}
async function performImport(supabase, jobId, rows, template) {
  // Update job status
  await supabase.from('import_jobs').update({
    status: 'importing',
    started_at: new Date().toISOString()
  }).eq('id', jobId);
  let successCount = 0;
  let errorCount = 0;
  // For employee imports, use two-pass approach
  if (template.module_name === 'employees') {
    console.log('Starting two-pass employee import');
    // Store manager mappings for second pass
    const managerMappings = {};
    // PASS 1: Import all employees without manager relationships
    console.log('Pass 1: Importing employees without manager relationships');
    for(let i = 1; i < rows.length; i++){
      try {
        const row = rows[i];
        // Store manager name for second pass
        const managerFieldMapping = template.field_mappings['manager_name'];
        if (managerFieldMapping && row[managerFieldMapping]) {
          const employeeEmail = row[template.field_mappings['email']] || '';
          managerMappings[employeeEmail] = row[managerFieldMapping].trim();
        }
        console.log(`Pass 1 - Processing row ${i}`);
        await importEmployeeFirstPass(supabase, row, template);
        successCount++;
        console.log(`Pass 1 - Successfully imported row ${i}`);
      } catch (error) {
        errorCount++;
        console.error(`Pass 1 - Error importing row ${i}:`, error.message);
        // Log error
        await supabase.from('import_errors').insert({
          job_id: jobId,
          row_number: i,
          error_type: 'import_error_pass1',
          error_message: error.message,
          raw_value: JSON.stringify(rows[i])
        });
      }
      // Update progress (Pass 1: 0-80%)
      const progress = i / (rows.length - 1) * 80;
      await supabase.from('import_jobs').update({
        progress,
        processed_rows: i,
        success_rows: successCount,
        error_rows: errorCount
      }).eq('id', jobId);
    }
    // PASS 2: Update manager relationships
    console.log('Pass 2: Updating manager relationships');
    let managerUpdateCount = 0;
    let managerErrorCount = 0;
    for (const [employeeEmail, managerName] of Object.entries(managerMappings)){
      try {
        console.log(`Pass 2 - Updating manager for ${employeeEmail} -> ${managerName}`);
        await updateEmployeeManager(supabase, employeeEmail, managerName);
        managerUpdateCount++;
      } catch (error) {
        managerErrorCount++;
        console.error(`Pass 2 - Error updating manager for ${employeeEmail}:`, error.message);
        // Log manager update error
        await supabase.from('import_errors').insert({
          job_id: jobId,
          row_number: 0,
          error_type: 'manager_update_error',
          error_message: `Failed to update manager for ${employeeEmail}: ${error.message}`,
          raw_value: JSON.stringify({
            employeeEmail,
            managerName
          })
        });
      }
    }
    console.log(`Pass 2 completed: ${managerUpdateCount} manager relationships updated, ${managerErrorCount} errors`);
    // Update final progress to 100%
    await supabase.from('import_jobs').update({
      progress: 100,
      processed_rows: rows.length - 1,
      success_rows: successCount,
      error_rows: errorCount
    }).eq('id', jobId);
  } else {
    // For other modules, use single-pass approach
    for(let i = 1; i < rows.length; i++){
      try {
        const row = rows[i];
        console.log(`Processing row ${i} for module: ${template.module_name}`);
        if (template.module_name === 'companies') {
          await importCompany(supabase, row, template);
        } else if (template.module_name === 'leave_requests') {
          await importLeaveRequest(supabase, row, template);
        }
        successCount++;
        console.log(`Successfully imported row ${i}`);
      } catch (error) {
        errorCount++;
        console.error(`Error importing row ${i}:`, error.message);
        // Log error
        await supabase.from('import_errors').insert({
          job_id: jobId,
          row_number: i,
          error_type: 'import_error',
          error_message: error.message,
          raw_value: JSON.stringify(rows[i])
        });
      }
      // Update progress
      const progress = i / (rows.length - 1) * 100;
      await supabase.from('import_jobs').update({
        progress,
        processed_rows: i,
        success_rows: successCount,
        error_rows: errorCount
      }).eq('id', jobId);
    }
  }
  // Complete job
  await supabase.from('import_jobs').update({
    status: 'completed',
    completed_at: new Date().toISOString(),
    progress: 100
  }).eq('id', jobId);
}
async function importEmployeeFirstPass(supabase, row, template) {
  const mappedData = {};
  // Map CSV fields to database fields (excluding manager_name)
  for (const [dbField, csvField] of Object.entries(template.field_mappings)){
    const value = row[csvField];
    if (value && value.trim()) {
      if (dbField === 'manager_name') {
        continue;
      } else if (dbField === 'company_name') {
        // Handle company name lookup
        const companyName = value.trim();
        const { data: company } = await supabase.from('companies').select('id').eq('name', companyName).eq('is_active', true).maybeSingle();
        if (company) {
          mappedData['company_id'] = company.id;
        } else {
          console.warn(`Company "${companyName}" not found, using default`);
        }
      } else if (dbField === 'sponsored_by_company_name' && value.trim()) {
        // Handle sponsored company lookup
        const sponsorName = value.trim();
        const { data: sponsor } = await supabase.from('companies').select('id').eq('name', sponsorName).eq('is_active', true).maybeSingle();
        if (sponsor) {
          mappedData['sponsored_by_company_id'] = sponsor.id;
        } else {
          console.warn(`Sponsor company "${sponsorName}" not found`);
        }
      } else if (dbField === 'current_nationality') {
        // Handle nationality lookup
        const nationalityName = value.trim();
        const { data: nationality } = await supabase.from('countries').select('id').eq('name', nationalityName).eq('is_active', true).maybeSingle();
        if (nationality) {
          mappedData['current_nationality_id'] = nationality.id;
        } else {
          console.warn(`Nationality "${nationalityName}" not found`);
        }
      } else if (dbField === 'country_name') {
        // Handle country lookup for new address fields
        const countryName = value.trim();
        const { data: country } = await supabase.from('countries').select('id').eq('name', countryName).eq('is_active', true).maybeSingle();
        if (country) {
          mappedData['country_id'] = country.id;
        } else {
          console.warn(`Country "${countryName}" not found`);
        }
      } else if (dbField === 'job_title') {
        // Handle job title lookup (case-insensitive)
        const jobTitleName = value.trim();
        const { data: jobTitle } = await supabase.from('job_titles').select('id').ilike('title', jobTitleName).eq('is_active', true).maybeSingle();
        if (jobTitle) {
          mappedData['job_title'] = jobTitle.id;
        } else {
          console.warn(`Job title "${jobTitleName}" not found`);
        }
      } else if (dbField === 'department') {
        // Handle department lookup
        const deptName = value.trim();
        const { data: department } = await supabase.from('departments').select('id').eq('name', deptName).eq('is_active', true).maybeSingle();
        if (department) {
          mappedData['department'] = department.id;
        } else {
          console.warn(`Department "${deptName}" not found`);
        }
      } else if (dbField === 'salary' || dbField === 'leave_entitlement' || dbField === 'remaining_leaves') {
        // Handle numeric fields
        const numValue = parseFloat(value.trim());
        if (!isNaN(numValue)) {
          mappedData[dbField] = numValue;
        }
      } else if (dbField === 'hire_date' || dbField === 'start_date' || dbField === 'date_of_birth') {
        // Handle date fields with automatic conversion
        const convertedDate = convertDateToISO(value.trim());
        if (convertedDate) {
          mappedData[dbField] = convertedDate;
        } else {
          console.warn(`Invalid date format for ${dbField}: ${value}`);
        }
      } else {
        mappedData[dbField] = value.trim();
      }
    }
  }
  // Get default company if not provided
  if (!mappedData.company_id) {
    const { data: defaultCompany } = await supabase.from('companies').select('id').eq('is_active', true).limit(1).maybeSingle();
    if (defaultCompany) {
      mappedData.company_id = defaultCompany.id;
    }
  }
  // Set default values and validate enum values
  if (!mappedData.status) {
    mappedData.status = 'active';
  } else {
    const status = mappedData.status.toString().toLowerCase();
    const validStatuses = [
      'active',
      'inactive',
      'terminated',
      'archived'
    ];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid employee status: ${mappedData.status}. Must be one of: ${validStatuses.join(', ')}`);
    }
    mappedData.status = status;
  }
  if (!mappedData.employee_type) {
    mappedData.employee_type = 'staff';
  } else {
    const employeeType = mappedData.employee_type.toString().toLowerCase();
    const validTypes = [
      'staff',
      'manager',
      'contractor',
      'intern',
      'owner',
      'director'
    ];
    if (!validTypes.includes(employeeType)) {
      throw new Error(`Invalid employee type: ${mappedData.employee_type}. Must be one of: ${validTypes.join(', ')}`);
    }
    mappedData.employee_type = employeeType;
  }
  // Use upsert with email as the conflict resolution key
  const { error } = await supabase.from('employees').upsert(mappedData, {
    onConflict: 'email',
    ignoreDuplicates: false
  });
  if (error) throw error;
}
async function updateEmployeeManager(supabase, employeeEmail, managerName) {
  if (!employeeEmail || !managerName) {
    throw new Error('Employee email and manager name are required');
  }
  // Find the employee by email
  const { data: employee } = await supabase.from('employees').select('id').eq('email', employeeEmail).maybeSingle();
  if (!employee) {
    throw new Error(`Employee with email "${employeeEmail}" not found`);
  }
  // Find the manager by name (improved search)
  const nameParts = managerName.trim().split(' ');
  let manager = null;
  if (nameParts.length >= 2) {
    // Try exact first name + last name match
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(' ');
    const { data: exactMatch } = await supabase.from('employees').select('id, first_name, last_name').eq('status', 'active').in('employee_type', [
      'owner',
      'director',
      'manager'
    ]).ilike('first_name', firstName).ilike('last_name', lastName).maybeSingle();
    if (exactMatch) {
      manager = exactMatch;
    }
  }
  // If no exact match, try full name concatenation
  if (!manager) {
    const { data: fullNameMatch } = await supabase.from('employees').select('id, first_name, last_name').eq('status', 'active').in('employee_type', [
      'owner',
      'director',
      'manager'
    ]).or(`first_name||' '||last_name.ilike.%${managerName}%`).maybeSingle();
    if (fullNameMatch) {
      manager = fullNameMatch;
    }
  }
  // If still no match, try partial matches
  if (!manager && nameParts.length > 0) {
    const { data: partialMatch } = await supabase.from('employees').select('id, first_name, last_name').eq('status', 'active').in('employee_type', [
      'owner',
      'director',
      'manager'
    ]).or(`first_name.ilike.%${nameParts[0]}%,last_name.ilike.%${nameParts[nameParts.length - 1]}%`).maybeSingle();
    if (partialMatch) {
      manager = partialMatch;
    }
  }
  if (!manager) {
    throw new Error(`Manager with name "${managerName}" not found`);
  }
  // Prevent self-assignment as manager
  if (manager.id === employee.id) {
    throw new Error(`Employee cannot be their own manager`);
  }
  // Update the employee's manager
  const { error } = await supabase.from('employees').update({
    manager_id: manager.id
  }).eq('id', employee.id);
  if (error) throw error;
  console.log(`Updated manager for ${employeeEmail}: ${manager.first_name} ${manager.last_name}`);
}
async function importCompany(supabase, row, template) {
  const mappedData = {};
  for (const [dbField, csvField] of Object.entries(template.field_mappings)){
    const value = row[csvField];
    if (value && value.trim()) {
      if (dbField === 'has_sponsor_license') {
        mappedData[dbField] = value.toLowerCase() === 'true' || value === '1';
      } else if (dbField === 'parent_company_name') {
        // Handle parent company name lookup
        const parentCompanyName = value.trim();
        const { data: parentCompany } = await supabase.from('companies').select('id').eq('name', parentCompanyName).eq('is_active', true).maybeSingle();
        if (parentCompany) {
          mappedData['parent_company_id'] = parentCompany.id;
        } else {
          console.warn(`Parent company "${parentCompanyName}" not found`);
        }
      } else if (dbField === 'country_name') {
        // Handle country name lookup
        const countryName = value.trim();
        const { data: country } = await supabase.from('countries').select('id').eq('name', countryName).eq('is_active', true).maybeSingle();
        if (country) {
          mappedData['country_id'] = country.id;
        } else {
          console.warn(`Country "${countryName}" not found`);
        }
      } else {
        mappedData[dbField] = value.trim();
      }
    }
  }
  // Set default values
  mappedData.status = 'active';
  mappedData.is_active = true;
  // Use upsert with name as the conflict resolution key
  const { error } = await supabase.from('companies').upsert(mappedData, {
    onConflict: 'name',
    ignoreDuplicates: false
  });
  if (error) throw error;
}
async function importLeaveRequest(supabase, row, template) {
  const mappedData = {};
  for (const [dbField, csvField] of Object.entries(template.field_mappings)){
    const value = row[csvField];
    if (value && value.trim()) {
      if (dbField === 'leave_type') {
        // Handle leave_type enum - ensure it's lowercase and cast to correct type
        const leaveType = value.trim().toLowerCase();
        const validLeaveTypes = [
          'annual',
          'sick',
          'personal',
          'maternity',
          'paternity'
        ];
        if (!validLeaveTypes.includes(leaveType)) {
          throw new Error(`Invalid leave type: ${value}. Must be one of: ${validLeaveTypes.join(', ')}`);
        }
        // Cast to the correct enum type for leave_requests table (leave_type)
        mappedData[dbField] = leaveType;
      } else if (dbField === 'start_date' || dbField === 'end_date') {
        // Handle date fields
        const convertedDate = convertDateToISO(value.trim());
        if (!convertedDate) {
          throw new Error(`Invalid date format for ${dbField}: ${value}`);
        }
        mappedData[dbField] = convertedDate;
      } else if (dbField === 'days_requested') {
        // Handle numeric fields
        const days = parseFloat(value.trim());
        if (isNaN(days) || days < 0.5) {
          throw new Error(`Invalid days requested: ${value}. Must be a number >= 0.5`);
        }
        mappedData[dbField] = days;
      } else {
        mappedData[dbField] = value.trim();
      }
    }
  }
  // Find employee by email
  const { data: employee } = await supabase.from('employees').select('id').eq('email', mappedData.employee_email).maybeSingle();
  if (!employee) {
    throw new Error(`Employee with email ${mappedData.employee_email} not found`);
  }
  delete mappedData.employee_email;
  mappedData.employee_id = employee.id;
  // Set default status
  if (!mappedData.status) {
    mappedData.status = 'pending';
  }
  // Check for existing leave request with same employee, dates, and type
  const { data: existingRequest } = await supabase.from('leave_requests').select('id').eq('employee_id', mappedData.employee_id).eq('start_date', mappedData.start_date).eq('leave_type', mappedData.leave_type).maybeSingle();
  if (existingRequest) {
    // Update existing request
    const { error } = await supabase.from('leave_requests').update(mappedData).eq('id', existingRequest.id);
    if (error) throw error;
  } else {
    // Insert new request
    const { error } = await supabase.from('leave_requests').insert(mappedData);
    if (error) throw error;
  }
}

