import { readFileSync } from 'node:fs'
import { Script } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { XTERM_HTML, XTERM_HTML_ANDROID } from './terminal-webview-html'

const terminalWebViewSource = readFileSync(
  new URL('./TerminalWebView.tsx', import.meta.url),
  'utf8'
)
const terminalHtmlSource = readFileSync(
  new URL('./terminal-webview-html.ts', import.meta.url),
  'utf8'
)
const terminalWebViewFrameSource = readFileSync(
  new URL('./TerminalWebViewFrame.tsx', import.meta.url),
  'utf8'
)
const terminalWebViewMessageHandlerSource = readFileSync(
  new URL('./terminal-webview-message-handler.ts', import.meta.url),
  'utf8'
)
const terminalWebViewSourceModuleSource = readFileSync(
  new URL('./terminal-webview-source.ts', import.meta.url),
  'utf8'
)

function extractStatusDotNormalizer() {
  const declarationStart = terminalHtmlSource.indexOf('  var CLAUDE_STATUS_DOT =')
  const declarationEnd = terminalHtmlSource.indexOf('  var PRIVATE_MODE_SCAN_TAIL_LIMIT')
  const functionStart = terminalHtmlSource.indexOf('  function isStatusDotPresentationSelector')
  const functionEnd = terminalHtmlSource.indexOf('  function enqueueWrite', functionStart)
  expect(declarationStart).toBeGreaterThanOrEqual(0)
  expect(declarationEnd).toBeGreaterThan(declarationStart)
  expect(functionStart).toBeGreaterThan(declarationEnd)
  expect(functionEnd).toBeGreaterThan(functionStart)
  return `${terminalHtmlSource.slice(declarationStart, declarationEnd)}\n${terminalHtmlSource.slice(functionStart, functionEnd)}`
}

function normalizeStatusDotChunks(chunks: string[]) {
  const context: { chunks: string[]; output?: string } = { chunks }
  new Script(`
${extractStatusDotNormalizer()}
output = chunks.map(function(chunk) { return normalizeStatusDotPresentation(chunk); }).join('');
`).runInNewContext(context)
  return context.output ?? ''
}

describe('TerminalWebView text zoom', () => {
  it('pins textZoom to 100 so Android system font scale cannot inflate glyphs past xterm cell metrics', () => {
    const start = terminalWebViewSource.indexOf('<WebView')
    expect(start).toBeGreaterThanOrEqual(0)
    const end = terminalWebViewSource.indexOf('/>', start)
    expect(end).toBeGreaterThan(start)
    const webViewProps = terminalWebViewSource.slice(start, end)
    expect(webViewProps).toContain('textZoom={100}')
  })

  it('keeps platform HTML source objects stable so parent renders do not reload xterm', () => {
    const start = terminalWebViewSource.indexOf('<WebView')
    expect(start).toBeGreaterThanOrEqual(0)
    const end = terminalWebViewSource.indexOf('/>', start)
    expect(end).toBeGreaterThan(start)
    const webViewProps = terminalWebViewSource.slice(start, end)
    expect(terminalWebViewSourceModuleSource).toContain(
      'const XTERM_DEFAULT_WEBVIEW_SOURCE = { html: XTERM_HTML }'
    )
    expect(terminalWebViewSourceModuleSource).toContain(
      'const XTERM_ANDROID_WEBVIEW_SOURCE = { html: XTERM_HTML_ANDROID }'
    )
    expect(terminalWebViewSourceModuleSource).toContain("Platform.OS === 'android'")
    expect(webViewProps).toContain('source={XTERM_WEBVIEW_SOURCE}')
    expect(webViewProps).not.toContain('source={{ html: XTERM_HTML }}')
    expect(webViewProps).not.toContain('source={{ html: XTERM_HTML_ANDROID }}')
  })

  it('forces the Claude status dot to text presentation before xterm writes', () => {
    expect(terminalHtmlSource).toContain('font-variant-emoji: text')
    expect(terminalHtmlSource).toContain('var CLAUDE_STATUS_DOT = String.fromCharCode(0x23fa)')
    expect(terminalHtmlSource).toContain('TEXT_PRESENTATION_SELECTOR = String.fromCharCode(0xfe0e)')
    expect(terminalHtmlSource).toContain(
      'EMOJI_PRESENTATION_SELECTOR = String.fromCharCode(0xfe0f)'
    )
    expect(terminalHtmlSource).toContain('function normalizeStatusDotPresentation(data)')
    expect(terminalHtmlSource).toContain(
      'data.replace(CLAUDE_STATUS_DOT_PATTERN, CLAUDE_STATUS_DOT + TEXT_PRESENTATION_SELECTOR)'
    )
    expect(terminalHtmlSource).toContain('writeQueue.push(normalizeStatusDotPresentation(data))')
  })

  it('normalizes Claude status dots idempotently across write chunks', () => {
    const dot = String.fromCharCode(0x23fa)
    const textSelector = String.fromCharCode(0xfe0e)
    const emojiSelector = String.fromCharCode(0xfe0f)
    const textDot = dot + textSelector

    expect(normalizeStatusDotChunks([dot])).toBe(textDot)
    expect(normalizeStatusDotChunks([dot + emojiSelector])).toBe(textDot)
    expect(normalizeStatusDotChunks([dot + textSelector])).toBe(textDot)
    expect(normalizeStatusDotChunks([dot + textSelector + emojiSelector])).toBe(textDot)
    expect(normalizeStatusDotChunks([dot, emojiSelector, ' ready'])).toBe(`${textDot} ready`)
    expect(normalizeStatusDotChunks([dot, textSelector, ' ready'])).toBe(`${textDot} ready`)
    expect(normalizeStatusDotChunks([dot, textSelector, emojiSelector, ' ready'])).toBe(
      `${textDot} ready`
    )
    expect(normalizeStatusDotChunks([dot, emojiSelector, textSelector, ' ready'])).toBe(
      `${textDot} ready`
    )
    expect(normalizeStatusDotChunks([dot + textSelector, emojiSelector, ' ready'])).toBe(
      `${textDot} ready`
    )
    expect(normalizeStatusDotChunks([dot + emojiSelector, textSelector, ' ready'])).toBe(
      `${textDot} ready`
    )
  })

  it('resets pending Claude status dot selector state when the terminal lifecycle resets', () => {
    const initStart = terminalHtmlSource.indexOf('function init(')
    const initReplay = terminalHtmlSource.indexOf(
      'var replayData = normalizeInitialData(initialData)'
    )
    const clearStart = terminalHtmlSource.indexOf("} else if (msg.type === 'clear') {")
    const clearEnd = terminalHtmlSource.indexOf("} else if (msg.type === 'measure')", clearStart)
    expect(initStart).toBeGreaterThanOrEqual(0)
    expect(initReplay).toBeGreaterThan(initStart)
    expect(clearStart).toBeGreaterThanOrEqual(0)
    expect(clearEnd).toBeGreaterThan(clearStart)
    expect(terminalHtmlSource.slice(initStart, initReplay)).toContain(
      'statusDotPendingSelector = false'
    )
    expect(terminalHtmlSource.slice(clearStart, clearEnd)).toContain(
      'statusDotPendingSelector = false'
    )
  })

  it('loads Unicode 11 before replaying mobile terminal bytes', () => {
    expect(terminalHtmlSource).toContain('@xterm/xterm@6.1.0-beta.285')
    expect(terminalHtmlSource).toContain('@xterm/addon-unicode11@0.10.0-beta.285')
    const open = terminalHtmlSource.indexOf('term.open(surface)')
    const unicode = terminalHtmlSource.indexOf("term.unicode.activeVersion = '11'")
    const replay = terminalHtmlSource.indexOf('enqueueWrite(replayData)')
    expect(open).toBeGreaterThanOrEqual(0)
    expect(unicode).toBeGreaterThan(open)
    expect(replay).toBeGreaterThan(unicode)
  })

  it('inlines xterm CSS so Android release rendering does not depend on a stylesheet request', () => {
    expect(terminalHtmlSource).toContain('const XTERM_CSS = `')
    expect(terminalHtmlSource).toContain('<style>${XTERM_CSS}</style>')
    expect(XTERM_HTML_ANDROID).toContain('.xterm .xterm-screen canvas')
    expect(XTERM_HTML_ANDROID).not.toContain('css/xterm.min.css')
  })

  it('reports WebView-side message and paint failures instead of swallowing them', () => {
    expect(terminalHtmlSource).toContain('function notifyError(stage, error)')
    expect(terminalHtmlSource).toContain("notifyError('terminal message failed', error)")
    expect(terminalHtmlSource).toContain('function notifyPaintHealth(stage)')
    expect(terminalHtmlSource).toContain("notifyPaintHealth('after-init-message')")
    expect(terminalWebViewMessageHandlerSource).toContain("msg.type === 'paint-health'")
    expect(terminalWebViewMessageHandlerSource).toContain("console.log('[terminal-webview][paint]', msg)")
  })

  it('loads the structuredClone polyfill before xterm for older Android WebViews', () => {
    expect(terminalHtmlSource).toContain('const STRUCTURED_CLONE_POLYFILL_SCRIPT = `<script>')
    expect(terminalHtmlSource).toContain("globalThis.structuredClone=function structuredClone(value)")
    expect(XTERM_HTML_ANDROID.indexOf('function structuredClone(value)')).toBeGreaterThanOrEqual(0)
    expect(XTERM_HTML_ANDROID.indexOf('function structuredClone(value)')).toBeLessThan(
      XTERM_HTML_ANDROID.indexOf('@xterm/xterm@6.1.0-beta.285')
    )
  })

  it('keeps default/iOS WebGL enabled and disables WebGL in Android HTML', () => {
    expect(terminalHtmlSource).toContain('@xterm/addon-webgl@0.20.0-beta.284')
    expect(XTERM_HTML).toContain('@xterm/addon-webgl@0.20.0-beta.284')
    expect(XTERM_HTML).toContain('new window.WebglAddon.WebglAddon()')
    expect(XTERM_HTML_ANDROID).not.toContain('@xterm/addon-webgl@0.20.0-beta.284')
    expect(XTERM_HTML_ANDROID).not.toContain('new window.WebglAddon.WebglAddon()')
    expect(XTERM_HTML_ANDROID).toContain('@xterm/addon-unicode11@0.10.0-beta.285')
  })

  it('keeps desktop font fallbacks with the newer xterm stack', () => {
    expect(XTERM_HTML).toContain('@xterm/xterm@6.1.0-beta.285')
    expect(terminalHtmlSource).toContain('"SF Mono", "Menlo", "Monaco", "Cascadia Mono"')
    expect(terminalHtmlSource).toContain("fontWeight: '300'")
    expect(terminalHtmlSource).toContain("fontWeightBold: '500'")
  })

  it('surfaces WebView error messages in a compact themed diagnostic', () => {
    expect(terminalWebViewMessageHandlerSource).toContain("msg.type === 'error'")
    expect(terminalWebViewMessageHandlerSource).toContain('setWebViewError(message)')
    expect(terminalWebViewMessageHandlerSource).toContain(
      "console.error('[terminal-webview]', message)"
    )
    expect(terminalWebViewFrameSource).toContain('Terminal WebView error: {webViewError}')
    expect(terminalWebViewFrameSource).toContain('styles.diagnostic')
    expect(terminalWebViewFrameSource).toContain('borderColor: colors.statusRed')
    expect(terminalWebViewFrameSource).toContain('backgroundColor: colors.bgPanel')
  })
})
