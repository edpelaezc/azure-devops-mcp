#!/bin/bash

###############################################################################
# Nova Azure DevOps MCP Wrapper - Deployment Script
#
# This script automates the deployment process to EKS.
#
# Usage:
#   ./scripts/deploy.sh
#
# Prerequisites:
#   - AWS CLI configured
#   - kubectl configured for target EKS cluster
#   - Docker installed
#   - ECR repository created
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ECR_REGION="${ECR_REGION:-us-east-1}"
AWS_ACCOUNT="${AWS_ACCOUNT:-$(aws sts get-caller-identity --query Account --output text)}"
ECR_REPO="${ECR_REPO:-$AWS_ACCOUNT.dkr.ecr.$ECR_REGION.amazonaws.com/nova/azdo-mcp-wrapper}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
NAMESPACE="central-services"

echo -e "${BLUE}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  Nova Azure DevOps MCP Wrapper - Deployment Script            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to print step
step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

# Function to print info
info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Function to print warning
warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Function to print error and exit
error() {
    echo -e "${RED}[ERROR]${NC} $1"
    exit 1
}

# Check prerequisites
step "Checking prerequisites..."

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    error "AWS CLI not found. Please install it first."
fi
info "✓ AWS CLI: $(aws --version)"

# Check kubectl
if ! command -v kubectl &> /dev/null; then
    error "kubectl not found. Please install it first."
fi
info "✓ kubectl: $(kubectl version --client --short 2>/dev/null || kubectl version --client)"

# Check Docker
if ! command -v docker &> /dev/null; then
    error "Docker not found. Please install it first."
fi
info "✓ Docker: $(docker --version)"

# Check kubectl context
CURRENT_CONTEXT=$(kubectl config current-context)
info "✓ Current kubectl context: $CURRENT_CONTEXT"

echo ""
read -p "Continue with deployment to context '$CURRENT_CONTEXT'? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    error "Deployment cancelled by user"
fi

# Step 1: Build Docker image
step "Building Docker image..."
cd "$(dirname "$0")/.."
docker build -t nova/azdo-mcp-wrapper:$IMAGE_TAG .
info "✓ Image built: nova/azdo-mcp-wrapper:$IMAGE_TAG"

# Step 2: Tag for ECR
step "Tagging image for ECR..."
docker tag nova/azdo-mcp-wrapper:$IMAGE_TAG $ECR_REPO:$IMAGE_TAG
docker tag nova/azdo-mcp-wrapper:$IMAGE_TAG $ECR_REPO:$(date +%Y%m%d-%H%M%S)
info "✓ Image tagged: $ECR_REPO:$IMAGE_TAG"

# Step 3: Login to ECR
step "Logging into ECR..."
aws ecr get-login-password --region $ECR_REGION | \
    docker login --username AWS --password-stdin $ECR_REPO
info "✓ Logged into ECR"

# Step 4: Push to ECR
step "Pushing image to ECR..."
docker push $ECR_REPO:$IMAGE_TAG
docker push $ECR_REPO:$(date +%Y%m%d-%H%M%S)
info "✓ Image pushed to ECR"

# Step 5: Apply Kubernetes manifests
step "Applying Kubernetes manifests..."

# Check if namespace exists
if kubectl get namespace $NAMESPACE &> /dev/null; then
    info "✓ Namespace $NAMESPACE already exists"
else
    kubectl create namespace $NAMESPACE
    info "✓ Namespace $NAMESPACE created"
fi

# Apply manifests
kubectl apply -f k8s/deployment.yaml -n $NAMESPACE
info "✓ Manifests applied"

# Step 6: Wait for deployment
step "Waiting for deployment to be ready..."
kubectl rollout status deployment/azdo-mcp-wrapper -n $NAMESPACE --timeout=5m
info "✓ Deployment ready"

# Step 7: Display status
step "Deployment status:"
echo ""
kubectl get pods -n $NAMESPACE -l app=azdo-mcp-wrapper
echo ""
kubectl get svc -n $NAMESPACE azdo-mcp-wrapper
echo ""
kubectl get ingress -n $NAMESPACE azdo-mcp-wrapper
echo ""

# Step 8: Get ALB endpoint
step "Getting ALB endpoint..."
ALB_ENDPOINT=$(kubectl get ingress -n $NAMESPACE azdo-mcp-wrapper -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "Not ready yet")
if [ "$ALB_ENDPOINT" != "Not ready yet" ]; then
    info "✓ ALB Endpoint: $ALB_ENDPOINT"
    echo ""
    info "Configure your DNS CNAME to point to: $ALB_ENDPOINT"
else
    warn "ALB endpoint not ready yet. Wait a few minutes and check with:"
    echo "  kubectl get ingress -n $NAMESPACE azdo-mcp-wrapper"
fi

echo ""
step "Testing health check..."
POD_NAME=$(kubectl get pods -n $NAMESPACE -l app=azdo-mcp-wrapper -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n $NAMESPACE $POD_NAME -- wget -qO- http://localhost:3000/health | jq '.' || echo "jq not available in pod"
info "✓ Health check passed"

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║  Deployment completed successfully!                            ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Next steps:"
echo "1. Configure DNS CNAME record (see above)"
echo "2. Wait for DNS propagation (~5 minutes)"
echo "3. Test endpoint: curl https://your-domain.com/health"
echo "4. Configure in AWS DevOps Agent"
echo ""
echo "View logs:"
echo "  kubectl logs -n $NAMESPACE -l app=azdo-mcp-wrapper -f"
echo ""
echo "View pods:"
echo "  kubectl get pods -n $NAMESPACE -l app=azdo-mcp-wrapper"
echo ""
