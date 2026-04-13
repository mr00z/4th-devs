const morseMap: Record<string, string> = {
  '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E', '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J',
  '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O', '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
  '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y', '--..': 'Z',
  '-----': '0', '.----': '1', '..---': '2', '...--': '3', '....-': '4', '.....': '5', '-....': '6', '--...': '7', '---..': '8', '----.': '9',
}

export interface MorseDecodeResult {
  text: string
  confidence: number
  tokenCount: number
}

export function looksLikeTaTiSignal(input: string): boolean {
  const normalized = input.replace(/\s+/g, ' ').trim()
  return /\b(?:Ta|Ti)(?:Ta|Ti)*(?:\s+|$)/i.test(normalized)
}

export function decodeTaTiSignal(input: string): MorseDecodeResult {
  const normalized = input
    .replace(/\*[^*]+\*/g, ' ')
    .replace(/\(stop\)/gi, ' / ')
    .replace(/Ta/gi, '-')
    .replace(/Ti/gi, '.')
    .replace(/[^./\-\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return { text: '', confidence: 0, tokenCount: 0 }
  }

  const rawTokens = normalized.split(' ')
  const words: string[] = []
  let currentWord: string[] = []
  let decoded = 0
  let unknown = 0

  for (const token of rawTokens) {
    if (token === '/') {
      if (currentWord.length > 0) {
        words.push(currentWord.join(''))
        currentWord = []
      }
      continue
    }
    const letter = morseMap[token]
    if (letter) {
      currentWord.push(letter)
      decoded += 1
    } else {
      currentWord.push('?')
      unknown += 1
    }
  }
  if (currentWord.length > 0) {
    words.push(currentWord.join(''))
  }

  const tokenCount = decoded + unknown
  const confidence = tokenCount === 0 ? 0 : decoded / tokenCount
  return {
    text: words.join(' ').trim(),
    confidence,
    tokenCount,
  }
}
