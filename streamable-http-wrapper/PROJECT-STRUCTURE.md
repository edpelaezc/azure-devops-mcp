# Project Structure

Complete overview of the Nova Azure DevOps MCP SSE Wrapper project.

```
sse-wrapper/
│
├── 📄 README.md                    # Complete documentation (start here!)
├── 📄 QUICKSTART.md                # 15-minute quick start guide
├── 📄 ARCHITECTURE.md              # Deep dive into architecture & design
├── 📄 PROJECT-STRUCTURE.md         # This file
│
├── 🔧 Configuration Files
│   ├── .env.example                # Environment variables template
│   ├── .dockerignore               # Docker build exclusions
│   ├── .gitignore                  # Git exclusions
│   └── package.json                # Node.js dependencies & scripts
│
├── 💻 Application Code
│   ├── server.js                   # Main SSE wrapper server (⭐ CORE)
│   └── test-local.js               # Local testing script
│
├── 🐳 Docker
│   └── Dockerfile                  # Multi-stage production build
│
├── ☸️  Kubernetes (k8s/)
│   ├── deployment.yaml             # Complete K8s manifests (⭐ DEPLOY)
│   └── README.md                   # K8s deployment guide
│
└── 🚀 Scripts (scripts/)
    ├── deploy.sh                   # Automated deployment to EKS
    └── generate-secrets.sh         # Secret generation helper
```

## Key Files Explained

### 📄 Documentation

#### README.md (⭐ START HERE)

The main documentation file covering:

- What the project does
- Why it exists
- How to install locally
- How to deploy to EKS
- How to configure AWS DevOps Agent
- Monitoring and troubleshooting

#### QUICKSTART.md

Get up and running in 15 minutes:

- Prerequisites checklist
- Local development (5 min)
- EKS deployment (5 min)
- AWS DevOps Agent config (5 min)

#### ARCHITECTURE.md

Deep technical documentation:

- System architecture diagrams
- Component interactions
- Security model
- Scalability design
- Protocol details (SSE, stdio, JSON-RPC)
- Cost analysis
- Future roadmap

#### PROJECT-STRUCTURE.md (This File)

Overview of project organization and file purposes.

### 💻 Application Code

#### server.js (⭐ CORE FILE)

The heart of the wrapper. This Express.js server:

- Accepts HTTPS/SSE connections from AWS DevOps Agent
- Validates API key authentication
- Spawns Microsoft's `@azure-devops/mcp` as child process
- Pipes bidirectional communication (SSE ↔ stdio)
- Implements keep-alive for long-lived connections
- Handles graceful shutdown

**Key sections:**

```javascript
Lines 1-10:   Imports and setup
Lines 40-50:  Health check endpoint
Lines 52-70:  API key validation middleware
Lines 72-200: SSE endpoint (main logic) ⭐
Lines 202-230: Error handling
Lines 232-260: Server startup and shutdown
```

#### test-local.js

Automated test suite for local development:

- Test 1: Health check (GET /health)
- Test 2: Reject unauthenticated requests
- Test 3: Reject invalid API keys
- Test 4: Accept valid auth + MCP initialize

Run with: `npm test`

### 🔧 Configuration Files

#### package.json

Node.js project configuration:

- Dependencies: `express`, `@azure-devops/mcp`
- Scripts: `start`, `dev`, `test`
- Engine: Node.js 20+

#### .env.example

Template for environment variables:

```bash
AZURE_DEVOPS_ORG=distelsa
AZURE_DEVOPS_PAT=your-pat
MCP_API_KEY=your-key
PORT=3000
```

Copy to `.env` and fill in values for local development.

#### .dockerignore

Excludes from Docker build:

- node_modules (reinstalled in container)
- .env files (use K8s secrets in production)
- Documentation files (not needed at runtime)

#### .gitignore

Excludes from Git:

- node_modules
- .env (contains secrets!)
- logs
- IDE files

### 🐳 Docker

#### Dockerfile

Multi-stage production-ready build:

**Stage 1: Builder**

- Node.js 20 Alpine base
- Install build dependencies
- Prepare for production build

**Stage 2: Production**

- Minimal Alpine image
- Copy only production dependencies
- Create non-root user (security)
- Health check configuration
- Optimized for size (~150MB vs ~800MB)

Build with: `docker build -t nova/azdo-mcp-wrapper .`

### ☸️ Kubernetes

#### k8s/deployment.yaml (⭐ PRODUCTION DEPLOY)

Complete Kubernetes configuration in one file:

**Resources:**

1. **Namespace** (`central-services`)
   - Logical grouping for all Nova central services

2. **Secret** (`azdo-mcp-secret`)
   - PAT token (Azure DevOps authentication)
   - API key (AWS DevOps Agent authentication)
   - ⚠️ MUST replace placeholders before deploying

3. **ConfigMap** (`azdo-mcp-config`)
   - Environment variables
   - Organization, project, URLs

4. **Deployment** (`azdo-mcp-wrapper`)
   - 2 replicas (HA)
   - RollingUpdate strategy
   - Health probes (liveness + readiness)
   - Resource requests/limits
   - Security context (non-root)

5. **Service** (`azdo-mcp-wrapper`)
   - ClusterIP type
   - Internal load balancing
   - Port 80 → 3000

6. **Ingress** (`azdo-mcp-wrapper`)
   - AWS ALB controller
   - HTTPS with ACM certificate
   - Public internet-facing
   - Health checks

7. **HorizontalPodAutoscaler** (`azdo-mcp-wrapper`)
   - Min 2, Max 5 replicas
   - Scale on CPU/Memory
   - Aggressive scale-up, gradual scale-down

#### k8s/README.md

Kubernetes-specific documentation:

- Deployment checklist
- Configuration steps
- Verification commands
- Common operations (scale, restart, rollback)
- Troubleshooting guide
- Security best practices

### 🚀 Scripts

#### scripts/deploy.sh

Automated deployment to EKS. This bash script:

1. Checks prerequisites (AWS CLI, kubectl, Docker)
2. Confirms target cluster
3. Builds Docker image
4. Tags for ECR
5. Pushes to ECR
6. Applies K8s manifests
7. Waits for deployment
8. Displays status and next steps

Run with: `./scripts/deploy.sh`

#### scripts/generate-secrets.sh

Interactive secret generation. This script:

1. Generates random API key (openssl)
2. Guides you to create Azure DevOps PAT
3. Creates `.env` for local development
4. Creates `k8s/secrets.yaml` for K8s deployment
5. Displays security warnings

Run with: `./scripts/generate-secrets.sh`

## File Dependencies

```
Deployment Flow:
───────────────

1. Developer writes code
   └── server.js (application logic)

2. Local testing
   ├── .env (secrets)
   ├── package.json (dependencies)
   └── test-local.js (tests)

3. Containerization
   ├── Dockerfile (build instructions)
   ├── .dockerignore (exclusions)
   └── server.js + package.json → Docker image

4. Kubernetes deployment
   ├── k8s/deployment.yaml (K8s resources)
   ├── k8s/secrets.yaml (sensitive data)
   └── Docker image → Running pods

5. Scripts automate 3+4
   ├── scripts/generate-secrets.sh → k8s/secrets.yaml + .env
   └── scripts/deploy.sh → Build + Push + Deploy
```

## Critical Files (Don't Lose These!)

### ⚠️ Must Be in Git

- ✅ server.js
- ✅ package.json
- ✅ Dockerfile
- ✅ k8s/deployment.yaml (with placeholders)
- ✅ All documentation
- ✅ All scripts

### ⚠️ NEVER in Git (Contains Secrets!)

- ❌ .env
- ❌ k8s/secrets.yaml (generated version with real secrets)
- ❌ node_modules

### ⚠️ Store Safely (Password Manager)

- 🔐 Azure DevOps PAT token
- 🔐 MCP API key
- 🔐 AWS Account ID
- 🔐 ACM Certificate ARN

## Workflow: Making Changes

### 1. Code Changes

```bash
# Edit server.js
vim server.js

# Test locally
npm start
# In another terminal:
npm test

# Commit
git add server.js
git commit -m "feat: add new feature"
git push
```

### 2. Deploy Changes

```bash
# Automated deployment
./scripts/deploy.sh

# Or manual:
docker build -t nova/azdo-mcp-wrapper:v1.1.0 .
docker tag nova/azdo-mcp-wrapper:v1.1.0 $ECR_REPO:v1.1.0
docker push $ECR_REPO:v1.1.0
kubectl set image deployment/azdo-mcp-wrapper \
  mcp-wrapper=$ECR_REPO:v1.1.0 \
  -n central-services
```

### 3. Configuration Changes

```bash
# Edit K8s manifests
vim k8s/deployment.yaml

# Apply changes
kubectl apply -f k8s/deployment.yaml

# Restart pods to pick up changes
kubectl rollout restart deployment/azdo-mcp-wrapper -n central-services
```

### 4. Secret Rotation

```bash
# Generate new secrets
./scripts/generate-secrets.sh

# Update K8s secret
kubectl delete secret azdo-mcp-secret -n central-services
kubectl apply -f k8s/secrets.yaml

# Restart pods
kubectl rollout restart deployment/azdo-mcp-wrapper -n central-services
```

## npm Scripts

Defined in `package.json`:

```bash
npm start      # Start server (production mode)
npm run dev    # Start with auto-reload (development)
npm test       # Run automated tests
```

## Environment Variables

All required environment variables:

| Variable                       | Required | Default      | Description                    |
| ------------------------------ | -------- | ------------ | ------------------------------ |
| `AZURE_DEVOPS_ORG`             | Yes      | `distelsa`   | Azure DevOps organization name |
| `AZURE_DEVOPS_ORG_URL`         | No       | Computed     | Full org URL                   |
| `AZURE_DEVOPS_DEFAULT_PROJECT` | No       | `Nova`       | Default project                |
| `AZURE_DEVOPS_PAT`             | Yes      | -            | Personal Access Token          |
| `MCP_API_KEY`                  | Yes      | -            | API key for AWS DevOps Agent   |
| `PORT`                         | No       | `3000`       | Server port                    |
| `NODE_ENV`                     | No       | `production` | Environment (dev/prod)         |

## Size Metrics

```
Source Code:
  server.js:           ~350 lines (~10 KB)
  test-local.js:       ~250 lines (~8 KB)
  TOTAL CODE:          ~600 lines

Docker Image:
  Base (Alpine):       ~50 MB
  Dependencies:        ~80 MB
  Application:         ~10 KB
  TOTAL IMAGE:         ~150 MB

Kubernetes:
  Manifest (YAML):     ~250 lines (~8 KB)
  Deployed pods:       2-5 replicas
  Memory per pod:      256-512 MB
  CPU per pod:         250-500m

Documentation:
  README.md:           ~500 lines
  ARCHITECTURE.md:     ~1000 lines
  QUICKSTART.md:       ~300 lines
  Other docs:          ~500 lines
  TOTAL DOCS:          ~2300 lines
```

## Development Tools

### Recommended VS Code Extensions

- Docker
- Kubernetes
- YAML
- ESLint
- Prettier

### Recommended CLI Tools

- `kubectl` - Kubernetes CLI
- `aws` - AWS CLI
- `docker` - Container runtime
- `jq` - JSON processing (for testing)
- `curl` - HTTP testing

## Next Steps

After reviewing this structure:

1. **Start Local Development**
   - Follow [QUICKSTART.md](./QUICKSTART.md)

2. **Understand Architecture**
   - Read [ARCHITECTURE.md](./ARCHITECTURE.md)

3. **Deploy to Production**
   - Use [scripts/deploy.sh](./scripts/deploy.sh)
   - Reference [k8s/README.md](./k8s/README.md)

4. **Integrate with AWS DevOps Agent**
   - Follow configuration section in [README.md](./README.md)

## Support

Questions? Contact:

- **Nova Team**: nova-team@distelsa.com
- **Lead Developer**: eduardo@distelsa.com
- **Project**: Nova - Multi-tenant Loyalty Platform

---

**Last Updated**: 2026-01-06
**Project Version**: 1.0.0
**Maintainer**: Distelsa Nova Team
