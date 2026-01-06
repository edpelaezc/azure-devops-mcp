# Testing with Postman

This guide shows you how to test the Azure DevOps MCP SSE Wrapper using Postman.

## Prerequisites

1. **Postman installed** - Download from [postman.com](https://www.postman.com/downloads/)
2. **Wrapper running locally** - Run `npm start` in the `sse-wrapper` directory
3. **Valid credentials** - Ensure your `.env` file has valid Azure DevOps credentials

## Quick Start

### 1. Import Collection

In Postman:

1. Click **Import** button (top left)
2. Select **Files** tab
3. Choose `Azure-DevOps-MCP-Wrapper.postman_collection.json`
4. Click **Import**

### 2. Import Environment

1. Click **Import** again
2. Select `Azure-DevOps-MCP-Local.postman_environment.json`
3. Click **Import**

### 3. Activate Environment

1. Click the environment dropdown (top right)
2. Select **Azure DevOps MCP - Local**

### 4. Start Testing!

The collection includes 9 requests organized in order:

## Test Requests

### 1. Health Check ✅

**Purpose:** Verify the wrapper is running

**Expected Response:**

```json
{
  "status": "healthy",
  "service": "azdo-mcp-wrapper",
  "organization": "grupodistelsa",
  "project": "NOVA",
  "activeConnections": 0
}
```

**Status:** Should return `200 OK`

---

### 2. MCP - Unauthenticated (Should Fail) ❌

**Purpose:** Test authentication is working

**Expected Response:**

```json
{
  "error": "Missing Authorization header"
}
```

**Status:** Should return `401 Unauthorized`

---

### 3. MCP - Invalid API Key (Should Fail) ❌

**Purpose:** Test API key validation

**Expected Response:**

```json
{
  "error": "Invalid API key"
}
```

**Status:** Should return `403 Forbidden`

---

### 4. MCP - Initialize ✅

**Purpose:** Establish MCP connection

**Expected Response (SSE format):**

```
data: {"result":{"protocolVersion":"2024-11-05","capabilities":{"tools":{"listChanged":true}},"serverInfo":{"name":"Azure DevOps MCP Server","version":"2.2.2"}},"jsonrpc":"2.0","id":1}

data: {"authentication":"interactive","domains":["all"],"level":"info","message":"Starting Azure DevOps MCP Server"...}
```

**Status:** `200 OK` with streaming response

**Note:** Keep the request open - it's an SSE connection!

---

### 5. MCP - List All Tools ✅

**Purpose:** Get all available MCP tools

**What it does:**

1. Initializes the connection
2. Requests the list of tools

**Expected Response:**
You'll receive SSE events with JSON containing all available tools grouped by domains:

- `work-items_*` - Work item operations
- `repositories_*` - Git repository operations
- `pipelines_*` - Build and pipeline operations
- `core_*` - Core Azure DevOps operations
- `wiki_*` - Wiki operations
- And more...

---

### 6. MCP - Get Work Items ✅

**Purpose:** Retrieve actual work items from Azure DevOps

**What it does:**

1. Initializes connection
2. Calls `work-items_getWorkItems` with `top=5`

**Expected Response:**
SSE stream with work items data including ID, title, state, type, etc.

---

### 7. MCP - Get Recent Builds ✅

**Purpose:** Get recent pipeline builds

**What it does:**

1. Initializes connection
2. Calls `pipelines_getBuilds` with `top=5`

**Expected Response:**
Build information including status, start time, finish time, results, etc.

---

### 8. MCP - Get Repositories ✅

**Purpose:** List all Git repositories

**What it does:**

1. Initializes connection
2. Calls `repositories_getRepositories`

**Expected Response:**
List of repositories with names, IDs, URLs, default branches, etc.

---

### 9. MCP - Search Work Items ✅

**Purpose:** Search for bugs using WIQL

**What it does:**

1. Initializes connection
2. Executes WIQL query to find Bug work items

**Expected Response:**
Bugs sorted by creation date with ID, title, and state

---

## Understanding SSE Responses

All MCP requests (except Health Check) use **Server-Sent Events (SSE)**.

### SSE Response Format

```
data: {"jsonrpc":"2.0","id":1,"result":{...}}

data: {"jsonrpc":"2.0","method":"notifications/message","params":{...}}
```

- Each line starting with `data:` is an SSE event
- The content after `data:` is JSON-RPC 2.0 format
- Blank lines separate events

### In Postman

Postman will show the response as streaming text. You'll see:

- Initial connection established (200 OK)
- Multiple `data:` lines as events arrive
- The connection stays open (SSE is long-lived)

**Tip:** Copy the JSON after `data:` and paste into a JSON formatter for better readability.

---

## Troubleshooting

### Request hangs / no response

**Problem:** The wrapper server is not running

**Solution:**

```bash
cd sse-wrapper
npm start
```

### 401 Unauthorized

**Problem:** API key not being sent or environment not active

**Solution:**

1. Ensure "Azure DevOps MCP - Local" environment is selected (top right)
2. Check the Authorization header has `Bearer {{api_key}}`

### 403 Forbidden

**Problem:** Wrong API key

**Solution:**

1. Check `.env` file has correct `MCP_API_KEY`
2. Update environment variable if needed:
   - Click environment dropdown
   - Click eye icon next to "Azure DevOps MCP - Local"
   - Update `api_key` value

### Empty responses from tools

**Problem:** Invalid Azure DevOps credentials or no data

**Solution:**

1. Verify `.env` has valid `AZURE_DEVOPS_PAT`
2. Check PAT has required scopes (Work Items: Read, etc.)
3. Verify organization and project exist

---

## Advanced Testing

### Custom Tool Calls

You can call any MCP tool by sending:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"postman","version":"1.0.0"}}}
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"TOOL_NAME","arguments":{...}}}
```

Replace `TOOL_NAME` with any tool from the `tools/list` response.

### Testing from Production

To test against a deployed instance:

1. Duplicate the environment
2. Rename to "Azure DevOps MCP - Production"
3. Change `base_url` to your production URL (e.g., `https://azdo-mcp.nova.cloud`)
4. Update `api_key` if different
5. Select the new environment

---

## Next Steps

After testing with Postman:

1. **Build Docker image:**

   ```bash
   docker build -t azdo-mcp-wrapper .
   ```

2. **Deploy to Kubernetes:**

   ```bash
   ./scripts/deploy.sh
   ```

3. **Configure your AI Agent** to use the wrapper endpoint

4. **Monitor logs:**
   ```bash
   npm start  # watch console output
   ```

---

## Related Documentation

- [QUICKSTART.md](./QUICKSTART.md) - Complete setup guide
- [README.md](./README.md) - Full documentation
- [ARCHITECTURE.md](./ARCHITECTURE.md) - How it works

---

**Happy Testing!** 🚀
