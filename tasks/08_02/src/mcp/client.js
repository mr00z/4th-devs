import { readFile } from 'node:fs/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { failureConfig } from '../config.js';
import log from '../helpers/logger.js';

const loadMcpConfig = async () => {
    const raw = await readFile(failureConfig.mcpConfigPath, 'utf8');
    log.trace('mcp.config_loaded', {
        path: failureConfig.mcpConfigPath,
        bytes: raw.length,
    });
    return JSON.parse(raw);
};

export const createMcpClient = async (serverName = 'files') => {
    const config = await loadMcpConfig();
    const server = config?.mcpServers?.[serverName];

    if (!server) {
        throw new Error(`MCP server "${serverName}" not found in mcp.json`);
    }

    const client = new Client({ name: 'failure-agent', version: '1.0.0' }, { capabilities: {} });
    log.start(`mcp_connect ${serverName}`);
    log.trace('mcp.spawn', {
        command: server.command,
        args: server.args,
        cwd: failureConfig.taskRoot,
    });

    const transport = new StdioClientTransport({
        command: server.command,
        args: server.args,
        env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: process.env.NODE_ENV,
            ...server.env,
        },
        cwd: failureConfig.taskRoot,
        stderr: 'inherit',
    });

    await client.connect(transport);
    log.success(`mcp_connected ${serverName}`);
    return client;
};

export const closeMcpClient = async (client) => {
    if (!client) {
        return;
    }

    try {
        await client.close();
        log.trace('mcp.closed', 'Client connection closed');
    } catch {
        log.warn('mcp.close_failed');
    }
};

export const callMcpTool = async (client, name, args) => {
    log.trace('mcp.tool.request', { name, args });
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.find((item) => item.type === 'text')?.text ?? '';
    log.trace('mcp.tool.response', {
        name,
        textPreview: text.slice(0, failureConfig.logPreviewChars),
    });

    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

export const inspectFailureLogViaMcp = async (client) => {
    if (!client) {
        return null;
    }

    log.start('mcp_inspect_failure_log');

    const listing = await callMcpTool(client, 'fs_read', {
        path: 'workspace',
        mode: 'list',
        limit: 200,
    });

    const fileContent = await callMcpTool(client, 'fs_read', {
        path: 'workspace/failure.log',
        mode: 'content',
    });

    return {
        listing,
        filePreview: typeof fileContent === 'string' ? fileContent.slice(0, 2000) : fileContent,
    };
};

