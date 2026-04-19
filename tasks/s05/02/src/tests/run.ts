import assert from 'node:assert/strict'
import { parseHubPayload } from '../api/client.js'
import { applyInboundTurn, chooseNextUtterance, createInitialSessionState, registerOutboundTurn } from '../conversation.js'
import { setTestInterpreterOverride, interpretOperatorReply } from '../llm.js'

async function testParseHubPayload(): Promise<void> {
  const parsed = parseHubPayload('{"code":0,"message":"ok","meta":"audio/mpeg","attachment":"ZmFrZQ=="}', {
    code: 0,
    message: 'ok',
    meta: 'audio/mpeg',
    attachment: 'ZmFrZQ==',
  })

  assert.equal(parsed.code, 0)
  assert.equal(parsed.message, 'ok')
  assert.equal(parsed.audioBase64, 'ZmFrZQ==')
  assert.equal(parsed.mimeType, 'audio/mpeg')

  const withTranscription = parseHubPayload('{"code":0}', {
    code: 0,
    message: 'Identity confirmed.',
    transcription: 'RD472 jest przejezdna.',
  })
  assert.equal(withTranscription.text, 'RD472 jest przejezdna.')
  assert.equal(withTranscription.callerTranscript, 'RD472 jest przejezdna.')

  const withMessageAndAudioOnly = parseHubPayload('{"code":120}', {
    code: 120,
    message: 'Identity confirmed.',
    audio: 'ZmFrZQ==',
  })
  assert.equal(withMessageAndAudioOnly.text, '')
  assert.equal(withMessageAndAudioOnly.message, 'Identity confirmed.')
  assert.equal(withMessageAndAudioOnly.audioBase64, 'ZmFrZQ==')
}

async function testPolishInterpretationAndFlow(): Promise<void> {
  setTestInterpreterOverride(async () => ({
    operatorIntent: 'provide_statuses',
    routeStatuses: { RD224: 'blocked', RD472: 'passable', RD820: 'blocked' },
    passableRoutes: ['RD472'],
    blockedRoutes: ['RD224', 'RD820'],
    requestedPassword: false,
    askedWhy: false,
    burned: false,
    successLikely: false,
    confidence: 0.9,
    recommendedNextText: '',
    notes: 'test',
  }))

  let state = createInitialSessionState(1)
  const intro = chooseNextUtterance(state)
  assert.match(intro, /Tymon Gajewski/)
  state = registerOutboundTurn(state, intro)

  const operatorText = 'RD224 jest nieprzejezdna, RD472 jest przejezdna, a RD820 skażona.'
  const interpretation = await interpretOperatorReply(operatorText, 'history', state.stage)
  state = applyInboundTurn(state, {
    sessionIndex: 1,
    turnIndex: 1,
    payload: { code: 0, message: '', text: '', callerTranscript: '', audioBase64: null, mimeType: null, hint: '' },
    transcript: operatorText,
    interpretation,
  })

  const disableRequest = chooseNextUtterance(state)
  assert.match(disableRequest, /RD472/)
  assert.doesNotMatch(disableRequest, /RD224/)
  setTestInterpreterOverride(null)
}

function testReasonFollowupRequiresConcreteJustification(): void {
  const state = registerOutboundTurn(createInitialSessionState(1), 'Dzień dobry, mówi Tymon Gajewski.')
  const outbound = chooseNextUtterance(state, {
    operatorIntent: 'ask_why',
    routeStatuses: { RD224: 'unknown', RD472: 'unknown', RD820: 'unknown' },
    passableRoutes: [],
    blockedRoutes: [],
    requestedPassword: false,
    askedWhy: true,
    burned: false,
    successLikely: false,
    confidence: 0.9,
    recommendedNextText: 'Dzwonię w sprawie statusu dróg RD224, RD472 i RD820.',
    notes: 'test',
  })

  assert.match(outbound, /baz Zygfryda/)
  assert.match(outbound, /tajny transport|transportu żywności/)
}

function testPasswordRequestDoesNotCompleteConversation(): void {
  let state = createInitialSessionState(1)
  state = registerOutboundTurn(state, 'Dzień dobry, mówi Tymon Gajewski.')
  state = {
    ...state,
    routeStatuses: { RD224: 'blocked', RD472: 'blocked', RD820: 'passable' },
    selectedRoutesToDisable: ['RD820'],
  }
  state = registerOutboundTurn(state, 'Potrzebuję wyłączyć monitoring na drodze RD820.')

  state = applyInboundTurn(state, {
    sessionIndex: 1,
    turnIndex: 2,
    payload: { code: 160, message: 'Password required.', text: '', callerTranscript: '', audioBase64: null, mimeType: null, hint: '' },
    transcript: 'Zanim to zrobię, muszę usłyszeć hasło.',
    interpretation: {
      operatorIntent: 'request_password',
      routeStatuses: { RD224: 'blocked', RD472: 'blocked', RD820: 'passable' },
      passableRoutes: ['RD820'],
      blockedRoutes: ['RD224', 'RD472'],
      requestedPassword: true,
      askedWhy: false,
      burned: false,
      successLikely: true,
      confidence: 0.9,
      recommendedNextText: 'Hasło to: [tutaj wpisz hasło]',
      notes: 'test',
    },
  })

  assert.notEqual(state.stage, 'completed')
  assert.equal(chooseNextUtterance(state), 'Hasło weryfikacyjne: BARBAKAN.')
}

async function main(): Promise<void> {
  await testParseHubPayload()
  await testPolishInterpretationAndFlow()
  testReasonFollowupRequiresConcreteJustification()
  testPasswordRequestDoesNotCompleteConversation()
  console.log('All tests passed')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
