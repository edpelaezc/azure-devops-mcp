# Azure DevOps MCP - Streamable HTTP Server

This implementation exposes the Azure DevOps MCP server via **Streamable HTTP transport**, allowing remote access without stdio. It implements the MCP 2024-11-05 specification.

## Architecture

```
Client HTTP → Express → StreamableHTTPServerTransport → McpServer (in-memory) → Azure DevOps API
```

**Key benefits over stdio:**

- Single Node.js process handles multiple clients
- No process spawning overhead
- Lower memory footprint
- Network accessible (remote clients)
- Horizontal scaling ready

## Files

| File                  | Description                                                |
| --------------------- | ---------------------------------------------------------- |
| `server-http.js`      | Bootstrap - loads env and sets process.argv before imports |
| `server-http-main.js` | Main server with StreamableHTTPServerTransport             |
| `test-http.js`        | Test client for verification                               |

## Requirements

- Node.js 18+
- Azure DevOps PAT with appropriate permissions
- The parent project must be built (`npm run build` in root)

## Configuration

Create a `.env` file in the project root:

```env
# Azure DevOps Configuration
AZURE_DEVOPS_ORG=your-organization
AZURE_DEVOPS_ORG_URL=https://dev.azure.com/your-organization
AZURE_DEVOPS_DEFAULT_PROJECT=your-project
AZURE_DEVOPS_PAT=your-personal-access-token

# Security
MCP_API_KEY=your-secret-api-key

# Server Configuration
PORT=3000
NODE_ENV=production
```

## Local Development

```bash
# From project root
npm install
npm run build

# Start server
cd streamable-http
node server-http.js
```

## Server Deployment

### Using PM2

```bash
# Install PM2
npm install -g pm2

# Start server
cd streamable-http
pm2 start server-http.js --name azdo-mcp

# View logs
pm2 logs azdo-mcp

# Restart
pm2 restart azdo-mcp
```

### Using Docker

Create `Dockerfile` in `streamable-http/`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm ci --only=production

# Copy built dist and streamable-http server
COPY dist/ ./dist/
COPY streamable-http/ ./streamable-http/

WORKDIR /app/streamable-http

EXPOSE 3000

CMD ["node", "server-http.js"]
```

Build and run:

```bash
# From project root
docker build -f streamable-http/Dockerfile -t azdo-mcp-http .
docker run -p 3000:3000 --env-file .env azdo-mcp-http
```

### Using systemd

Create `/etc/systemd/system/azdo-mcp.service`:

```ini
[Unit]
Description=Azure DevOps MCP Streamable HTTP Server
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/opt/azure-devops-mcp/streamable-http
ExecStart=/usr/bin/node server-http.js
Restart=on-failure
EnvironmentFile=/opt/azure-devops-mcp/.env

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
sudo systemctl enable azdo-mcp
sudo systemctl start azdo-mcp
sudo systemctl status azdo-mcp
```

### Kubernetes

Create `deployment.yaml`:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: azdo-mcp
spec:
  replicas: 2
  selector:
    matchLabels:
      app: azdo-mcp
  template:
    metadata:
      labels:
        app: azdo-mcp
    spec:
      containers:
        - name: azdo-mcp
          image: your-registry/azdo-mcp-http:latest
          ports:
            - containerPort: 3000
          env:
            - name: AZURE_DEVOPS_ORG
              valueFrom:
                secretKeyRef:
                  name: azdo-mcp-secrets
                  key: org
            - name: AZURE_DEVOPS_PAT
              valueFrom:
                secretKeyRef:
                  name: azdo-mcp-secrets
                  key: pat
            - name: MCP_API_KEY
              valueFrom:
                secretKeyRef:
                  name: azdo-mcp-secrets
                  key: api-key
          livenessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 30
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: azdo-mcp
spec:
  selector:
    app: azdo-mcp
  ports:
    - port: 80
      targetPort: 3000
  type: ClusterIP
```

## API Endpoints

| Method | Endpoint  | Description                         |
| ------ | --------- | ----------------------------------- |
| POST   | `/mcp`    | JSON-RPC messages (Streamable HTTP) |
| GET    | `/mcp`    | SSE stream for server notifications |
| DELETE | `/mcp`    | Terminate session                   |
| GET    | `/health` | Health check                        |

## Authentication

All `/mcp` endpoints require Bearer token authentication:

```
Authorization: Bearer <MCP_API_KEY>
```

## MCP Protocol Flow

1. **Initialize** - POST to `/mcp` with `initialize` method
   - Response includes `Mcp-Session-Id` header

2. **Send messages** - POST to `/mcp` with `Mcp-Session-Id` header
   - Responses returned as SSE stream

3. **Terminate** - DELETE to `/mcp` with `Mcp-Session-Id` header

## Testing

```bash
# Start server
node server-http.js

# In another terminal, run test
node test-http.js
```

Expected output:

```
══════════════════════════════════════════════════════════════════════
🧪 Testing Azure DevOps MCP - Streamable HTTP
══════════════════════════════════════════════════════════════════════

📤 Sending: initialize
✅ Initialize response (Status: 200)
🔑 Session: xxxxxxxx...
📡 Initialized - Server ready
   Protocol: 2024-11-05

📤 Sending: tools/list
📋 Tools available: 80
   • core_list_project_teams
   • core_list_projects
   ...

📤 Sending: tools/call (repo_list_repos_by_project)
📦 Repositories from Azure DevOps (N):
...

══════════════════════════════════════════════════════════════════════
✅ All tests passed! Streamable HTTP working correctly.
══════════════════════════════════════════════════════════════════════
```

## Available Tools (80)

The server exposes all Azure DevOps MCP tools across 9 domains:

- **core** (3): Projects, teams, identities
- **work** (7): Iterations, capacity
- **pipelines** (12): Builds, runs, logs
- **repositories** (18): Repos, PRs, branches, commits
- **work-items** (20): Backlogs, work items, queries
- **wiki** (6): Pages, content
- **test-plans** (9): Test plans, suites, cases
- **search** (3): Code, wiki, work item search
- **advanced-security** (2): Security alerts

## Troubleshooting

### Server won't start

1. Ensure `.env` file exists in project root
2. Verify `dist/` folder exists (run `npm run build`)
3. Check Node.js version (18+)

### Authentication errors

1. Verify `MCP_API_KEY` matches in `.env` and client requests
2. Ensure `AZURE_DEVOPS_PAT` has required permissions

### Session not found

1. Include `Mcp-Session-Id` header from initialize response
2. Sessions expire on disconnect - reinitialize if needed
