# MCP Template Implementation Guide

**Purpose:** Step-by-step technical checklist for turning the `_template` into a production MCP server.

**Context:** This template provides dual-runtime (Node.js + Cloudflare Workers) OAuth-ready infrastructure from a single codebase. Follow this guide to implement your specific integration (Gmail, Linear, GitHub, etc.).

---

## Phase 1: Project Setup & Configuration

### 1.1 Initialize Your Project

```bash
# Copy template to your project name
cp -r tools/_template tools/my-mcp-server
cd tools/my-mcp-server

# Initialize git (if not already)
git init
git add .
git commit -m "Initial commit from MCP template"

# Install dependencies
bun install
```

### 1.2 Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Generate encryption key (base64url, 32 bytes)
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
# Add to .env as RS_TOKENS_ENC_KEY
```

### 1.3 Update Package Metadata

Edit `package.json`:

- Change `name` to your server name (e.g., `gmail-mcp`)
- Update `description`
- Add provider SDK dependency if needed (e.g., `@linear/sdk`)

### 1.4 Update MCP Metadata

Edit `.env`:

```env
MCP_TITLE="Gmail"
MCP_VERSION="1.0.0"
MCP_INSTRUCTIONS="Use these tools to manage Gmail inbox, threads, and drafts."
```

---

## Phase 2: OAuth Provider Configuration

### 2.1 Identify Your OAuth Provider

Determine which OAuth service you're integrating with.

Requirements:

- Provider must support OAuth 2.0/2.1 with authorization and token endpoints
- You must have registered application credentials (client ID/secret)
- Identify required OAuth scopes for your integration

### 2.2 Register OAuth Application

**Generic steps (consult your provider's documentation):**

1. Access your OAuth provider's developer portal/console
2. Create a new OAuth application/client
3. Configure authorized redirect URIs:
   - Development: `http://localhost:3001/oauth/callback`
   - Production (Workers): `https://your-worker.workers.dev/oauth/callback`
4. Note the provider's authorization and token endpoint URLs
5. Copy your application's Client ID and Client Secret
6. Identify required OAuth scopes

### 2.3 Configure Provider in .env

**Important:** Use generic `PROVIDER_*` names, not service-specific names. This keeps the template portable.

```env
# Auth strategy
AUTH_STRATEGY=oauth
AUTH_ENABLED=true
AUTH_REQUIRE_RS=true
AUTH_ALLOW_DIRECT_BEARER=false

# Provider endpoints
PROVIDER_CLIENT_ID=your-client-id
PROVIDER_CLIENT_SECRET=your-client-secret
PROVIDER_ACCOUNTS_URL=https://accounts.google.com

# OAuth endpoints
OAUTH_AUTHORIZATION_URL=https://accounts.google.com/o/oauth2/v2/auth
OAUTH_TOKEN_URL=https://oauth2.googleapis.com/token
OAUTH_REVOCATION_URL=https://oauth2.googleapis.com/revoke

# Scopes (space-separated)
OAUTH_SCOPES=https://www.googleapis.com/auth/gmail.readonly

# Extra auth params (provider-specific, e.g. Google needs offline access)
# OAUTH_EXTRA_AUTH_PARAMS=access_type=offline&prompt=consent

# Callback URI (must match registered redirect URI)
OAUTH_REDIRECT_URI=http://localhost:3001/oauth/callback

# Encryption
RS_TOKENS_ENC_KEY=your-base64url-32-byte-key
```

### 2.4 Non-OAuth Auth Strategies

If your provider uses API keys instead of OAuth, set the strategy accordingly:

```env
# API key strategy
AUTH_STRATEGY=api_key
API_KEY=your-api-key
API_KEY_HEADER=x-api-key

# Bearer token strategy
AUTH_STRATEGY=bearer
BEARER_TOKEN=your-static-token

# No auth
AUTH_STRATEGY=none
```

### 2.5 Test OAuth Server

```bash
# Start servers
bun dev

# Verify MCP endpoint
curl http://localhost:3000/health

# Verify OAuth metadata (runs on PORT+1 when AUTH_ENABLED=true)
curl http://localhost:3001/.well-known/oauth-authorization-server

# Should return JSON with authorization_endpoint, token_endpoint, etc.
# Verify code_challenge_methods_supported includes "S256"
```

---

## Phase 3: Tool Implementation

### 3.1 Define Tool Requirements

**Document before coding:**

- What actions does the tool perform?
- What inputs does it need?
- What upstream API endpoints does it call?
- What scopes are required?
- How should responses be formatted for LLMs?

### 3.2 Create Tool Metadata

Edit `src/config/metadata.ts`:

```typescript
export const toolsMetadata = {
  search_threads: {
    name: 'search_threads',
    title: 'Search Threads',
    description: `Search Gmail threads by query and/or labels.

Returns subject, sender, date, labels, message count, and web links.
Use get_thread to read full message bodies.`,
  },
} as const satisfies Record<string, ToolMetadata>;

export const serverMetadata = {
  title: 'Gmail',
  instructions: 'Start with inbox_overview for account stats and recent emails.',
} as const;
```

### 3.3 Define Input/Output Schemas

Create `src/schemas/inputs.ts` and `src/schemas/outputs.ts`:

```typescript
// src/schemas/inputs.ts
import { z } from 'zod';

export const SearchThreadsInputSchema = z.object({
  query: z.string().optional().describe('Gmail search query (e.g., "from:someone is:unread")'),
  labelIds: z.array(z.string()).optional().describe('Filter by label IDs'),
  limit: z.number().int().min(1).max(100).optional().describe('Max results. Default: 25.'),
  cursor: z.string().optional().describe('Pagination cursor from previous response.'),
});

// src/schemas/outputs.ts
import { z } from 'zod';

export const SearchThreadsOutputSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    subject: z.string().optional(),
    from: z.string().optional(),
  })),
  pagination: z.object({
    hasMore: z.boolean(),
    nextCursor: z.string().optional(),
  }),
});
```

### 3.4 Create Service Client

Create `src/services/my-provider.ts` — a client that takes an access token and calls the upstream API:

```typescript
import type { ToolContext } from '../shared/tools/types.js';

const API_BASE = 'https://www.googleapis.com/gmail/v1';

export function getAccessToken(context?: ToolContext): string | undefined {
  return context?.providerToken ?? context?.provider?.accessToken;
}

export class MyProviderClient {
  private accessToken: string;

  constructor(accessToken: string) {
    this.accessToken = accessToken;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as T;
  }

  async listItems(): Promise<{ items: unknown[] }> {
    return this.request('/users/me/items');
  }
}
```

For SDK-based providers (e.g., Linear), create a factory that wraps the SDK:

```typescript
import { LinearClient } from '@linear/sdk';
import type { ToolContext } from '../shared/tools/types.js';

export async function getLinearClient(context?: ToolContext): Promise<LinearClient> {
  const token = context?.providerToken ?? context?.provider?.accessToken;
  if (!token) throw new Error('OAuth required: complete the OAuth flow first');
  return new LinearClient({ accessToken: token });
}
```

### 3.5 Implement Tool Handler

Create `src/shared/tools/<provider>/my-tool.ts`:

```typescript
import { z } from 'zod';
import { toolsMetadata } from '../../../config/metadata.js';
import { SearchThreadsInputSchema } from '../../../schemas/inputs.js';
import { SearchThreadsOutputSchema } from '../../../schemas/outputs.js';
import { MyProviderClient, getAccessToken } from '../../../services/my-provider.js';
import { defineTool, type ToolContext, type ToolResult } from '../types.js';

export const searchThreadsTool = defineTool({
  name: toolsMetadata.search_threads.name,
  title: toolsMetadata.search_threads.title,
  description: toolsMetadata.search_threads.description,
  inputSchema: SearchThreadsInputSchema,
  outputSchema: SearchThreadsOutputSchema.shape,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    openWorldHint: true,
  },

  handler: async (args, context: ToolContext): Promise<ToolResult> => {
    // 1. Get provider token from context
    const token = getAccessToken(context);
    if (!token) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Authentication required. Please sign in.' }],
      };
    }

    // 2. Check cancellation
    if (context.signal?.aborted) {
      return {
        isError: true,
        content: [{ type: 'text', text: 'Operation cancelled' }],
      };
    }

    try {
      // 3. Call upstream API
      const client = new MyProviderClient(token);
      const result = await client.listItems();

      // 4. Build structured output
      const structured = SearchThreadsOutputSchema.parse({
        items: result.items,
        pagination: { hasMore: false },
      });

      // 5. Return both text (for LLM) and structured content
      return {
        content: [{ type: 'text', text: `Found ${result.items.length} items.` }],
        structuredContent: structured,
      };
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed: ${(error as Error).message}` }],
      };
    }
  },
});
```

### 3.6 Create Tool Index

Create `src/shared/tools/<provider>/index.ts`:

```typescript
export { searchThreadsTool } from './search-threads.js';
export { getProfileTool } from './get-profile.js';
// ... export all tools
```

### 3.7 Register Tools in Registry

Edit `src/shared/tools/registry.ts` — replace template tools with yours:

```typescript
import {
  searchThreadsTool,
  getProfileTool,
} from './gmail/index.js';
import type { ToolContext, ToolResult } from './types.js';

export type { SharedToolDefinition, ToolContext, ToolResult } from './types.js';
export { defineTool } from './types.js';

export interface RegisteredTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: ZodObject<ZodRawShape>;
  outputSchema?: ZodRawShape;
  annotations?: Record<string, unknown>;
  handler: (args: Record<string, unknown>, context: ToolContext) => Promise<ToolResult>;
}

export const sharedTools: RegisteredTool[] = [
  getProfileTool as unknown as RegisteredTool,
  searchThreadsTool as unknown as RegisteredTool,
];

// ... keep getSharedTool(), getSharedToolNames(), executeSharedTool() as-is
```

### 3.8 Test Tool

```bash
# Start server
bun dev

# Test with curl
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_RS_TOKEN" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/call",
    "params": {
      "name": "search_threads",
      "arguments": { "query": "is:unread", "limit": 5 }
    }
  }'
```

---

## Phase 4: Production Hardening

### 4.1 Error Handling Checklist

- [ ] All tool handlers use `safeParse()` or Zod validation for input
- [ ] Network errors return LLM-friendly messages (not stack traces)
- [ ] Token expiration handled gracefully (return auth error, not 500)
- [ ] Upstream API errors include actionable guidance
- [ ] Cancellation checked for long-running operations (`context.signal?.aborted`)

### 4.2 Security Checklist

- [ ] `AUTH_REQUIRE_RS=true` in production
- [ ] `RS_TOKENS_ENC_KEY` is a strong random base64url key
- [ ] `PROVIDER_CLIENT_SECRET` stored as env var or wrangler secret (never in code)
- [ ] Redirect URIs use HTTPS in production
- [ ] `OAUTH_REDIRECT_ALLOWLIST` configured (explicit URIs, not wildcards)
- [ ] Input validation prevents injection
- [ ] Logs sanitized (no tokens, no PII)
- [ ] Rate limiting configured (`RPS_LIMIT`, `CONCURRENCY_LIMIT`)

### 4.3 Performance Optimization

- [ ] Token store initialized once via `initializeStorage()` (not per-request)
- [ ] Service client reused or cached per token (see Linear's `clientCache`)
- [ ] Large responses paginated (cursor-based)
- [ ] Caching implemented for expensive or repeated lookups

### 4.4 Observability

```typescript
logger.info('tool_name', {
  message: 'Action performed',
  sessionId: context.sessionId,
  duration: Date.now() - startTime,
  success: true,
});
```

Track:

- Request latency
- Upstream API response times
- Error rates by tool
- Token refresh rates

---

## Phase 5: Deployment

### 5.1 Local/VPS Deployment (Node.js)

**1. Environment Configuration:**

```env
NODE_ENV=production
PORT=3000
AUTH_STRATEGY=oauth
AUTH_ENABLED=true
AUTH_REQUIRE_RS=true

PROVIDER_CLIENT_ID=production-client-id
PROVIDER_CLIENT_SECRET=production-client-secret
PROVIDER_ACCOUNTS_URL=https://accounts.google.com
OAUTH_AUTHORIZATION_URL=https://accounts.google.com/o/oauth2/v2/auth
OAUTH_TOKEN_URL=https://oauth2.googleapis.com/token
OAUTH_SCOPES=https://www.googleapis.com/auth/gmail.readonly
OAUTH_REDIRECT_URI=https://your-domain.com/oauth/callback

RS_TOKENS_ENC_KEY=your-base64url-32-byte-key
LOG_LEVEL=info
```

The auth app auto-starts on `PORT + 1` (3001) when `AUTH_ENABLED=true`.

**2. Build:**

```bash
bun run build
```

**3. Deploy:**

- **PM2:** `pm2 start dist/index.js --name mcp-server`
- **systemd:** Create service file
- **Docker:** Node 20+, copy dist/, set ENV vars

**4. Reverse Proxy (Nginx/Caddy):**

```nginx
# MCP endpoint (port 3000)
location /mcp {
  proxy_pass http://localhost:3000;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
}

# OAuth endpoints (port 3001)
location /authorize {
  proxy_pass http://localhost:3001;
}
location /token {
  proxy_pass http://localhost:3001;
}
location /oauth/callback {
  proxy_pass http://localhost:3001;
}
location /.well-known/ {
  proxy_pass http://localhost:3001;
}
```

### 5.2 Cloudflare Workers Deployment

**1. Create KV Namespace:**

```bash
wrangler kv:namespace create TOKENS
# Copy the ID to wrangler.toml
```

**2. Configure wrangler.toml:**

```toml
name = "my-mcp-server"
main = "src/worker.ts"
compatibility_date = "2025-06-18"
workers_dev = true
compatibility_flags = ["nodejs_compat"]

[vars]
MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_TITLE = "My MCP Server"
MCP_VERSION = "1.0.0"

AUTH_ENABLED = "true"
AUTH_STRATEGY = "oauth"
AUTH_REQUIRE_RS = "true"
AUTH_ALLOW_DIRECT_BEARER = "false"

PROVIDER_ACCOUNTS_URL = "https://accounts.google.com"
OAUTH_AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth"
OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token"
OAUTH_SCOPES = "https://www.googleapis.com/auth/gmail.readonly"
OAUTH_REDIRECT_URI = "https://my-mcp-server.workers.dev/oauth/callback"
OAUTH_REDIRECT_ALLOW_ALL = "false"
OAUTH_REDIRECT_ALLOWLIST = "https://my-mcp-server.workers.dev/oauth/callback"

NODE_ENV = "production"

# DO NOT store secrets in [vars]!

[[kv_namespaces]]
binding = "TOKENS"
id = "abc123..."  # From step 1
```

**3. Set Secrets:**

```bash
wrangler secret put PROVIDER_CLIENT_ID
wrangler secret put PROVIDER_CLIENT_SECRET
wrangler secret put RS_TOKENS_ENC_KEY
# Paste the base64url key generated with:
# openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'
```

**4. Deploy:**

```bash
bun run deploy

# Test deployment
curl https://my-mcp-server.workers.dev/health
```

---

## Phase 6: Testing & Validation

### 6.1 OAuth Flow Test

**Manual flow:**

1. Open: `http://localhost:3001/authorize?response_type=code&client_id=test&redirect_uri=http://localhost:3000/callback&code_challenge=CHALLENGE&code_challenge_method=S256`
2. Should redirect to provider login
3. After authorization, should redirect back with `code` parameter
4. Exchange code for tokens at `POST /token`

### 6.2 Token Mapping Verification

```bash
# Get RS token from OAuth flow
RS_TOKEN="your-rs-token"

# Call MCP with RS token
curl -X POST http://localhost:3000/mcp \
  -H "Authorization: Bearer $RS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Should return your registered tools
```

### 6.3 Security Testing

- [ ] Test with invalid RS token → Should return 401/404
- [ ] Test with expired RS token → Should return 401/404
- [ ] Test without auth when `AUTH_REQUIRE_RS=true` → Should return 401 with WWW-Authenticate
- [ ] Test redirect URI not in allowlist → Should reject
- [ ] Test PKCE with wrong verifier → Should return `invalid_grant`
- [ ] Test token refresh with valid refresh token → Should issue new access token
- [ ] Verify provider tokens never appear in responses to clients
- [ ] Verify RS tokens cannot be used with upstream APIs directly

### 6.4 Load Testing (Optional)

```bash
hey -n 1000 -c 10 -m POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
  http://localhost:3000/mcp

# Check for:
# - No memory leaks (token store cleanup working)
# - Consistent latency
# - No errors under load
```

---

## Phase 7: Cleanup & Finalization

### 7.1 Remove Template Examples

```bash
# Remove example tools
rm src/shared/tools/echo.ts
rm src/shared/tools/health.ts

# Remove example prompts (if not needed)
rm -rf src/shared/prompts/

# Remove example resources (if not needed)
rm -rf src/shared/resources/

# Update src/shared/tools/registry.ts to remove echo/health imports
# Update src/core/mcp.ts if you removed prompts/resources
```

### 7.2 Update Documentation

Edit `README.md`:

- Replace "Template" with your server name
- Document your specific tools
- Add provider-specific setup instructions
- Include example requests
- Add troubleshooting section

### 7.3 Verify .gitignore

Ensure `.gitignore` includes:

```
.env
.data/
node_modules/
dist/
.wrangler/
*.log
```

### 7.4 Security Audit

```bash
# Check for secrets in code
rg -i "password|secret|token" src/ --glob '!*.d.ts'

# Should NOT find:
# - Hardcoded API keys
# - Hardcoded passwords
# - Real token values
#
# All secrets must come from environment variables
```

---

## Phase 8: Advanced Features (Optional)

### 8.1 Token Refresh

The template handles provider token refresh automatically in `shared/oauth/flow.ts` and `shared/oauth/refresh.ts`. When a client uses its RS refresh token:

1. Template checks if the provider token is expired/expiring (1-minute buffer)
2. If so, it refreshes the provider token using `refreshProviderToken()`
3. Updates the RS → provider mapping in the token store
4. Returns a new RS access token to the client

Ensure your provider issues refresh tokens (e.g., Google requires `access_type=offline&prompt=consent` via `OAUTH_EXTRA_AUTH_PARAMS`).

### 8.2 Progress Notifications

For long-running tools (>5 seconds), use the progress token from context metadata. Progress notifications are supported in the Node.js runtime via `StreamableHTTPServerTransport`:

```typescript
handler: async (args, context: ToolContext): Promise<ToolResult> => {
  const progressToken = context.meta?.progressToken;

  // Tool can check progressToken to decide whether to report progress
  // Actual progress sending depends on having access to the server instance

  // For simple cases, just check cancellation periodically:
  if (context.signal?.aborted) {
    return { isError: true, content: [{ type: 'text', text: 'Cancelled' }] };
  }

  // ... do work ...
};
```

### 8.3 Resource Subscriptions

For dynamic resources that update:

```typescript
// In src/shared/resources/ or src/resources/
server.registerResource(
  'current-status',
  'myapp://status',
  { description: 'Current status' },
  async () => {
    return {
      contents: [{
        uri: 'myapp://status',
        text: JSON.stringify({ status: 'active' }),
      }],
    };
  },
);
```

### 8.4 Sampling (Server→Client LLM Requests)

Sampling is available in the Node.js runtime only (requires persistent SSE stream). The template provides utilities in `shared/utils/sampling.ts`:

```typescript
import { requestTextCompletion, clientSupportsSampling } from '../utils/sampling.js';

// In a tool handler (Node.js only):
const canSample = clientSupportsSampling(serverInstance);
if (canSample) {
  const analysis = await requestTextCompletion(
    serverInstance,
    'Analyze this data: ...',
    { maxTokens: 500 },
  );
}
```

### 8.5 Elicitation (User Input Prompts)

Elicitation is available in the Node.js runtime only. See `shared/utils/elicitation.ts` for helpers to request structured user input during tool execution.

---

## Phase 9: Monitoring & Maintenance

### 9.1 Health Monitoring

The template provides a `/health` endpoint on both runtimes. Use it for uptime monitoring.

### 9.2 Token Cleanup

**Node.js:**
- `FileTokenStore` auto-cleans expired tokens periodically
- `MemorySessionStore` auto-cleans expired sessions
- Graceful shutdown flushes tokens to disk and stops intervals

**Workers:**
- `KvTokenStore` uses KV TTLs for automatic expiration
- `KvSessionStore` expires sessions after TTL (default: 24h)
- RS token mappings persist until revoked

### 9.3 Key Rotation

```bash
# Generate new encryption key
openssl rand -base64 32 | tr -d '=' | tr '+/' '-_'

# For Node.js: update RS_TOKENS_ENC_KEY in .env
# For Workers: wrangler secret put RS_TOKENS_ENC_KEY

# Old tokens will fail to decrypt — users must re-authorize
```

---

## Troubleshooting

### "OAuth not configured" error

- Verify `PROVIDER_CLIENT_ID` and `PROVIDER_CLIENT_SECRET` are set
- Check `PROVIDER_ACCOUNTS_URL`, `OAUTH_AUTHORIZATION_URL`, `OAUTH_TOKEN_URL`

### 401 Unauthorized on /mcp

- Verify `AUTH_ENABLED=true` and `AUTH_STRATEGY=oauth`
- Check RS token is valid (not expired)
- Ensure token store has the RS → provider mapping

### "Invalid or expired token" when calling provider API

- RS token valid but provider token expired
- Check if provider issues refresh tokens (Google needs `access_type=offline`)
- Set `OAUTH_EXTRA_AUTH_PARAMS` if needed

### Workers deployment fails

- Verify KV namespace ID is correct in `wrangler.toml`
- Check all secrets are set (`wrangler secret list`)
- Ensure `main = "src/worker.ts"` in wrangler.toml
- Ensure `compatibility_flags = ["nodejs_compat"]`

### PKCE validation fails

- Ensure client uses S256 method (not plain)
- Verify code_verifier matches code_challenge
- Check transaction is still active (not expired)

---

## Checklist: Template → Production Server

**Configuration:**

- [ ] `.env` configured with `PROVIDER_*` credentials
- [ ] `package.json` updated (name, description, dependencies)
- [ ] `wrangler.toml` configured (if using Workers)
- [ ] `RS_TOKENS_ENC_KEY` generated and secured

**Implementation:**

- [ ] `config/metadata.ts` — server metadata and tool metadata defined
- [ ] `schemas/` — Zod input/output schemas created
- [ ] `services/` — provider API client created
- [ ] `shared/tools/<provider>/` — tool handlers using `defineTool()` pattern
- [ ] `shared/tools/registry.ts` — `sharedTools[]` updated with your tools
- [ ] OAuth scopes cover all tool requirements

**Testing:**

- [ ] OAuth flow tested (authorize → callback → token → API call)
- [ ] RS token mapping verified
- [ ] Tools tested with real provider API
- [ ] Error cases handled gracefully
- [ ] Security tests passed

**Deployment:**

- [ ] Node servers start without errors (`bun dev`)
- [ ] Workers deploy successfully (`wrangler deploy`)
- [ ] Health checks pass
- [ ] OAuth metadata endpoints return valid JSON

**Documentation:**

- [ ] README updated with your tools
- [ ] Provider setup documented
- [ ] Example requests included

**Production:**

- [ ] HTTPS configured (not HTTP)
- [ ] Secrets stored securely (env vars / wrangler secrets)
- [ ] Monitoring configured
- [ ] Backup strategy for token storage

---

## Quick Reference

| What | Where |
|------|-------|
| Environment schema | `src/shared/config/env.ts` |
| Local config re-export | `src/config/env.ts` |
| Tool metadata | `src/config/metadata.ts` |
| Tool types & `defineTool()` | `src/shared/tools/types.ts` |
| Tool registry (`sharedTools[]`) | `src/shared/tools/registry.ts` |
| Node.js tool registration | `src/tools/index.ts` |
| Token & session storage | `src/shared/storage/` |
| OAuth flow logic | `src/shared/oauth/flow.ts` |
| Auth strategy | `src/shared/auth/strategy.ts` |
| Node.js entry (Hono) | `src/index.ts` |
| Node.js HTTP app | `src/http/app.ts` |
| Node.js auth app (OAuth AS) | `src/http/auth-app.ts` |
| Workers entry | `src/worker.ts` |
| Workers router factory | `src/adapters/http-workers/index.ts` |
| MCP JSON-RPC dispatcher | `src/shared/mcp/dispatcher.ts` |
| Input/output schemas | `src/schemas/` |
| Service/API clients | `src/services/` |

**Start Development:** `bun dev` (Node) or `wrangler dev` (Workers)
**Deploy:** `bun run build && pm2 start dist/index.js` (Node) or `wrangler deploy` (Workers)
**Test:** `bun run test:client`

---

## Support & Resources

- **MCP Specification:** https://spec.modelcontextprotocol.io/
- **OAuth 2.1:** https://oauth.net/2.1/
- **TypeScript SDK:** https://github.com/modelcontextprotocol/typescript-sdk
- **Linear MCP (OAuth reference):** `tools/linear-mcp/` in this repo
- **Gmail MCP (OAuth reference):** `tools/gmail-mcp/` in this repo

---

**Remember:** This template is a starting point. Customize it for your use case, but maintain the core security principles (RS token mapping, PKCE enforcement, encrypted storage, generic `PROVIDER_*` naming).
