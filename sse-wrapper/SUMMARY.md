# Azure DevOps MCP SSE Wrapper - Executive Summary

## What is This?

A production-ready **HTTPS/SSE wrapper** that enables AI agents and applications to integrate with Azure DevOps through the official Microsoft MCP server over the network.

## Problem Solved

**Challenge:** Many AI agents and applications require HTTPS/SSE protocol for remote communication, but Microsoft's Azure DevOps MCP server only supports stdio (local communication).

**Solution:** This lightweight wrapper bridges the protocols, exposing the MCP server via public HTTPS endpoint that any SSE-compatible client can consume.

## Architecture (Simple View)

```
AI Agent / Application
    ↓ HTTPS/SSE
This Wrapper (Kubernetes/Docker)
    ↓ stdio
Microsoft MCP Server
    ↓ REST API
Azure DevOps
```

## Key Features

✅ **Production Ready**

- High availability (2+ replicas)
- Auto-scaling (HPA)
- Health checks
- Graceful shutdown
- Comprehensive logging

✅ **Secure**

- API key authentication
- HTTPS with valid certificates
- Non-root containers
- Kubernetes secrets for sensitive data

✅ **Simple to Deploy**

- Automated deployment script
- Complete Kubernetes manifests
- 15-minute quick start guide

✅ **Cost Effective**

- ~$20/month average
- Scales to $45/month max
- Minimal resource usage

## Example Use Cases

### 1. AI-Powered DevOps Automation

- **AI agents** can investigate incidents by querying builds, commits, and work items
- **Automated RCA** generation by correlating code changes with deployments
- **Intelligent alerts** that include relevant Azure DevOps context

### 2. Remote MCP Access

- Access Azure DevOps MCP from **cloud-hosted AI agents**
- Enable **serverless functions** to query Azure DevOps data
- Build **custom dashboards** that leverage MCP tools

### 3. Multi-Tool Integration

- Combine Azure DevOps data with other services via AI agents
- Create **workflows** that span multiple systems
- Enable **cross-platform automation**

## Project Stats

| Metric          | Value   |
| --------------- | ------- |
| Lines of Code   | ~600    |
| Lines of Docs   | ~2,300  |
| Docker Image    | ~150 MB |
| Memory per Pod  | 256 MB  |
| CPU per Pod     | 250m    |
| Monthly Cost    | ~$20    |
| Deployment Time | ~15 min |
| HA Replicas     | 2-5     |

## Files Overview

```
📁 sse-wrapper/
├── 📄 server.js              ⭐ Core application (350 lines)
├── 📄 Dockerfile             🐳 Container build
├── 📄 package.json           📦 Dependencies
├── 📁 k8s/
│   └── deployment.yaml       ☸️  Complete K8s config
├── 📁 scripts/
│   ├── deploy.sh             🚀 Automated deployment
│   └── generate-secrets.sh   🔐 Secret generation
└── 📁 docs/
    ├── README.md             📚 Complete guide
    ├── QUICKSTART.md         ⚡ 15-min setup
    └── ARCHITECTURE.md       🏗️  Deep dive
```

## Quick Start (3 Steps)

### 1. Local Development

```bash
cd sse-wrapper
./scripts/generate-secrets.sh
npm install
npm start
```

### 2. Deploy to EKS

```bash
# Edit k8s/deployment.yaml with your values
./scripts/deploy.sh
```

### 3. Configure Your AI Agent/Client

```
Endpoint: https://your-domain.com/mcp
Auth: Bearer [your-api-key]
```

## Technology Stack

| Layer         | Technology                   |
| ------------- | ---------------------------- |
| Application   | Node.js 20 + Express         |
| MCP Server    | @azure-devops/mcp (official) |
| Container     | Docker (Alpine)              |
| Orchestration | Kubernetes (EKS)             |
| Load Balancer | AWS ALB                      |
| TLS           | AWS ACM                      |
| Protocol      | HTTPS + SSE                  |

## Benefits

### For Organizations

- ✅ **Remote Access**: Enable cloud-based AI agents to access Azure DevOps
- ✅ **Automation**: Build intelligent workflows that span multiple systems
- ✅ **Integration**: Connect Azure DevOps with modern AI platforms
- ✅ **Scalability**: Auto-scaling infrastructure for variable workloads

### For Developers

- ✅ **Standard Protocol**: Use SSE instead of stdio for remote access
- ✅ **API Key Auth**: Simple, secure authentication mechanism
- ✅ **Production Ready**: Kubernetes manifests and monitoring included
- ✅ **Well Documented**: Comprehensive guides and examples

### Cost Efficiency

- **Infrastructure:** ~$20/month for basic deployment
- **Scaling:** Automatically scales from 2 to 5 replicas based on load
- **Open Source:** Free to use and modify under MIT license

## Compatible Clients

### AI Agents

- AWS DevOps Agent
- Anthropic Claude (with MCP support)
- Custom AI agents using MCP protocol
- LangChain applications
- AutoGPT and similar frameworks

### Applications

- Any SSE-compatible HTTP client
- Custom dashboards and tools
- Serverless functions (Lambda, Azure Functions)
- Backend services requiring Azure DevOps integration

## Security

| Layer        | Protection              |
| ------------ | ----------------------- |
| Network      | HTTPS + TLS 1.2+        |
| Auth         | API key (Bearer token)  |
| Container    | Non-root user           |
| Secrets      | Kubernetes Secrets      |
| Azure DevOps | PAT with minimal scopes |

## Monitoring

```bash
# Health check
curl https://your-domain.com/health

# View logs
kubectl logs -n mcp-services -l app=azdo-mcp-wrapper -f

# Check status
kubectl get pods -n mcp-services -l app=azdo-mcp-wrapper
```

## Contributing

This is an open-source project. Contributions are welcome!

- **Issues**: Report bugs or request features
- **Pull Requests**: Submit improvements
- **Documentation**: Help improve guides and examples
- **Testing**: Share your use cases and feedback

## Documentation Links

- [📄 Complete README](./README.md) - Full documentation
- [⚡ Quick Start](./QUICKSTART.md) - 15-minute setup
- [🏗️ Architecture](./ARCHITECTURE.md) - Technical deep dive
- [📁 Project Structure](./PROJECT-STRUCTURE.md) - File organization
- [☸️ Kubernetes Guide](./k8s/README.md) - Deployment details

## Getting Help

- **Documentation**: Start with [QUICKSTART.md](./QUICKSTART.md)
- **Issues**: Report bugs or ask questions on GitHub
- **Community**: Share your use cases and implementations

## Status

| Component     | Status              |
| ------------- | ------------------- |
| Core Server   | ✅ Production Ready |
| Documentation | ✅ Complete         |
| Docker Build  | ✅ Tested           |
| Kubernetes    | ✅ Manifests Ready  |
| Examples      | ✅ Included         |

## Quick Start Steps

1. Review documentation (start with [QUICKSTART.md](./QUICKSTART.md))
2. Generate secrets: `./scripts/generate-secrets.sh`
3. Test locally: `npm start` and `npm test`
4. Configure K8s manifests with your Azure DevOps organization
5. Deploy: `./scripts/deploy.sh`
6. Configure DNS for your domain
7. Connect your AI agent/application
8. Monitor and enjoy!

---

**Version:** 1.0.0
**License:** MIT
**Status:** Production Ready
