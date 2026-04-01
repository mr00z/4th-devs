import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import log from './logger.js'
import { callMcpTool } from './mcp.js'
import { okoLogin, okoPanelUrl, okoPassword, hubApiKey } from './config.js'

interface SnapshotElement {
  ref: string
  type?: string
  attributes?: Record<string, string>
  text?: string
}

function parseSnapshotRefs(content: string): SnapshotElement[] {
  const elements: SnapshotElement[] = []
  const regex = /- (\w+)?\s*\[ref=([^\]]+)\](?:\s*\[([^\]]+)\])?(?:\s*:\s*(.+))?/g
  let match
  while ((match = regex.exec(content)) !== null) {
    elements.push({
      type: match[1]?.trim(),
      ref: match[2]?.trim(),
      text: match[4]?.trim()
    })
  }
  return elements
}

function findRefByText(content: string, searchText: string): string | null {
  const elements = parseSnapshotRefs(content)
  const el = elements.find(e => 
    e.text?.toLowerCase().includes(searchText.toLowerCase()) ||
    e.type?.toLowerCase().includes(searchText.toLowerCase())
  )
  return el?.ref || null
}

export async function loginToOko(client: Client): Promise<boolean> {
  log.info('Starting OKO login flow')

  // Navigate to panel
  log.info('Navigating to OKO panel', { url: okoPanelUrl })
  const navResult = await callMcpTool(client, 'browser_navigate', { url: okoPanelUrl })
  const navText = typeof navResult === 'string' ? navResult : JSON.stringify(navResult)
  if (navText.includes('### Error') || navText.includes('Error:')) {
    log.error('Browser navigation failed', { result: navText.slice(0, 500) })
    return false
  }

  // Get snapshot to find element refs
  log.info('Getting page snapshot')
  const snapshotResult = await callMcpTool(client, 'browser_snapshot', {})
  const snapshotText = typeof snapshotResult === 'string' ? snapshotResult : JSON.stringify(snapshotResult)
  if (snapshotText.includes('### Error') || snapshotText.includes('Error:')) {
    log.error('Browser snapshot failed', { result: snapshotText.slice(0, 500) })
    return false
  }

  // Find refs for input fields by looking at nearby labels/text
  // Based on page structure: e10=login, e13=password, e16=access_key, e17=submit button
  const loginRef = 'e10'  // textbox "Login"
  const passwordRef = 'e13'  // textbox "Hasło"  
  const accessKeyRef = 'e16'  // textbox "Klucz dostępu"
  const submitRef = 'e17'  // button "Zaloguj"

  // Find and fill login field
  log.info('Filling login field', { login: okoLogin, ref: loginRef })
  const loginResult = await callMcpTool(client, 'browser_type', { ref: loginRef, text: okoLogin })
  const loginText = typeof loginResult === 'string' ? loginResult : JSON.stringify(loginResult)
  if (loginText.includes('### Error') || loginText.includes('Error:')) {
    log.error('Login field fill failed', { result: loginText.slice(0, 500) })
    return false
  }
  log.info('Login field filled', { ref: loginRef })

  // Find and fill password field
  log.info('Filling password field', { ref: passwordRef })
  const passwordResult = await callMcpTool(client, 'browser_type', { ref: passwordRef, text: okoPassword })
  const passwordText = typeof passwordResult === 'string' ? passwordResult : JSON.stringify(passwordResult)
  if (passwordText.includes('### Error') || passwordText.includes('Error:')) {
    log.error('Password field fill failed', { result: passwordText.slice(0, 500) })
    return false
  }
  log.info('Password field filled', { ref: passwordRef })

  // Find and fill access_key field
  log.info('Filling access_key field', { ref: accessKeyRef })
  const accessKeyResult = await callMcpTool(client, 'browser_type', { ref: accessKeyRef, text: hubApiKey })
  const accessKeyText = typeof accessKeyResult === 'string' ? accessKeyResult : JSON.stringify(accessKeyResult)
  if (accessKeyText.includes('### Error') || accessKeyText.includes('Error:')) {
    log.warn('access_key field fill failed (may be optional)', { result: accessKeyText.slice(0, 500) })
  } else {
    log.info('access_key field filled', { ref: accessKeyRef })
  }

  // Find and click submit button
  log.info('Clicking submit button', { ref: submitRef })
  const submitResult = await callMcpTool(client, 'browser_click', { ref: submitRef })
  const submitText = typeof submitResult === 'string' ? submitResult : JSON.stringify(submitResult)
  if (submitText.includes('### Error') || submitText.includes('Error:')) {
    log.error('Submit button click failed', { result: submitText.slice(0, 500) })
    return false
  }
  log.info('Submit button clicked', { ref: submitRef })

  // Wait for navigation/response
  await callMcpTool(client, 'browser_wait_for', { time: 2 })

  // Verify we're logged in by taking a snapshot
  const postLoginSnapshot = await callMcpTool(client, 'browser_snapshot', {})
  const postLoginText = typeof postLoginSnapshot === 'string' ? postLoginSnapshot : JSON.stringify(postLoginSnapshot)
  if (postLoginText.includes('### Error') || postLoginText.includes('Error:')) {
    log.error('Snapshot failed after login', { result: postLoginText.slice(0, 500) })
    return false
  }

  // Check if we're still on login page (login failed)
  if (postLoginText.includes('Logowanie operatora') && postLoginText.includes('Zaloguj')) {
    log.error('Still on login page - credentials may be incorrect')
    return false
  }

  log.success('OKO login completed')
  return true
}
