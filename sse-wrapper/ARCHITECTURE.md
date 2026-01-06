# Architecture Documentation

## Overview

This document explains the architecture of the Nova Azure DevOps MCP SSE Wrapper and how it enables AWS DevOps Agent to integrate with Azure DevOps.

## Problem Statement

### The Challenge

AWS DevOps Agent is a frontier AI agent that can investigate production incidents automatically. To correlate incidents with code changes and deployments, it needs access to Azure DevOps data.

**Requirements:**

- AWS DevOps Agent requires **HTTPS/SSE** protocol
- Microsoft's Azure DevOps MCP server only supports **stdio**
- Need to expose MCP server publicly on internet
- Must be secure with API key authentication
- Must be production-ready (HA, monitoring, logging)

## Solution Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────┐
│  AWS DevOps Agent (us-east-1)                               │
│  - Monitors CloudWatch/Datadog for incidents                │
│  - Executes investigation workflows                         │
│  - Generates RCA reports                                    │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ HTTPS (TLS 1.2+)
                  │ Server-Sent Events (SSE)
                  │ Authorization: Bearer <api-key>
                  │
                  ↓
┌─────────────────────────────────────────────────────────────┐
│  AWS Application Load Balancer (ALB)                        │
│  - TLS termination (ACM certificate)                        │
│  - Health checks (/health)                                  │
│  - Idle timeout: 300s (for long-lived SSE)                  │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ HTTP
                  │
                  ↓
┌─────────────────────────────────────────────────────────────┐
│  Kubernetes Service (ClusterIP)                             │
│  - Load balances across pods                                │
│  - Session affinity: None                                   │
└─────────────────┬───────────────────────────────────────────┘
                  │
                  │ HTTP
                  │
        ┌─────────┴─────────┐
        │                   │
        ↓                   ↓
┌──────────────┐    ┌──────────────┐
│  Pod 1       │    │  Pod 2       │
│  (Wrapper)   │    │  (Wrapper)   │
└──────┬───────┘    └──────┬───────┘
       │                   │
       │ stdio             │ stdio
       │ (stdin/stdout)    │ (stdin/stdout)
       │                   │
       ↓                   ↓
┌──────────────┐    ┌──────────────┐
│ @azure-devops│    │ @azure-devops│
│ /mcp process │    │ /mcp process │
└──────┬───────┘    └──────┬───────┘
       │                   │
       │ REST API          │ REST API
       │ (HTTPS)           │ (HTTPS)
       │                   │
       └─────────┬─────────┘
                 │
                 ↓
┌─────────────────────────────────────────────────────────────┐
│  Azure DevOps REST API (dev.azure.com/distelsa)             │
│  - Projects, Repositories, Builds, Work Items               │
│  - Authentication: PAT token                                │
└─────────────────────────────────────────────────────────────┘
```

## Component Details

### 1. SSE Wrapper (server.js)

**Purpose**: Bridge between SSE and stdio protocols

**Key Responsibilities:**

- Accept HTTPS/SSE connections from AWS DevOps Agent
- Validate API key authentication
- Spawn MCP server process per connection
- Pipe bidirectional communication (SSE ↔ stdio)
- Maintain keep-alive for long-lived connections
- Graceful shutdown and cleanup

**Technology:**

- Node.js 20 (Alpine Linux base)
- Express.js for HTTP server
- Child process spawning for MCP server
- SSE protocol implementation

**Resource Usage:**

- Memory: ~256MB per pod
- CPU: ~250m per pod
- Disk: Read-only root filesystem

### 2. Microsoft Azure DevOps MCP Server

**Purpose**: Official MCP server for Azure DevOps integration

**Source**: npm package `@azure-devops/mcp` (maintained by Microsoft)

**Features:**

- 50+ tools for Azure DevOps operations
- Builds, pipelines, repositories, work items, wiki, test plans
- Automatic authentication with PAT token
- JSON-RPC 2.0 over stdio

**Why we use it:**

- ✅ Official Microsoft package
- ✅ Actively maintained and updated
- ✅ Complete Azure DevOps API coverage
- ✅ Well-tested and production-ready
- ✅ Automatic updates via npm

### 3. Kubernetes Deployment

**Components:**

```
Namespace: central-services
├── Secret: azdo-mcp-secret
│   ├── azure-devops-pat
│   └── mcp-api-key
├── ConfigMap: azdo-mcp-config
│   ├── AZURE_DEVOPS_ORG
│   ├── AZURE_DEVOPS_DEFAULT_PROJECT
│   └── AZURE_DEVOPS_ORG_URL
├── Deployment: azdo-mcp-wrapper
│   ├── Replicas: 2 (min) to 5 (max)
│   ├── Strategy: RollingUpdate
│   ├── Health Checks: Liveness + Readiness
│   └── Resources: requests + limits
├── Service: azdo-mcp-wrapper (ClusterIP)
│   └── Port: 80 → 3000
├── Ingress: azdo-mcp-wrapper (ALB)
│   ├── TLS: ACM certificate
│   ├── Host: azdo-mcp.nova.cloud
│   └── Backend: Service/80
└── HPA: azdo-mcp-wrapper
    ├── Min: 2 replicas
    ├── Max: 5 replicas
    └── Metrics: CPU 70%, Memory 80%
```

### 4. AWS Application Load Balancer (ALB)

**Configuration:**

- Scheme: Internet-facing (required by AWS DevOps Agent)
- Target Type: IP (for Kubernetes pods)
- Health Check: GET /health every 30s
- Idle Timeout: 300s (5 minutes for SSE connections)
- TLS: Certificate from AWS Certificate Manager (ACM)
- Listeners: HTTPS:443 → HTTP:80

**Security:**

- Only HTTPS traffic accepted (HTTP redirects to HTTPS)
- Valid SSL certificate required
- API key authentication at application layer

## Communication Protocols

### SSE (Server-Sent Events)

**Why SSE?**

- Unidirectional server → client streaming
- Long-lived HTTP connections
- Text-based format (easy to debug)
- Works through firewalls/proxies
- Native browser support (not used here, but standard)

**SSE Message Format:**

```
HTTP/1.1 200 OK
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive

data: {"jsonrpc":"2.0","id":1,"result":{...}}

data: {"jsonrpc":"2.0","method":"notification","params":{...}}

: keep-alive
```

**Keep-Alive:**

- Sent every 30 seconds
- Prevents connection timeout
- Format: `: keep-alive\n\n`

### stdio (Standard Input/Output)

**MCP Server Protocol:**

- JSON-RPC 2.0 messages
- Newline-delimited JSON (NDJSON)
- Bidirectional communication
- Request/response + notifications

**Example Flow:**

```
Client → stdin:  {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
stdout → Client: {"jsonrpc":"2.0","id":1,"result":{...}}

Client → stdin:  {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
stdout → Client: {"jsonrpc":"2.0","id":2,"result":{"tools":[...]}}
```

## Security Architecture

### Authentication Layers

1. **TLS/HTTPS (Layer 4)**
   - Certificate validation
   - Encrypted transport
   - ALB terminates TLS

2. **API Key Authentication (Layer 7)**
   - Bearer token in Authorization header
   - Validated by wrapper server
   - 403 Forbidden if invalid

3. **Azure DevOps PAT Authentication**
   - Personal Access Token
   - Scoped permissions (read-only recommended)
   - Validated by Azure DevOps API

### Secret Management

**Development:**

```
.env file (local filesystem)
└── Ignored by Git (.gitignore)
```

**Production:**

```
Kubernetes Secret (base64 encoded)
├── Encrypted at rest (EKS encryption)
├── RBAC policies (who can read secrets)
└── Mounted as environment variables
```

**Best Practices:**

- ✅ Secrets never in Git
- ✅ Rotate PAT every 90 days
- ✅ Use least-privilege scopes
- ✅ Store in password manager
- ⚠️ Consider AWS Secrets Manager integration

### Network Security

**Ingress:**

- Public internet → ALB (HTTPS only)
- ALB → Pods (HTTP internal)

**Egress:**

- Pods → Azure DevOps (HTTPS)
- Pods → AWS ECR (HTTPS, for image pulls)

**Future Enhancements:**

- Kubernetes NetworkPolicies
- AWS Security Groups
- IP whitelisting (if AWS publishes DevOps Agent IPs)

## Scalability

### Horizontal Scaling (HPA)

**Metrics:**

```yaml
CPU Utilization > 70% → Scale up
Memory Utilization > 80% → Scale up
```

**Behavior:**

```
Min: 2 replicas (HA)
Max: 5 replicas (cost control)

Scale Up:
- Fast: 100% increase or +2 pods (whichever is higher)
- No stabilization window

Scale Down:
- Gradual: 50% decrease every 60s
- Stabilization window: 300s (5 minutes)
```

**Why these values?**

- Min 2: High availability, zero downtime during updates
- Max 5: Each pod can handle ~50 connections, 5 pods = 250 connections
- CPU 70%: Scale before saturation
- Memory 80%: Prevent OOM kills

### Connection Management

**Per Pod:**

- Max connections: ~50 concurrent SSE connections
- Memory per connection: ~5-10MB
- CPU per connection: ~5-10m

**Cluster Total:**

- 2 pods = 100 connections
- 5 pods = 250 connections

**AWS DevOps Agent Usage:**

- Typical: 1-2 connections per investigation
- Duration: 1-5 minutes per investigation
- Frequency: On-demand (triggered by incidents)

### Load Balancing

**ALB:**

- Round-robin across healthy targets
- Sticky sessions: Disabled (each request is independent)

**Kubernetes Service:**

- iptables rules for load distribution
- Service discovery via CoreDNS

## Reliability

### High Availability

**Multi-AZ Deployment:**

- Pods scheduled across multiple availability zones
- ALB routes to healthy pods in any AZ
- EKS control plane is multi-AZ by default

**Pod Distribution:**

```yaml
Deployment Strategy: RollingUpdate
maxSurge: 1 # Can have 3 pods during update (2 + 1)
maxUnavailable: 0 # Always at least 2 pods running
```

**Zero Downtime Updates:**

1. Create new pod (v2)
2. Wait for readiness probe
3. Add to load balancer
4. Remove old pod (v1) from load balancer
5. Terminate old pod
6. Repeat for next pod

### Health Checks

**Kubernetes Probes:**

```yaml
Liveness Probe:
  - Endpoint: GET /health
  - Interval: 10s
  - Timeout: 5s
  - Failure Threshold: 3 (30s before restart)

Readiness Probe:
  - Endpoint: GET /health
  - Interval: 5s
  - Timeout: 3s
  - Failure Threshold: 2 (10s before removing from service)
```

**ALB Health Checks:**

```yaml
Endpoint: GET /health
Interval: 30s
Timeout: 5s
Healthy Threshold: 2
Unhealthy Threshold: 2
```

**Health Endpoint Response:**

```json
{
  "status": "healthy",
  "service": "nova-azdo-mcp-wrapper",
  "version": "1.0.0",
  "organization": "distelsa",
  "project": "Nova",
  "activeConnections": 3,
  "uptime": 86400.5,
  "timestamp": "2026-01-06T20:30:00.000Z"
}
```

### Graceful Shutdown

**SIGTERM Handler:**

1. Receive SIGTERM from Kubernetes
2. Stop accepting new connections
3. Wait for active connections to close (max 10s)
4. Close HTTP server
5. Exit process

**Kubernetes Grace Period:**

- terminationGracePeriodSeconds: 30
- Enough time for connections to complete

## Monitoring & Observability

### Logging

**Log Levels:**

```
[STARTUP]   - Server start events
[MCP-SSE]   - SSE connection events
[MCP-SPAWN] - MCP process lifecycle
[MCP-IN]    - Incoming data from client
[MCP-OUT]   - Outgoing data to client
[MCP-ERROR] - MCP process errors
[AUTH]      - Authentication events
[ERROR]     - Application errors
[SHUTDOWN]  - Graceful shutdown events
```

**Connection Tracking:**

- Each connection gets unique ID: `conn-{timestamp}-{random}`
- All logs for a connection include the ID
- Easy to trace full lifecycle

**Example Log:**

```
[2026-01-06T20:30:15.234Z] POST /mcp/sse - IP: 52.x.x.x
[conn-1704573015234-a3f7b] [MCP-SSE] New connection from AWS DevOps Agent
[conn-1704573015234-a3f7b] [MCP-SPAWN] Starting MCP server process
[conn-1704573015234-a3f7b] [MCP-READY] Server initialized
[conn-1704573015234-a3f7b] [MCP-IN] Received 256 bytes
[conn-1704573015234-a3f7b] [MCP-OUT] tools/list
[conn-1704573015234-a3f7b] [CLIENT-DISCONNECT] Client disconnected
```

### Metrics (Future)

**Prometheus Integration:**

```yaml
Annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port: "3000"
  prometheus.io/path: "/health"
```

**Potential Metrics:**

- `mcp_active_connections` - Current SSE connections
- `mcp_total_connections` - Total connections since start
- `mcp_request_duration_seconds` - Request latency histogram
- `mcp_errors_total` - Error counter by type
- `mcp_spawned_processes` - Current MCP processes

### Distributed Tracing (Future)

- OpenTelemetry instrumentation
- AWS X-Ray integration
- Trace SSE connections end-to-end

## Performance Optimization

### Current Optimizations

1. **Multi-stage Docker Build**
   - Builder stage for dependencies
   - Production stage with minimal files
   - Result: ~150MB image (vs ~800MB naive build)

2. **Node.js Alpine Base**
   - Smaller attack surface
   - Faster pulls and starts
   - ~50MB base vs ~900MB standard Node

3. **Process Isolation**
   - Each connection spawns isolated MCP process
   - No shared state between connections
   - Connection failures don't affect others

4. **Keep-Alive**
   - Prevents connection timeouts
   - Minimal overhead (30s interval)

### Future Optimizations

1. **Connection Pooling**
   - Reuse MCP processes across connections
   - Trade-off: More memory, less CPU

2. **Caching**
   - Cache frequent Azure DevOps queries
   - Redis for shared cache across pods

3. **Compression**
   - gzip/brotli for SSE responses
   - Reduce bandwidth usage

## Disaster Recovery

### Backup

**What to Backup:**

- ✅ Kubernetes manifests (in Git)
- ✅ PAT token (in password manager)
- ✅ API key (in password manager)
- ✅ Docker images (in ECR, versioned)

**What NOT to Backup:**

- ❌ Pod state (stateless, ephemeral)
- ❌ Connections (short-lived, recreatable)

### Recovery Scenarios

**Scenario 1: Pod Crash**

- **Detection**: Liveness probe fails
- **Action**: Kubernetes restarts pod automatically
- **Impact**: None (other pod handles traffic)
- **RTO**: ~10 seconds

**Scenario 2: Node Failure**

- **Detection**: Kubelet stops responding
- **Action**: Kubernetes reschedules pods to healthy nodes
- **Impact**: Minimal (ALB routes to healthy pods)
- **RTO**: ~60 seconds

**Scenario 3: AZ Failure**

- **Detection**: All nodes in AZ unreachable
- **Action**: Pods in other AZs continue serving
- **Impact**: Reduced capacity until scale-up
- **RTO**: ~0 seconds (no downtime)

**Scenario 4: Complete Cluster Failure**

- **Detection**: Manual monitoring
- **Action**: Redeploy to new cluster
- **Impact**: Complete outage
- **RTO**: ~15 minutes (with automation)

**Recovery Steps:**

```bash
# 1. Verify kubectl context
kubectl config current-context

# 2. Apply manifests
kubectl apply -f k8s/deployment.yaml

# 3. Verify deployment
kubectl get pods -n central-services

# 4. Test endpoint
curl https://azdo-mcp.nova.cloud/health
```

## Cost Analysis

### Compute

**EKS Pods:**

```
2 replicas × 0.25 vCPU × $30/vCPU/month = $15/month
2 replicas × 256 MB RAM = 512 MB total ≈ $2/month
Total: ~$17/month
```

**Scaling:**

```
5 replicas (max) × $8.50/replica = $42.50/month max
Average: ~$20/month (with HPA)
```

### Network

**Data Transfer:**

```
Ingress: FREE (AWS doesn't charge for ingress)
Egress: 1 GB/month × $0.09/GB = $0.09/month
Total: ~$0.10/month
```

### Storage

**Container Images:**

```
ECR: 150 MB × $0.10/GB/month = $0.015/month
Negligible
```

### Total Monthly Cost

```
Compute:  $17-42  (depends on load)
Network:  $0.10
Storage:  $0.02
──────────────────
TOTAL:    ~$20/month average, $45/month max
```

**Note**: ALB costs are shared with other services, so not included.

## Future Enhancements

### Phase 2: Advanced Features

1. **Rate Limiting**
   - Prevent abuse
   - Redis-backed (shared across pods)
   - Per-client limits

2. **Request Caching**
   - Cache Azure DevOps responses
   - TTL-based invalidation
   - Redis for shared cache

3. **Multi-Organization Support**
   - Support multiple Azure DevOps orgs
   - Org selection via query parameter
   - Separate PAT tokens per org

4. **WebSocket Fallback**
   - For clients that prefer WebSocket over SSE
   - Bidirectional communication
   - Same backend logic

### Phase 3: Ecosystem

1. **ELK MCP Server**
   - Query Elasticsearch for logs
   - Correlate errors with deployments
   - Same SSE wrapper pattern

2. **PostgreSQL MCP Server**
   - Query Nova databases
   - Transaction analysis
   - Customer impact assessment

3. **Datadog MCP Server**
   - Metrics and dashboards
   - Alert correlation
   - SLO tracking

## References

- [Model Context Protocol Spec](https://spec.modelcontextprotocol.io/)
- [SSE Specification](https://html.spec.whatwg.org/multipage/server-sent-events.html)
- [JSON-RPC 2.0 Spec](https://www.jsonrpc.org/specification)
- [Azure DevOps REST API](https://learn.microsoft.com/en-us/rest/api/azure/devops/)
- [AWS DevOps Agent Docs](https://aws.amazon.com/devops-agent/)
- [Kubernetes Best Practices](https://kubernetes.io/docs/concepts/configuration/overview/)

---

**Document Version**: 1.0
**Last Updated**: 2026-01-06
**Author**: Nova Team, Distelsa
