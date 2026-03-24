import { hubApiKey } from './config.js'
import log from './logger.js'

const ZMAIL_API_URL = 'https://hub.ag3nts.org/api/zmail'
const VERIFY_URL = 'https://hub.ag3nts.org/verify'

interface ToolDefinition {
  type: 'function'
  name: string
  description: string
  parameters: Record<string, unknown>
}

interface Tool {
  definition: ToolDefinition
  handler: (args: Record<string, unknown>) => Promise<string>
}

async function callZmailApi(body: Record<string, unknown>): Promise<string> {
  try {
    log.api(`POST ${ZMAIL_API_URL}`)
    const response = await fetch(ZMAIL_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: hubApiKey, ...body }),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.text()
    log.apiDone(data)
    return data
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error('Zmail API error', msg)
    return `Error: ${msg}`
  }
}

async function callVerifyApi(body: Record<string, unknown>): Promise<string> {
  try {
    log.verification(1)
    console.log(`         Sending to: ${VERIFY_URL}`)
    
    const response = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: hubApiKey, ...body }),
    })

    const data = await response.text()
    console.log(`         Raw Response Status: ${response.status} ${response.statusText}`)
    console.log(`         Raw Response Body: ${data}`)
    
    if (!response.ok) {
      log.verificationResult(false, `HTTP ${response.status} ${response.statusText}: ${data}`)
      return `Error: API error: ${response.status} ${response.statusText} - ${data}`
    }

    log.verificationResult(true, data)
    return data
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.log(`         Network Error: ${msg}`)
    log.verificationResult(false, msg)
    return `Error: ${msg}`
  }
}

const tools: Tool[] = [
  {
    definition: {
      type: 'function',
      name: 'search_mailbox',
      description: 'Search messages with full-text style query and Gmail-like operators.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query. Supports words, "phrase", -exclude, from:, to:, subject:, subject:"phrase", subject:(phrase), OR, AND. Missing operator means AND.' },
          page: { type: 'number', description: 'Optional. Integer >= 1. Default: 1.' },
          perPage: { type: 'number', description: 'Optional. Integer between 5 and 20. Default: 5.' }
        },
        required: ['query']
      }
    },
    handler: async (args) => {
      const { query, page = 1, perPage = 5 } = args
      log.tool('search_mailbox', { query, page, perPage })
      const result = await callZmailApi({
        action: 'search',
        query,
        page,
        perPage
      })
      log.toolResult('search_mailbox', !result.startsWith('Error'), result)
      return result
    }
  },
  {
    definition: {
      type: 'function',
      name: 'get_inbox',
      description: 'Return list of threads in your mailbox.',
      parameters: {
        type: 'object',
        properties: {
          page: { type: 'number', description: 'Optional. Integer >= 1. Default: 1.' },
          perPage: { type: 'number', description: 'Optional. Integer between 5 and 20. Default: 5.' }
        }
      }
    },
    handler: async (args) => {
      const { page = 1, perPage = 5 } = args
      log.tool('get_inbox', { page, perPage })
      const result = await callZmailApi({
        action: 'getInbox',
        page,
        perPage
      })
      log.toolResult('get_inbox', !result.startsWith('Error'), result)
      return result
    }
  },
  {
    definition: {
      type: 'function',
      name: 'get_thread',
      description: 'Return rowID and messageID list for a selected thread. No message body.',
      parameters: {
        type: 'object',
        properties: {
          threadID: { type: 'number', description: 'Required. Numeric thread identifier.' }
        },
        required: ['threadID']
      }
    },
    handler: async (args) => {
      const { threadID } = args
      log.tool('get_thread', { threadID })
      const result = await callZmailApi({
        action: 'getThread',
        threadID
      })
      log.toolResult('get_thread', !result.startsWith('Error'), result)
      return result
    }
  },
  {
    definition: {
      type: 'function',
      name: 'get_messages',
      description: 'Return one or more messages by rowID/messageID (hash).',
      parameters: {
        type: 'object',
        properties: {
          ids: { 
            description: 'Required. Numeric rowID, 32-char messageID, or an array of them.',
            oneOf: [
              { type: 'number' },
              { type: 'string' },
              { type: 'array', items: { oneOf: [{ type: 'number' }, { type: 'string' }] } }
            ]
          }
        },
        required: ['ids']
      }
    },
    handler: async (args) => {
      const { ids } = args
      log.tool('get_messages', { ids })
      const result = await callZmailApi({
        action: 'getMessages',
        ids
      })
      log.toolResult('get_messages', !result.startsWith('Error'), result)
      return result
    }
  },
  {
    definition: {
      type: 'function',
      name: 'submit_answer',
      description: 'Submit the extracted data for verification.',
      parameters: {
        type: 'object',
        properties: {
          password: { type: 'string', description: 'The password found in the mailbox' },
          date: { type: 'string', description: 'The date in YYYY-MM-DD format when security department plans the attack' },
          confirmation_code: { type: 'string', description: 'The confirmation code from the ticket (SEC- followed by 32 characters)' }
        },
        required: ['password', 'date', 'confirmation_code']
      }
    },
    handler: async (args) => {
      const { password, date, confirmation_code } = args
      if (!password || !date || !confirmation_code) {
        return 'Missing required fields: password, date, confirmation_code'
      }
      const code = typeof confirmation_code === 'string' ? confirmation_code : ''
      
      // Log what we're about to send
      const requestBody = {
        task: 'mailbox',
        answer: {
          password,
          date,
          confirmation_code
        }
      }
      
      log.tool('submit_answer', { password, date, confirmation_code: code.substring(0, 8) + '...' })
      console.log(`         Request Body: ${JSON.stringify(requestBody, null, 2)}`)
      
      const result = await callVerifyApi(requestBody)
      log.toolResult('submit_answer', !result.startsWith('Error'), result)
      return result
    }
  }
]

export { tools }

export const findTool = (name: string): Tool | undefined =>
  tools.find((t) => t.definition.name === name)
