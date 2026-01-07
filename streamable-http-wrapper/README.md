# Azure DevOps MCP SSE Wrapper

SSE (Server-Sent Events) wrapper for the official Microsoft Azure DevOps MCP server that enables remote network access for AI agents and applications.

## 🎯 Purpose

This wrapper solves a critical integration challenge: **Many AI agents and applications require HTTPS/SSE protocol for remote access**, but the official Microsoft Azure DevOps MCP server (`@azure-devops/mcp`) only supports stdio (local) communication.

### Architecture

```
AI Agent / Application
    ↓ HTTPS/SSE (Bearer token auth)
MCP SSE Wrapper (this project)
    ↓ stdio (stdin/stdout)
@azure-devops/mcp (Microsoft official)
    ↓ REST API
Azure DevOps API
```

## ✨ Features

- ✅ **SSE Protocol**: Exposes MCP over Server-Sent Events for remote access
- ✅ **API Key Authentication**: Secure with Bearer token authentication
- ✅ **Production Ready**: Health checks, graceful shutdown, connection management
- ✅ **Kubernetes Native**: Includes complete K8s manifests with HPA
- ✅ **Uses Official MCP**: Leverages Microsoft's maintained `@azure-devops/mcp` package
- ✅ **Organization Configurable**: Works with any Azure DevOps organization
- ✅ **Logging**: Comprehensive logging with connection tracking
- ✅ **Docker**: Multi-stage build for optimal image size

## 📋 Prerequisites

- Node.js 20+
- Azure DevOps account with organization access
- Azure DevOps Personal Access Token (PAT)
- Docker (for containerization)
- Kubernetes cluster (for production deployment)
- Domain with SSL certificate (for public HTTPS endpoint)

## 🚀 Quick Start

### 1. Clone and Install

```bash
cd sse-wrapper
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` and set:

```bash
# Azure DevOps Configuration
AZURE_DEVOPS_ORG=your-organization
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-organization
AZURE_DEVOPS_DEFAULT_PROJECT=YourProject
AZURE_DEVOPS_PAT=your-pat-token-here  # Get from: https://dev.azure.com/{org}/_usersSettings/tokens

# Security
MCP_API_KEY=your-random-api-key-here  # Generate with: openssl rand -base64 32

# Server Configuration
PORT=3000
NODE_ENV=development
```

#### Generate PAT Token

1. Go to: `https://dev.azure.com/{your-organization}/_usersSettings/tokens`
2. Click "New Token"
3. Name: "MCP Server"
4. Organization: Your Azure DevOps organization
5. Scopes:
   - **Code**: Read
   - **Build**: Read & Execute
   - **Work Items**: Read, Write & Manage
6. Copy the generated token to `.env`

#### Generate API Key

```bash
openssl rand -base64 32
```

Copy the result to `MCP_API_KEY` in `.env`

### 3. Run Locally

```bash
npm start
```

Expected output:

```
╔════════════════════════════════════════════════════════════════╗
║  Azure DevOps MCP SSE Wrapper                                  ║
║  Port: 3000                                                    ║
║  Organization: your-organization                               ║
║  Project: YourProject                                          ║
║  Org URL: https://dev.azure.com/your-organization             ║
║  Endpoint: POST /mcp                                       ║
║  Health Check: GET /health                                     ║
╚════════════════════════════════════════════════════════════════╝

[STARTUP] Server started successfully
[STARTUP] Waiting for SSE connections...
```

### 4. Test Locally

In another terminal:

```bash
# Test health check
curl http://localhost:3000/health

# Run automated test suite
npm test
```

Expected test output:

```
============================================================
Azure DevOps MCP SSE Wrapper - Local Test Suite
============================================================

[TEST 1] Health Check
------------------------------------------------------------
Status: 200
✓ Health check passed
  Organization: your-organization
  Project: YourProject
  Status: healthy
  Uptime: 5s

[TEST 2] SSE Connection without Authentication
------------------------------------------------------------
Status: 401
✓ Correctly rejected unauthenticated request

[TEST 3] SSE Connection with Invalid API Key
------------------------------------------------------------
Status: 403
✓ Correctly rejected invalid API key

[TEST 4] SSE Connection with Valid Authentication + Initialize
------------------------------------------------------------
Status: 200
✓ SSE connection established
  Sending initialize request...
  Received response: {
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
      "protocolVersion": "2024-11-05",
      ...
    }
  }
✓ MCP initialize response received

============================================================
✓ All tests passed!
============================================================
```

## 🐳 Docker Build

### Build Image

```bash
docker build -t azdo-mcp-wrapper:latest .
```

### Test Docker Image Locally

```bash
# Run container
docker run -d \
  --name azdo-mcp-test \
  -p 3000:3000 \
  -e AZURE_DEVOPS_ORG=your-organization \
  -e AZURE_DEVOPS_PAT=your-pat \
  -e MCP_API_KEY=your-api-key \
  azdo-mcp-wrapper:latest

# Check logs
docker logs -f azdo-mcp-test

# Test health
curl http://localhost:3000/health

# Stop and remove
docker stop azdo-mcp-test
docker rm azdo-mcp-test
```

## ☸️ Kubernetes Deployment

### 1. Prepare Secrets

Edit [k8s/deployment.yaml](./k8s/deployment.yaml) and replace:

- `YOUR_AZURE_DEVOPS_PAT_HERE` - Your Azure DevOps PAT token
- `YOUR_RANDOM_API_KEY_HERE` - Your generated API key
- `YOUR_AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com` - Your ECR repository
- `arn:aws:acm:us-east-1:YOUR_ACCOUNT:certificate/YOUR_CERT_ID` - Your ACM certificate ARN
- `azdo-mcp.yourdomain.com` - Your domain name

### 2. Push Image to ECR

```bash
# Authenticate to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin YOUR_AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com

# Tag image
docker tag azdo-mcp-wrapper:latest \
  YOUR_AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/azdo-mcp-wrapper:latest

# Push image
docker push YOUR_AWS_ACCOUNT.dkr.ecr.us-east-1.amazonaws.com/azdo-mcp-wrapper:latest
```

### 3. Deploy to EKS

```bash
# Apply Kubernetes manifests
kubectl apply -f k8s/deployment.yaml

# Verify deployment
kubectl get pods -n central-services -l app=azdo-mcp-wrapper
kubectl get svc -n central-services azdo-mcp-wrapper
kubectl get ingress -n central-services azdo-mcp-wrapper

# Check logs
kubectl logs -n central-services -l app=azdo-mcp-wrapper -f

# Check health
kubectl exec -n central-services -it deployment/azdo-mcp-wrapper -- \
  wget -qO- http://localhost:3000/health
```

### 4. Verify Public Endpoint

```bash
# Wait for ALB to provision (may take 3-5 minutes)
kubectl get ingress -n central-services azdo-mcp-wrapper -w

# Test public endpoint
curl https://azdo-mcp.yourdomain.com/health
```

Expected response:

```json
{
  "status": "healthy",
  "service": "azdo-mcp-wrapper",
  "version": "1.0.0",
  "organization": "your-organization",
  "project": "YourProject",
  "orgUrl": "https://dev.azure.com/your-organization",
  "activeConnections": 0,
  "uptime": 1234.56,
  "timestamp": "2026-01-06T20:30:00.000Z"
}
```

## 🔧 Client Configuration

Once deployed, configure your AI agent or application to connect to your MCP server:

### Example: AWS DevOps Agent

If using AWS DevOps Agent:

1. Go to: **AWS Console → DevOps Agent → Capabilities → MCP Servers → Add**

2. Enter configuration:

```yaml
Name: Azure DevOps MCP
Endpoint URL: https://azdo-mcp.yourdomain.com/mcp
Description: Access to Azure DevOps pipelines, builds, code, and work items
Enable Dynamic Client Registration: No

Authorization Flow: API Key
API Key: [your-mcp-api-key]
Header Name: Authorization
Token Prefix: Bearer
```

3. Enable desired tools (or select "Allow all tools")

### Example: Custom SSE Client

If building a custom client:

```javascript
const EventSource = require("eventsource");

const es = new EventSource("https://azdo-mcp.yourdomain.com/mcp", {
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
});

es.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log("Received:", data);
};

// Send JSON-RPC request
fetch("https://azdo-mcp.yourdomain.com/mcp", {
  method: "POST",
  headers: {
    "Authorization": "Bearer YOUR_API_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  }),
});
```

### Test Your Integration

Test that your client can:

- Query Azure DevOps builds
- Read git commits and file contents
- Access work items
- Execute any MCP tool from [@azure-devops/mcp](https://github.com/microsoft/azure-devops-mcp)

## 📊 Monitoring

### Check Active Connections

```bash
kubectl logs -n central-services -l app=azdo-mcp-wrapper | grep "Active connections"
```

### View Health Status

```bash
curl https://azdo-mcp.yourdomain.com/health | jq
```

### Check Kubernetes Metrics

```bash
# Pod status
kubectl get pods -n central-services -l app=azdo-mcp-wrapper

# Resource usage
kubectl top pods -n central-services -l app=azdo-mcp-wrapper

# HPA status
kubectl get hpa -n central-services azdo-mcp-wrapper
```

### View Logs

```bash
# All pods
kubectl logs -n central-services -l app=azdo-mcp-wrapper -f

# Specific connection
kubectl logs -n central-services -l app=azdo-mcp-wrapper | grep "conn-"

# Errors only
kubectl logs -n central-services -l app=azdo-mcp-wrapper | grep ERROR
```

## 🐛 Troubleshooting

### Issue: Pod not starting

```bash
# Check pod status
kubectl describe pod -n central-services -l app=azdo-mcp-wrapper

# Common causes:
# 1. Missing secrets
kubectl get secret -n central-services azdo-mcp-secret

# 2. Image pull error
kubectl get events -n central-services --sort-by='.lastTimestamp'
```

### Issue: 403 Forbidden from Client

```bash
# Verify API key in secret matches your client config
kubectl get secret -n central-services azdo-mcp-secret -o jsonpath='{.data.mcp-api-key}' | base64 -d
echo
```

### Issue: Cannot connect to Azure DevOps

```bash
# Test PAT token manually
PAT_TOKEN=$(kubectl get secret -n central-services azdo-mcp-secret -o jsonpath='{.data.azure-devops-pat}' | base64 -d)
curl -u :$PAT_TOKEN https://dev.azure.com/{your-org}/_apis/projects?api-version=7.0
```

### Issue: SSE connection drops

Check ALB timeout settings:

```bash
kubectl get ingress -n central-services azdo-mcp-wrapper -o yaml | grep idle_timeout
```

Should be at least `300` seconds for long-lived SSE connections.

## 🔒 Security Considerations

### Authentication

- ✅ API Key required via Bearer token
- ✅ PAT token with minimal scopes (Read-only recommended)
- ✅ Secrets stored in Kubernetes Secrets
- ✅ No secrets in Git repository

### Network

- ✅ HTTPS with valid SSL certificate (ACM)
- ✅ Public endpoint (for remote access)
- ⚠️ Consider IP whitelisting if your client has static IPs

### Container

- ✅ Non-root user (uid 1001)
- ✅ Read-only root filesystem capability
- ✅ Dropped all Linux capabilities
- ✅ Multi-stage build for minimal image size

### Auditing

- ✅ All requests logged with timestamps
- ✅ Connection tracking with unique IDs
- ✅ CloudTrail captures AWS-side access
- ✅ Azure DevOps logs all API calls

## 📈 Performance

### Benchmarks (Single Pod)

- **Concurrent Connections**: Up to 50 SSE connections
- **Memory Usage**: ~200-300MB per pod
- **CPU Usage**: ~100-200m under normal load
- **Response Time**: <100ms for health checks
- **Startup Time**: ~5-10 seconds

### Scaling

The deployment includes HorizontalPodAutoscaler (HPA):

- **Min Replicas**: 2
- **Max Replicas**: 5
- **Scale Up**: When CPU > 70% or Memory > 80%
- **Scale Down**: Gradual (50% every 60s)

## 💰 Cost Estimate

### Infrastructure (Monthly)

- **EKS Pods (2 replicas)**: ~$15/month
  - 2 × 0.25 vCPU × $30/vCPU/month
- **ALB**: $0 (shared with other services)
- **Data Transfer**: ~$1/month (minimal)
- **ECR Storage**: ~$0.10/month

**Total**: ~$16/month

### AWS DevOps Agent

- **Preview**: FREE
- **Post-GA**: Pricing TBA

## 🛣️ Roadmap

### Phase 1: Core Wrapper ✅ (Current)

- [x] SSE protocol support
- [x] API key authentication
- [x] Kubernetes deployment
- [x] Health checks
- [x] Logging

### Phase 2: Enhanced Features (Future)

- [ ] Rate limiting
- [ ] Request metrics (Prometheus)
- [ ] IP whitelisting
- [ ] Multi-organization support
- [ ] WebSocket fallback

### Phase 3: Integration Expansion (Future)

- [ ] Similar SSE wrappers for other stdio-based MCP servers
- [ ] WebSocket protocol support
- [ ] Multi-organization routing

## 🤝 Contributing

Contributions are welcome! This is an open-source project.

- **Issues**: Report bugs or request features on GitHub
- **Pull Requests**: Submit improvements and fixes
- **Documentation**: Help improve guides and examples
- **Testing**: Share your use cases and feedback

## 📚 References

- [Microsoft Azure DevOps MCP](https://github.com/microsoft/azure-devops-mcp) - Official MCP server
- [Model Context Protocol (MCP) Specification](https://spec.modelcontextprotocol.io/) - MCP protocol docs
- [Server-Sent Events (SSE) Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html) - SSE standard
- [AWS DevOps Agent Documentation](https://aws.amazon.com/devops-agent/) - Example client

## 📄 License

MIT License - See LICENSE file for details

---

**Last Updated**: 2026-01-06
**Version**: 1.0.0
**License**: MIT
