import { useCallback } from 'react'
import type { WebViewMessageEvent } from 'react-native-webview'
import type { TerminalSelectionEvents } from './TerminalWebView'

type MutableRef<T> = {
  current: T
}

type MeasureResult = { cols: number; rows: number }

type TerminalWebViewMessageHandlerOptions = TerminalSelectionEvents & {
  flushPendingMessages: () => void
  isWebReadyRef: MutableRef<boolean>
  measureResolveRef: MutableRef<((result: MeasureResult | null) => void) | null>
  onWebReady?: () => void
  readyPromiseRef: MutableRef<Promise<void> | null>
  readyResolveRef: MutableRef<(() => void) | null>
  setWebViewError: (message: string | null) => void
}

export function useTerminalWebViewMessageHandler({
  flushPendingMessages,
  isWebReadyRef,
  measureResolveRef,
  onFileTap,
  onHaptic,
  onKeyboardAvoidanceMetrics,
  onModesChanged,
  onOpenUrl,
  onSelectionCopy,
  onSelectionEvicted,
  onSelectionMode,
  onTerminalInput,
  onTerminalTap,
  onTextScaleChange,
  onWebReady,
  readyPromiseRef,
  readyResolveRef,
  setWebViewError
}: TerminalWebViewMessageHandlerOptions) {
  return useCallback(
    (event: WebViewMessageEvent) => {
      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(event.nativeEvent.data) as Record<string, unknown>
      } catch {
        return
      }

      if (msg.type === 'web-ready') {
        isWebReadyRef.current = true
        setWebViewError(null)
        onWebReady?.()
        flushPendingMessages()
      } else if (msg.type === 'ready') {
        // Why: the WebView's init() rAF chain has run, so queued measures can
        // safely read cell dimensions now.
        const resolve = readyResolveRef.current
        readyResolveRef.current = null
        readyPromiseRef.current = null
        resolve?.()
      } else if (msg.type === 'measure-result') {
        const resolve = measureResolveRef.current
        measureResolveRef.current = null
        if (resolve) {
          const cols = typeof msg.cols === 'number' ? msg.cols : null
          const rows = typeof msg.rows === 'number' ? msg.rows : null
          resolve(cols && rows && cols >= 20 && rows >= 8 ? { cols, rows } : null)
        }
      } else if (msg.type === 'log') {
        const tag = typeof msg.tag === 'string' ? msg.tag : '[fit]'
        // eslint-disable-next-line no-console
        console.log(tag, msg.payload)
      } else if (msg.type === 'paint-health') {
        // eslint-disable-next-line no-console
        console.log('[terminal-webview][paint]', msg)
      } else if (msg.type === 'error') {
        const message =
          typeof msg.message === 'string' && msg.message.length > 0
            ? msg.message
            : 'Unknown terminal WebView error'
        setWebViewError(message)
        // eslint-disable-next-line no-console
        console.error('[terminal-webview]', message)
      } else if (msg.type === 'set-select-mode') {
        onSelectionMode?.(!!msg.enabled)
      } else if (msg.type === 'selection') {
        const text = typeof msg.text === 'string' ? msg.text : ''
        onSelectionCopy?.(text)
      } else if (msg.type === 'selection-evicted') {
        onSelectionEvicted?.()
      } else if (msg.type === 'modes') {
        const mouseTrackingMode =
          msg.mouseTrackingMode === 'x10' ||
          msg.mouseTrackingMode === 'vt200' ||
          msg.mouseTrackingMode === 'drag' ||
          msg.mouseTrackingMode === 'any'
            ? msg.mouseTrackingMode
            : 'none'
        onModesChanged?.({
          bracketedPasteMode: !!msg.bracketedPasteMode,
          altScreen: !!msg.altScreen,
          mouseTrackingMode,
          sgrMouseMode: !!msg.sgrMouseMode,
          sgrMousePixelsMode: !!msg.sgrMousePixelsMode
        })
      } else if (msg.type === 'terminal-input') {
        const bytes = typeof msg.bytes === 'string' ? msg.bytes : ''
        if (bytes.length > 0) {
          onTerminalInput?.(bytes)
        }
      } else if (msg.type === 'terminal-tap') {
        onTerminalTap?.()
      } else if (msg.type === 'terminal-file-tap') {
        const pathText = typeof msg.pathText === 'string' ? msg.pathText : ''
        if (pathText.length > 0) {
          const line = typeof msg.line === 'number' ? msg.line : null
          const column = typeof msg.column === 'number' ? msg.column : null
          onFileTap?.(pathText, line, column)
        }
      } else if (msg.type === 'open-url') {
        const url = typeof msg.url === 'string' ? msg.url : ''
        if (url.length > 0) {
          onOpenUrl?.(url)
        }
      } else if (msg.type === 'keyboard-avoidance-metrics') {
        const cursorY = typeof msg.cursorY === 'number' ? msg.cursorY : 0
        const rows = typeof msg.rows === 'number' ? msg.rows : 0
        onKeyboardAvoidanceMetrics?.({
          cursorY,
          rows,
          altScreen: !!msg.altScreen
        })
      } else if (msg.type === 'haptic') {
        const kind = msg.kind
        if (
          kind === 'selection' ||
          kind === 'success' ||
          kind === 'error' ||
          kind === 'edge-bump'
        ) {
          onHaptic?.(kind)
        }
      } else if (msg.type === 'font-scale-changed') {
        const scale = typeof msg.fontScale === 'number' ? msg.fontScale : 0
        if (scale > 0) {
          onTextScaleChange?.(scale)
        }
      } else if (msg.type === 'mobile-clip-cancel-by-pinch') {
        // eslint-disable-next-line no-console
        console.warn('[mobile-clip] selection cancelled by pinch')
      }
    },
    [
      flushPendingMessages,
      isWebReadyRef,
      measureResolveRef,
      onFileTap,
      onHaptic,
      onKeyboardAvoidanceMetrics,
      onModesChanged,
      onOpenUrl,
      onSelectionCopy,
      onSelectionEvicted,
      onSelectionMode,
      onTerminalInput,
      onTerminalTap,
      onTextScaleChange,
      onWebReady,
      readyPromiseRef,
      readyResolveRef,
      setWebViewError
    ]
  )
}
