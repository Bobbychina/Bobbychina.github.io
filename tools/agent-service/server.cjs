'use strict';
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { search, tool } = require('../../assets/agent-directory.js');
const mcpCard = require('../../.well-known/mcp/server-card.json');
const agentCard = require('../../.well-known/agent-card.json');

const mcpVersion = mcpCard.remotes[0].supportedProtocolVersions[0];
const port = 18746;
const allowedOrigins = new Set(['https://bobbycn.cc', 'http://127.0.0.1:' + port, 'http://localhost:' + port]);
const allowedHosts = new Set(['bobbycn.cc', '127.0.0.1:' + port, 'localhost:' + port]);
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

class RpcError extends Error {
  constructor(code, message, status = 200) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function mcp(method, params) {
  switch (method) {
    case 'initialize':
      if (typeof params.protocolVersion !== 'string' || !isObject(params.capabilities) ||
          !isObject(params.clientInfo) || typeof params.clientInfo.name !== 'string' ||
          typeof params.clientInfo.version !== 'string') throw new RpcError(-32602, 'Invalid initialize parameters.');
      return {
        protocolVersion: mcpVersion, capabilities: { tools: {} },
        serverInfo: { name: mcpCard.name, title: mcpCard.title, version: mcpCard.version },
      };
    case 'ping': return {};
    case 'tools/list': return { tools: [tool] };
    case 'tools/call': {
      if (params.name !== tool.name) throw new RpcError(-32602, 'Unknown tool name.');
      try {
        const entries = search(params.arguments);
        return { content: [{ type: 'text', text: JSON.stringify(entries) }], structuredContent: { entries } };
      } catch (error) {
        return { isError: true, content: [{ type: 'text', text: error.message }] };
      }
    }
    default: throw new RpcError(-32601, 'Method not found.');
  }
}

function a2a(method, params) {
  switch (method) {
    case 'ListTasks': {
      const size = params.pageSize ?? 50;
      if (!Number.isInteger(size) || size < 1 || size > 100 || params.pageToken) {
        throw new RpcError(-32602, 'Invalid pagination parameters.');
      }
      return { tasks: [], totalSize: 0, nextPageToken: '', pageSize: size };
    }
    case 'GetTask':
    case 'CancelTask': throw new RpcError(-32001, 'Task not found.');
    case 'SendStreamingMessage':
    case 'SubscribeToTask': throw new RpcError(-32004, 'Streaming is unavailable.');
    case 'CreateTaskPushNotificationConfig':
    case 'GetTaskPushNotificationConfig':
    case 'ListTaskPushNotificationConfigs':
    case 'DeleteTaskPushNotificationConfig': throw new RpcError(-32003, 'Push notifications are unavailable.');
    case 'GetExtendedAgentCard': throw new RpcError(-32007, 'No extended agent card is configured.');
    case 'SendMessage': break;
    default: throw new RpcError(-32601, 'Method not found.');
  }
  const { message, configuration } = params;
  if (!isObject(message) || message.role !== 'ROLE_USER' || typeof message.messageId !== 'string' ||
      !message.messageId || !Array.isArray(message.parts) || !message.parts.length ||
      (message.contextId !== undefined && typeof message.contextId !== 'string')) {
    throw new RpcError(-32602, 'Expected a user message with messageId and text parts.');
  }
  if (message.taskId) throw new RpcError(-32001, 'Task not found.');
  if (configuration?.taskPushNotificationConfig) throw new RpcError(-32003, 'Push notifications are unavailable.');
  const outputModes = configuration?.acceptedOutputModes;
  if (outputModes !== undefined && (!Array.isArray(outputModes) ||
      (outputModes.length && !outputModes.some(mode => ['text/plain', 'text/*', '*/*'].includes(mode))))) {
    throw new RpcError(-32005, 'Only text/plain output is available.');
  }
  if (message.parts.some(part => !isObject(part) || typeof part.text !== 'string' ||
      (part.mediaType && part.mediaType !== 'text/plain') || ['raw', 'url', 'data'].some(key => key in part))) {
    throw new RpcError(-32005, 'Only plain text input is supported.');
  }
  const query = message.parts.map(part => part.text).join(' ').trim();
  if (query.length > 160) throw new RpcError(-32602, 'Use a keyword of at most 160 characters.');
  const entries = search({ query });
  const text = entries.map(entry => entry.title + ' — ' + entry.url).join('\n') || 'No matching entries. Try a shorter keyword.';
  return { message: {
    role: 'ROLE_AGENT', messageId: randomUUID(), contextId: message.contextId || randomUUID(),
    parts: [{ text }],
  } };
}

function reply(res, status, value, headers = {}) {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...(value === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}

async function readRequest(req) {
  const chunks = [];
  let size = 0;
  // Keep the socket available for the 413 response if the request exceeds the bound.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16384) {
      req.resume();
      throw new RpcError(-32600, 'Request body is too large.', 413);
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new RpcError(-32700, 'Invalid JSON.', 400); }
}

async function handle(req, res) {
  let id = null;
  try {
    if (!allowedHosts.has(req.headers.host)) return reply(res, 403);
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/_agent/content') {
      if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, undefined, { Allow: 'GET, HEAD' });
      return await require('./markdown.cjs').serve(req, res);
    }
    const cards = {
      '/.well-known/mcp/server-card.json': mcpCard,
      '/mcp/server-card': mcpCard,
      '/.well-known/agent-card.json': agentCard,
    };
    if (Object.hasOwn(cards, url.pathname)) {
      const cors = {
        'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      };
      if (req.method === 'OPTIONS') return reply(res, 204, undefined, cors);
      if (!['GET', 'HEAD'].includes(req.method)) return reply(res, 405, undefined, { Allow: 'GET, HEAD, OPTIONS' });
      const cardType = url.pathname === '/mcp/server-card' ? 'application/mcp-server-card+json' : 'application/json';
      return reply(res, 200, cards[url.pathname], { ...cors, 'Content-Type': cardType, 'Cache-Control': 'public, max-age=300' });
    }
    if (!['/mcp', '/a2a'].includes(url.pathname)) return reply(res, 404);
    if (req.headers.origin !== undefined && !allowedOrigins.has(req.headers.origin)) return reply(res, 403);
    if (req.method !== 'POST') return reply(res, 405, undefined, { Allow: 'POST' });
    if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(res, 415);
    const rpc = await readRequest(req);
    if (!isObject(rpc) || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' ||
        ('id' in rpc && !(typeof rpc.id === 'string' || Number.isSafeInteger(rpc.id)))) {
      throw new RpcError(-32600, 'Invalid JSON-RPC request.', 400);
    }
    id = rpc.id ?? null;
    if (rpc.params !== undefined && !isObject(rpc.params)) throw new RpcError(-32602, 'Expected named parameters.');
    const params = rpc.params || {};
    let result;
    if (url.pathname === '/mcp') {
      const version = req.headers['mcp-protocol-version'];
      if (version !== undefined && version !== mcpVersion) throw new RpcError(-32602, 'Unsupported MCP protocol version.', 400);
      if (id === null) return reply(res, 202);
      result = mcp(rpc.method, params);
    } else {
      if (id === null) throw new RpcError(-32600, 'A2A request id is required.', 400);
      const version = req.headers['a2a-version'] || url.searchParams.get('A2A-Version');
      if (version !== '1.0') throw new RpcError(-32009, 'Use A2A-Version: 1.0.');
      result = a2a(rpc.method, params);
    }
    reply(res, 200, { jsonrpc: '2.0', id, result });
  } catch (error) {
    const known = error instanceof RpcError;
    reply(res, known ? error.status : 500, { jsonrpc: '2.0', id, error: {
      code: known ? error.code : -32603, message: known ? error.message : 'Internal server error.',
    } });
  }
}

if (require.main === module) {
  const host = process.env.HOST || '127.0.0.1';
  http.createServer({ requestTimeout: 15000, headersTimeout: 10000 }, handle).listen(port, host, () => {
    console.log('Public directory service listening on ' + host + ':' + port);
  });
}
