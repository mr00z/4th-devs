import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import log from './logger.js'
import type { McpClientHandle, McpConfig, McpToolMeta, TextContent } from './types.js'
import { paths } from './config.js'

const isTextContent = (value: unknown): value is TextContent => {
  if (!value || typeof value !== 'object') return false
  const v = value as { type?: unknown; text?: unknown }
  return v.type === 'text' && typeof v.text === 'string'
}

export async function createMcpClient(serverName = 'files'): Promise<McpClientHandle> {
  const raw = await readFile(paths.mcpConfigPath, 'utf8')
  const config = JSON.parse(raw) as McpConfig
  const server = config.mcpServers[serverName]
  if (!server) {
    throw new Error(`MCP server "${serverName}" not found in mcp.json`)
  }

  const client = new Client(
    { name: 's04e04-filesystem-agent', version: '1.0.0' },
    { capabilities: {} },
  )

  const transport = new StdioClientTransport({
    command: server.command,
    args: server.args ?? [],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NODE_ENV: process.env.NODE_ENV ?? '',
      ...(server.env ?? {}),
    },
    cwd: server.cwd ? resolve(paths.projectRoot, server.cwd) : paths.projectRoot,
  })

  await client.connect(transport)
  log.info('Connected to MCP server', { serverName })

  return {
    client,
    close: async () => {
      await client.close().catch(() => {})
    },
  }
}

export async function listMcpTools(client: Client): Promise<McpToolMeta[]> {
  const result = await client.listTools()
  return result.tools.map((tool: { name: string; description?: string; inputSchema?: unknown }) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }))
}

export async function callMcpTool(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  log.tool(`MCP -> ${name}`, args)
  const result = await client.callTool({ name, arguments: args })
  const content = Array.isArray((result as { content?: unknown }).content)
    ? (result as { content: unknown[] }).content
    : []
  const text = content.find(isTextContent)
  const output = text ? (() => { try { return JSON.parse(text.text) } catch { return text.text } })() : result
  log.tool(`MCP <- ${name}`, typeof output === 'string' ? output.slice(0, 400) : output)
  return output
}
