#!/bin/bash

# Supabase Functions CLI Helper Script (macOS + Windows Git Bash Compatible)

# Ensure your access token is set
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "Please set SUPABASE_ACCESS_TOKEN first:"
    echo 'export SUPABASE_ACCESS_TOKEN="sbp_XXXXXX"'
    exit 1
fi

# Supabase service role key (required for fetching tenants table)
SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoeHl1c21iZnBnb2Z0cm5ibXlrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1Njk4Njg2NiwiZXhwIjoyMDcyNTYyODY2fQ.XinEnpd8pbUN4-mLqkbSQXRP1MSijjYAvQtIRsu6b-U"

# Link your project (only needed once)
PROJECT_REF="khxyusmbfpgoftrnbmyk"
FUNCTIONS_DIR="supabase/functions"

sync_local_functions() {
    echo "Syncing local functions with MasterDB..."
    mkdir -p "$FUNCTIONS_DIR"

    # Get remote function names robustly
    remote_funcs=$(npx supabase functions list --project-ref "$PROJECT_REF" \
        | awk -F'|' 'NR>2 {gsub(/^[ \t]+|[ \t]+$/, "", $2); if($2!="NAME" && $2!="") print $2}')

    # Get local function directories as array
    mapfile -t local_funcs_array < <(ls "$FUNCTIONS_DIR" 2>/dev/null || echo "")

    for func in $remote_funcs; do
        # Check if func exists in local_dirs
        exists=false
        for local in "${local_funcs_array[@]}"; do
            if [[ "$func" == "$local" ]]; then
                exists=true
                break
            fi
        done

        if [ "$exists" = false ]; then
            echo "Function '$func' missing locally. Downloading..."
            npx supabase functions download "$func" --project-ref "$PROJECT_REF"
        else
            echo "Function '$func' already exists locally. Skipping..."
        fi
    done

    echo "Local functions synced."
    echo ""
}



# Function to show current functions, count, and summary
show_functions() {
    sync_local_functions
    echo "Current functions in MasterDB:"
    funcs=$(npx supabase functions list --project-ref "$PROJECT_REF" | tail -n +2 | grep -v '^[[:space:]]*$')

    if [ -z "$funcs" ]; then
        echo "No functions found."
        total=0
    else
        echo "$funcs" | while read func; do
            echo -e "\033[0;34m$func\033[0m"
        done
        total=$(echo "$funcs" | grep -v '^[[:space:]]*$' | wc -l | tr -d ' ')
        total=$((total - 2))
    fi
    echo ""
    echo "Total functions: $total"

    echo "-----------------------------"
    echo "MasterDB: $total functions deployed"

    # Fetch tenants list
    tenants_json=$(curl -s "https://$PROJECT_REF.supabase.co/rest/v1/tenants?select=name,tenantid" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY" \
        -H "Content-Type: application/json")

    # Filter out empty lines before reading
    tenant_names=$(echo "$tenants_json" | jq -r '.[].name' | grep -v '^[[:space:]]*$')
    tenant_ids=$(echo "$tenants_json" | jq -r '.[].tenantid' | grep -v '^[[:space:]]*$')

    if [ -z "$tenant_ids" ]; then
        echo "No tenant projects found or failed to fetch tenants."
    else
        echo "Tenant Projects Summary:"
        # Use paste to safely combine names and ids line by line
        paste <(echo "$tenant_names") <(echo "$tenant_ids") | while IFS=$'\t' read -r tenant_name tenant_id; do
            # Fetch actual functions for this tenant
            tenant_funcs=$(npx supabase functions list --project-ref "$tenant_id" | tail -n +2 | grep -v '^[[:space:]]*$')
            if [ -z "$tenant_funcs" ]; then
                tenant_total=0
            else
                tenant_total=$(echo "$tenant_funcs" | grep -v '^[[:space:]]*$' | wc -l | tr -d ' ')
                tenant_total=$((tenant_total - 2))
            fi
            echo "  $tenant_name ($tenant_id) --- $tenant_total functions deployed"
        done
    fi
    echo "-----------------------------"
}

# Display current functions at startup
echo ""
echo "Supabase Functions CLI Helper"
echo "Project Ref: $PROJECT_REF"
echo "-----------------------------"
show_functions

while true; do
    echo ""
    echo "Choose an action:"
    echo "1) Create & Edit new function (auto-deploy to MasterDB Only after edit)"
    echo "2) Delete function (MasterDB + local folder + All Tenants)"
    echo "3) Get Tenants Table (name & tenantid)"
    echo "4) Deploy and Update all functions to all tenants and Master DB"
    echo "5) Exit"
    read -p "Enter choice [1-5]: " choice
    echo ""

    case $choice in
        1)
            show_functions
            read -p "Enter function name to create: " fname
            npx supabase functions new "$fname"
            
            if command -v vim >/dev/null 2>&1; then
                echo "Opening $FUNCTIONS_DIR/$fname/index.ts in vim..."
                vim "$FUNCTIONS_DIR/$fname/index.ts"
            elif command -v nano >/dev/null 2>&1; then
                echo "Opening $FUNCTIONS_DIR/$fname/index.ts in nano..."
                nano "$FUNCTIONS_DIR/$fname/index.ts"
            else
                echo "Neither vim nor nano is installed. Please edit $FUNCTIONS_DIR/$fname/index.ts manually."
            fi

            echo "Deploying function '$fname'..."
            npx supabase functions deploy "$fname" --project-ref "$PROJECT_REF"
            echo "Function '$fname' deployed successfully."

            echo ""
            echo "Updated list of functions:"
            show_functions
            ;;
        2)
            show_functions
            read -p "Enter function name to delete: " fname
            echo "Deleting function '$fname' from master project..."
            npx supabase functions delete "$fname" --project-ref "$PROJECT_REF"

            tenant_ids=$(curl -s "https://$PROJECT_REF.supabase.co/rest/v1/tenants?select=name,tenantid" \
                -H "apikey: $SERVICE_KEY" \
                -H "Authorization: Bearer $SERVICE_KEY" \
                -H "Content-Type: application/json" \
                | jq -r '.[] | "\(.name) (\(.tenantid))"')

            if [ -n "$tenant_ids" ]; then
                for tenant in $tenant_ids; do
                    tenant_ref=$(echo "$tenant" | awk '{print $NF}' | tr -d '()')
                    echo "Deleting function '$fname' from tenant project: $tenant_ref"
                    npx supabase functions delete "$fname" --project-ref "$tenant_ref"
                done
            else
                echo "No tenants found or failed to fetch tenants."
            fi

            if [ -d "$FUNCTIONS_DIR/$fname" ]; then
                rm -rf "$FUNCTIONS_DIR/$fname"
                echo "Local directory '$FUNCTIONS_DIR/$fname' deleted."
            else
                echo "Local directory '$FUNCTIONS_DIR/$fname' not found."
            fi

            echo ""
            echo "Updated list of functions in master project:"
            show_functions
            ;;
        3)
            echo "Fetching tenants table (name & tenantid)..."
            curl "https://$PROJECT_REF.supabase.co/rest/v1/tenants?select=name,tenantid" \
                -H "apikey: $SERVICE_KEY" \
                -H "Authorization: Bearer $SERVICE_KEY" \
                -H "Content-Type: application/json"
            echo ""
            show_functions
            ;;
        4)
            echo "Deploying all functions to all tenants and Master DB..."
            func_list=$(ls "$FUNCTIONS_DIR")

            for func in $func_list; do
                echo ""
                echo "Deploying function '$func' to MasterDB..."
                npx supabase functions deploy "$func" --project-ref "$PROJECT_REF"
                echo "Function '$func' deployed to MasterDB."
            done

            tenants_json=$(curl -s "https://$PROJECT_REF.supabase.co/rest/v1/tenants?select=name,tenantid" \
                -H "apikey: $SERVICE_KEY" \
                -H "Authorization: Bearer $SERVICE_KEY" \
                -H "Content-Type: application/json")

            tenant_names=$(echo "$tenants_json" | jq -r '.[].name')
            tenant_ids=$(echo "$tenants_json" | jq -r '.[].tenantid')

            if [ -z "$tenant_ids" ]; then
                echo "No tenants found or failed to fetch tenants."
            else
                while IFS= read -r tenant_name && IFS= read -r tenant_id <&3; do
                    echo ""
                    echo "Deploying all functions to tenant: $tenant_name ($tenant_id)"
                    for func in $func_list; do
                        echo "Deploying $func to tenant project: $tenant_id ..."
                        npx supabase functions deploy "$func" --project-ref "$tenant_id"
                    done
                done 3<<< "$tenant_ids" <<< "$tenant_names"
            fi

            echo ""
            echo "All functions deployed successfully."
            show_functions
            ;;
        5)
            echo "Exiting..."
            exit 0
            ;;
        *)
            echo "Invalid choice, please enter a number between 1 and 5."
            ;;
    esac
done
