# Quick Start Guide - Nova Azure DevOps MCP Wrapper

Get up and running in **15 minutes** with this streamlined guide.

## 🎯 Goal

Deploy an HTTPS/SSE endpoint that AWS DevOps Agent can use to access Azure DevOps data for Nova.

## ⚡ Prerequisites (5 min)

Before starting, ensure you have:

- [ ] Node.js 20+ installed
- [ ] Docker installed
- [ ] AWS CLI configured (`aws configure`)
- [ ] kubectl configured for EKS (`aws eks update-kubeconfig --name your-cluster`)
- [ ] Access to Azure DevOps (dev.azure.com/distelsa)

## 🚀 Local Development (5 min)

### 1. Setup Project

```bash
cd sse-wrapper
npm install
```

### 2. Generate Secrets

```bash
./scripts/generate-secrets.sh
```

This will:

- Generate a random API key
- Prompt you to create an Azure DevOps PAT token
- Create `.env` file for local development
- Create `k8s/secrets.yaml` for Kubernetes deployment

**IMPORTANT**: Follow the on-screen instructions to generate your PAT token at:
https://dev.azure.com/distelsa/_usersSettings/tokens

Required scopes:

- ✅ Code: Read
- ✅ Build: Read & Execute
- ✅ Work Items: Read, Write & Manage

### 3. Test Locally

```bash
# Start server
npm start

# In another terminal, run tests
npm test
```

Expected output:

```
✓ Health check passed
✓ Correctly rejected unauthenticated request
✓ Correctly rejected invalid API key
✓ MCP initialize response received
✓ All tests passed!
```

If all tests pass, you're ready to deploy! 🎉

## 🐳 Deploy to EKS (5 min)

### 1. Configure Deployment

Edit `k8s/deployment.yaml` and replace:

```yaml
# Line 61: Your ECR repository
image: YOUR_AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/nova/azdo-mcp-wrapper:latest

# Line 138: Your ACM certificate ARN
alb.ingress.kubernetes.io/certificate-arn: "arn:aws:acm:us-east-1:YOUR_ACCOUNT:certificate/YOUR_CERT_ID"

# Line 148: Your domain
- host: azdo-mcp.nova.cloud
```

**Find your AWS Account ID:**

```bash
aws sts get-caller-identity --query Account --output text
```

**Find your ACM Certificate ARN:**

```bash
aws acm list-certificates --region us-east-1
```

### 2. Create ECR Repository (if not exists)

```bash
aws ecr create-repository \
  --repository-name nova/azdo-mcp-wrapper \
  --region us-east-1
```

### 3. Deploy Everything

```bash
./scripts/deploy.sh
```

This automated script will:

- ✅ Build Docker image
- ✅ Push to ECR
- ✅ Apply Kubernetes manifests
- ✅ Wait for deployment to be ready
- ✅ Display status and endpoints

### 4. Configure DNS

The script will output the ALB endpoint:

```
ALB Endpoint: k8s-centralse-azdompwr-xxx.us-east-1.elb.amazonaws.com
```

Create a CNAME record in your DNS:

```
Type: CNAME
Name: azdo-mcp.nova.cloud
Value: k8s-centralse-azdompwr-xxx.us-east-1.elb.amazonaws.com
TTL: 300
```

Wait 5 minutes for DNS propagation.

### 5. Test Public Endpoint

```bash
curl https://azdo-mcp.nova.cloud/health
```

Expected response:

```json
{
  "status": "healthy",
  "service": "nova-azdo-mcp-wrapper",
  "organization": "distelsa",
  "project": "Nova",
  "activeConnections": 0
}
```

✅ **If you see this, your wrapper is live!**

## 🤖 Configure AWS DevOps Agent

### 1. Add MCP Server

Go to: **AWS Console → DevOps Agent → Capabilities → MCP Servers → Add**

```yaml
Name: Nova Azure DevOps
Endpoint URL: https://azdo-mcp.nova.cloud/mcp
Description: Access to Azure DevOps data for Nova project
Enable Dynamic Client Registration: No

Authorization:
  Type: API Key
  API Key: [paste your API_KEY from .env]
  Header Name: Authorization
  Token Prefix: Bearer
```

### 2. Enable in Agent Space

Go to: **Agent Space → nova-production → Capabilities → MCP Servers**

- Select: **Nova Azure DevOps**
- Tools: **Allow all tools** (or select specific ones)
- Click **Add**

### 3. Test Integration

Try a prompt in AWS DevOps Agent:

```
List the 5 most recent builds in the Nova project
```

If the agent can respond with build data from Azure DevOps, **you're done!** 🎉

## 🔍 Verify Everything Works

### Check Pods

```bash
kubectl get pods -n central-services -l app=azdo-mcp-wrapper
```

Expected: 2 pods in `Running` state

### Check Logs

```bash
kubectl logs -n central-services -l app=azdo-mcp-wrapper -f
```

You should see connection logs when AWS DevOps Agent connects.

### Check Health

```bash
curl https://azdo-mcp.nova.cloud/health | jq
```

Should return status `healthy` with organization `distelsa`.

## 🐛 Troubleshooting

### Local tests fail

```bash
# Check .env file exists
cat .env

# Verify PAT token is valid
curl -u :YOUR_PAT_TOKEN https://dev.azure.com/distelsa/_apis/projects?api-version=7.0
```

### Deployment fails

```bash
# Check ECR login
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Check kubectl context
kubectl config current-context

# Check secrets exist
kubectl get secret -n central-services azdo-mcp-secret
```

### Public endpoint returns 502/503

```bash
# Check pods are running
kubectl get pods -n central-services -l app=azdo-mcp-wrapper

# Check pod logs
kubectl logs -n central-services -l app=azdo-mcp-wrapper

# Check ALB target health
# Go to AWS Console → EC2 → Load Balancers → Select ALB → Target Groups
```

### AWS DevOps Agent can't connect

```bash
# Verify API key matches
kubectl get secret -n central-services azdo-mcp-secret -o jsonpath='{.data.mcp-api-key}' | base64 -d

# Test endpoint manually
curl -H "Authorization: Bearer YOUR_API_KEY" \
     -X POST https://azdo-mcp.nova.cloud/mcp
```

## 📚 Next Steps

Now that your wrapper is running:

1. **Monitor Usage**

   ```bash
   kubectl logs -n central-services -l app=azdo-mcp-wrapper -f
   ```

2. **Scale if needed**

   ```bash
   kubectl scale deployment/azdo-mcp-wrapper -n central-services --replicas=3
   ```

3. **Update when needed**

   ```bash
   # Make changes to code
   # Run deploy script again
   ./scripts/deploy.sh
   ```

4. **Add more MCP servers** for other integrations (ELK, PostgreSQL, etc.)

## 🎓 Learn More

- [Full Documentation](./README.md)
- [Kubernetes Guide](./k8s/README.md)
- [Azure DevOps MCP Tools](https://github.com/microsoft/azure-devops-mcp)
- [AWS DevOps Agent Docs](https://aws.amazon.com/devops-agent/)

---

**Time to Complete**: ~15 minutes
**Difficulty**: Intermediate
**Support**: nova-team@distelsa.com
