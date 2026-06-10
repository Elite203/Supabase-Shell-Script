Supabase Functions CLI Helper Script – Documentation
1. Overview
This is a Bash-based CLI helper script to manage Supabase Edge Functions across:
- The Master Project
- All tenant projects dynamically fetched from a tenants table
- Local function directories

It allows you to create, edit, deploy, and delete functions, and also fetch tenants dynamically. 
The script is designed to be used on Git Bash or Linux/Mac terminals, not directly in Windows CMD.
2. Features
| Option | Functionality |
| ------- | ------------- |
| 1) Create & Edit new function | Creates a new Supabase Edge Function in the Master project. Opens the function code in vim or nano for editing. Auto-deploys the function after editing. |
| 2) Delete function | Deletes a function from Master project, all tenant projects, and local function directory. |
| 3) Get Tenants Table | Fetches all tenants dynamically using the Supabase service role key and displays name & tenantid. |
| 4) Deploy all functions to all tenants | Deploys all local functions in the supabase/functions directory to all tenant projects dynamically. |
| 5) Exit | Exits the script. |
3. Dependencies
The script requires the following:
- Node.js and npm – Required for npx commands. Recommended: Node.js v18+
- Supabase CLI – Installed via `npm install -g supabase`
- Git Bash / Linux / Mac terminal – Bash syntax required
- curl – Used to fetch tenant IDs dynamically
- grep – Used with Perl regex (-oP) to extract tenant IDs from JSON
- vim or nano (optional) – Used to edit function code; otherwise, manual editing of local files required
4. Required Environment Variables
- `SUPABASE_ACCESS_TOKEN` – CLI access token for Supabase
  ```bash
  export SUPABASE_ACCESS_TOKEN="your_supabase_access_token"
  ```
- `SERVICE_KEY` – Supabase service role key for fetching tenants table (hardcoded in script by default)
- `PROJECT_REF` – Supabase project reference ID for Master project
- `FUNCTIONS_DIR` – Local folder storing all Supabase Edge Functions (default: supabase/functions)

**Important:** The local folder is crucial for proper functioning. All edits should be done in the respective function folder, where `index.ts` is the main file for that function. This ensures deployments and deletions work correctly.
5. Directory Structure
```
project_root/
│
├── supabase/
│   └── functions/
│       ├── function1/
│       │   └── index.ts
│       ├── function2/
│       │   └── index.ts
│       └── ...
│
└── supabase_functions_cli_helper.sh
```

Each folder inside `functions/` represents one function.
`index.ts` is the main file of the function. All edits should happen here.
6. How to Run the Script
**Step 1:** Open Git Bash / Linux / Mac terminal  
**Step 2:** Navigate to project folder  
```bash
cd path/to/project_root
```
**Step 3:** Make script executable (Linux/Mac)  
```bash
chmod +x supabase_functions_cli_helper.sh or sh supabase_edge_functions.sh
```
**Step 4:** Run the script  
```bash
./supabase_functions_cli_helper.sh
```
**On Windows Git Bash:**  
```bash
bash supabase_functions_cli_helper.sh
```
7. Detailed Functionalities
**Option 1 – Create & Edit New Function**
- Lists current functions in Master project.
- Prompts for function name.
- Creates the function locally:
  ```bash
  npx supabase functions new <function_name>
  ```
- Opens index.ts in vim or nano for editing.
- Deploys function to Master project:
  ```bash
  npx supabase functions deploy <function_name> --project-ref <MASTER_PROJECT_REF>
  ```
- Shows updated function list.

**Option 2 – Delete Function**
- Displays functions in Master project.
- Prompts for function name to delete.
- Deletes from Master project, tenant projects, and local folder.

**Option 3 – Get Tenants Table**
```bash
curl "https://<MASTER_PROJECT_REF>.supabase.co/rest/v1/tenants?select=name,tenantid"   -H "apikey: $SERVICE_KEY"   -H "Authorization: Bearer $SERVICE_KEY"   -H "Content-Type: application/json"
```

**Option 4 – Deploy All Functions to All Tenants**
- Lists all local functions in FUNCTIONS_DIR.
- Fetches tenant IDs dynamically.
- Loops over each function and tenant to deploy automatically.

**Option 5 – Exit**
- Exits the script.
8. Notes / Recommendations
- Do not run in Windows CMD; use Git Bash or Linux terminal.
- Ensure Supabase CLI and Node.js are installed.
- Local folder is critical – all edits are done there. index.ts is the main file for every function.
- Tenant deployments use dynamic fetching; no hardcoding required.
- Color highlighting may not appear in Windows CMD.
9. Example Workflow
**Create a new function hello:**
Option 1 → Enter hello → edit code in local index.ts → auto-deploy to Master.

**Deploy all local functions to all tenants:**
Option 4 → Loops through FUNCTIONS_DIR and tenant IDs.

**Delete function hello from everywhere:**
Option 2 → Enter hello → deletes from Master, tenants, and local folder.

**Fetch tenant list:**
Option 3 → Displays name and tenantid.
10. Summary
This script is a complete CLI for Supabase Edge Function management across:
- Master project
- Tenant projects
- Local directories

It automates creation, editing, deployment, and deletion, ensuring all edits are done locally in index.ts for proper functioning.
