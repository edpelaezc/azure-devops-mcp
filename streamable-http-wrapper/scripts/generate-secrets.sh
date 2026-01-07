#!/bin/bash

###############################################################################
# Nova Azure DevOps MCP Wrapper - Secret Generation Script
#
# This script helps generate the required secrets and PAT token for deployment.
#
# Usage:
#   ./scripts/generate-secrets.sh
###############################################################################

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Nova Azure DevOps MCP Wrapper - Secret Generation            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if openssl is available
if ! command -v openssl &> /dev/null; then
    echo -e "${RED}[ERROR]${NC} openssl not found. Please install OpenSSL first."
    exit 1
fi

echo -e "${GREEN}[1/3]${NC} Generating API Key..."
API_KEY=$(openssl rand -base64 32)
echo -e "${BLUE}Your API Key:${NC}"
echo ""
echo -e "${GREEN}$API_KEY${NC}"
echo ""
echo "This key will be used by AWS DevOps Agent to authenticate to your MCP server."
echo "Save this in a secure location (password manager)."
echo ""

echo -e "${GREEN}[2/3]${NC} Azure DevOps PAT Token Instructions"
echo ""
echo "You need to generate a Personal Access Token (PAT) from Azure DevOps:"
echo ""
echo -e "${BLUE}Steps:${NC}"
echo "1. Go to: https://dev.azure.com/distelsa/_usersSettings/tokens"
echo "2. Click 'New Token'"
echo "3. Name: 'Nova MCP Server'"
echo "4. Organization: Distelsa"
echo "5. Select scopes:"
echo "   - Code: Read"
echo "   - Build: Read & Execute"
echo "   - Work Items: Read, Write & Manage"
echo "6. Click 'Create'"
echo "7. COPY the generated token (you won't see it again!)"
echo ""
read -p "Press ENTER when you have generated and copied your PAT token..."
echo ""

echo "Paste your PAT token here (it will not be echoed):"
read -s PAT_TOKEN
echo ""

if [ -z "$PAT_TOKEN" ]; then
    echo -e "${RED}[ERROR]${NC} PAT token cannot be empty"
    exit 1
fi

echo -e "${GREEN}[3/3]${NC} Generating files..."
echo ""

# Create .env file
cat > .env <<EOF
# Azure DevOps Configuration
AZURE_DEVOPS_ORG=distelsa
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/distelsa
AZURE_DEVOPS_DEFAULT_PROJECT=Nova
AZURE_DEVOPS_PAT=$PAT_TOKEN

# Security
MCP_API_KEY=$API_KEY

# Server Configuration
PORT=3000
NODE_ENV=development
EOF

echo -e "${GREEN}✓${NC} Created .env file"

# Create k8s secret YAML (separate file for security)
cat > k8s/secrets.yaml <<EOF
---
apiVersion: v1
kind: Secret
metadata:
  name: azdo-mcp-secret
  namespace: central-services
type: Opaque
stringData:
  azure-devops-pat: "$PAT_TOKEN"
  mcp-api-key: "$API_KEY"
EOF

echo -e "${GREEN}✓${NC} Created k8s/secrets.yaml"
echo ""

echo -e "${YELLOW}[SECURITY WARNING]${NC}"
echo "The following files contain sensitive information:"
echo "  - .env"
echo "  - k8s/secrets.yaml"
echo ""
echo "These files are in .gitignore and should NEVER be committed to Git."
echo "Store the API key and PAT token in a secure password manager."
echo ""

echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Secrets generated successfully!                               ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Summary:"
echo ""
echo -e "${BLUE}API Key:${NC}"
echo "$API_KEY"
echo ""
echo -e "${BLUE}Files created:${NC}"
echo "  - .env (for local development)"
echo "  - k8s/secrets.yaml (for Kubernetes deployment)"
echo ""
echo "Next steps:"
echo "1. Test locally: npm start"
echo "2. Deploy to EKS: ./scripts/deploy.sh"
echo "3. Configure AWS DevOps Agent with the API key above"
echo ""
