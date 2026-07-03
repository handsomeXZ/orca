import { useRef, useCallback, forwardRef, useImperativeHandle, useEffect, useMemo, useState } from 'react'
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import { WebView } from 'react-native-webview'
import type { RuntimeMobileTerminalTheme } from '../../../src/shared/runtime-types'
import { colors } from '../theme/mobile-theme'
import { TerminalWebViewFrame } from './TerminalWebViewFrame'
import type { TerminalOscLinkRange } from './terminal-osc-link-ranges'
import { useTerminalWebViewMessageHandler } from './terminal-webview-message-handler'
import type { TerminalWebViewCommand } from './terminal-webview-messages'
import { createTerminalWebViewPendingMessages } from './terminal-webview-pending-messages'
import { XTERM_WEBVIEW_SOURCE } from './terminal-webview-source'

type TerminalMouseTrackingMode = 'none' | 'x10' | 'vt200' | 'drag' | 'any'
type TerminalOscLinks = TerminalOscLinkRange[]

export type TerminalModes = {
  bracketedPasteMode: boolean
  altScreen: boolean
  mouseTrackingMode: TerminalMouseTrackingMode
  sgrMouseMode: boolean
  sgrMousePixelsMode: boolean
}

export type TerminalKeyboardAvoidanceMetrics = {
  cursorY: number
  rows: number
  altScreen: boolean
}

export type MobileTerminalTheme = RuntimeMobileTerminalTheme

export type TerminalSelectionEvents = {
  onSelectionMode?: (active: boolean) => void
  onSelectionCopy?: (text: string) => void
  onSelectionEvicted?: () => void
  onModesChanged?: (modes: TerminalModes) => void
  onKeyboardAvoidanceMetrics?: (metrics: TerminalKeyboardAvoidanceMetrics) => void
  onHaptic?: (kind: 'selection' | 'success' | 'error' | 'edge-bump') => void
  onTerminalInput?: (bytes: string) => void
  onTerminalTap?: () => void
  // Tap landed on a detected file path; RN resolves + opens it.
  onFileTap?: (pathText: string, line: number | null, column: number | null) => void
  // WebView-detected URL tap; RN chooses the mobile routing destination.
  onOpenUrl?: (url: string) => void
  // Why: pinch-to-zoom in the terminal snaps to a text-size preset and reports it
  // here so the app persists it and keeps Settings + other panes in sync.
  onTextScaleChange?: (scale: number) => void
}

export type TerminalWebViewHandle = {
  write: (data: string) => void
  init: (
    cols: number,
    rows: number,
    initialData?: string,
    preserveScroll?: boolean,
    oscLinks?: TerminalOscLinks
  ) => void
  resize: (cols: number, rows: number) => void
  // Why: reflow the local xterm buffer (scrollback included) to a new width
  // after a server-side PTY reflow, so older wrapped lines rewrap to match the
  // latest output. No-op on the alternate screen.
  reflow: (cols: number, rows: number) => void
  clear: () => void
  measureFitDimensions: (containerHeight?: number) => Promise<{ cols: number; rows: number } | null>
  resetZoom: () => void
  cancelSelect: () => void
  doSelectAll: () => void
  // Why: lets callers await the WebView-side `init` rAF chain (term.open
  // → renderService population → first paint) so a follow-up measure
  // doesn't race ahead and find term=null or cellWidth=0. Resolves on
  // the next 'ready' notify after the most recent init.
  awaitReady: () => Promise<void>
}

type Props = {
  style?: StyleProp<ViewStyle>
  terminalTheme?: MobileTerminalTheme
  // Why: baseline zoom multiplier ("text size") applied on top of the fit-to-width
  // scale; raw xterm fontSize can't drive apparent size because the fit cancels it.
  textScale?: number
  onWebReady?: () => void
} & TerminalSelectionEvents

export const TerminalWebView = forwardRef<TerminalWebViewHandle, Props>(function TerminalWebView(
  {
    style,
    terminalTheme,
    textScale = 1,
    onWebReady,
    onSelectionMode,
    onSelectionCopy,
    onSelectionEvicted,
    onModesChanged,
    onKeyboardAvoidanceMetrics,
    onHaptic,
    onTerminalInput,
    onTerminalTap,
    onFileTap,
    onOpenUrl,
    onTextScaleChange
  },
  ref
) {
  const webViewRef = useRef<WebView>(null)
  const isWebReadyRef = useRef(false)
  const pendingMessages = useMemo(() => createTerminalWebViewPendingMessages(), [])
  const messageIdRef = useRef(0)
  const [webViewError, setWebViewError] = useState<string | null>(null)
  const terminalThemeKey = useMemo(() => JSON.stringify(terminalTheme ?? null), [terminalTheme])
  const measureResolveRef = useRef<
    ((result: { cols: number; rows: number } | null) => void) | null
  >(null)
  // Why: each init() call posts 'init' to the WebView and arms a fresh
  // ready promise. WebView's init() rAF chain ends with a 'ready' notify
  // that resolves it. measureFitDimensions awaits this so it doesn't
  // race ahead of term.open() / renderService population.
  const readyPromiseRef = useRef<Promise<void> | null>(null)
  const readyResolveRef = useRef<(() => void) | null>(null)

  const sendToWebView = useCallback((msg: TerminalWebViewCommand) => {
    messageIdRef.current += 1
    webViewRef.current?.postMessage(JSON.stringify({ ...msg, id: messageIdRef.current }))
  }, [])

  const flushPendingMessages = useCallback(() => {
    pendingMessages.flush(sendToWebView)
  }, [pendingMessages, sendToWebView])

  const postMessage = useCallback(
    (msg: TerminalWebViewCommand) => {
      if (!isWebReadyRef.current) {
        pendingMessages.queue(msg)
        return
      }
      sendToWebView(msg)
    },
    [pendingMessages, sendToWebView]
  )

  const handleMessage = useTerminalWebViewMessageHandler({
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
  })

  const handleLoadStart = useCallback(() => {
    isWebReadyRef.current = false
    setWebViewError(null)
    // Why: messages queued for a previous WebView generation are stale after a reload;
    // dropping them avoids replaying terminal chunks before the next init snapshot.
    pendingMessages.clear()
  }, [pendingMessages])

  useEffect(() => {
    postMessage({ type: 'set-theme', terminalTheme })
  }, [postMessage, terminalThemeKey, terminalTheme])

  // Why: live-apply text-size changes to an already-mounted terminal (the pane
  // stays alive while the user visits Settings), so no terminal reload is needed.
  useEffect(() => {
    postMessage({ type: 'set-font-scale', fontScale: textScale })
  }, [postMessage, textScale])

  useImperativeHandle(
    ref,
    () => ({
      write(data: string) {
        postMessage({ type: 'write', data })
      },
      init(
        cols: number,
        rows: number,
        initialData?: string,
        preserveScroll?: boolean,
        oscLinks?: TerminalOscLinks
      ) {
        // Why: arm a fresh ready promise BEFORE posting init. The WebView
        // resolves it via the 'ready' notify at the end of its rAF chain.
        // Resolve any prior in-flight ready first so awaiters from the
        // previous generation don't sit on the 3s setTimeout fallback —
        // each leaked timer + closure pinned an awaiting measure caller
        // for the full 3s under rapid re-init (orientation change,
        // multiple resubscribes), delaying cold-start fit chains.
        const priorResolve = readyResolveRef.current
        if (priorResolve) {
          readyResolveRef.current = null
          readyPromiseRef.current = null
          priorResolve()
        }
        readyPromiseRef.current = new Promise<void>((resolve) => {
          readyResolveRef.current = resolve
        })
        postMessage({
          type: 'init',
          cols,
          rows,
          initialData,
          oscLinks,
          terminalTheme,
          fontScale: textScale,
          preserveScroll
        })
      },
      resize(cols: number, rows: number) {
        postMessage({ type: 'resize', cols, rows })
      },
      reflow(cols: number, rows: number) {
        postMessage({ type: 'reflow', cols, rows })
      },
      clear() {
        postMessage({ type: 'clear' })
      },
      measureFitDimensions(
        containerHeight?: number
      ): Promise<{ cols: number; rows: number } | null> {
        if (!isWebReadyRef.current) {
          return Promise.resolve(null)
        }
        return new Promise((resolve) => {
          measureResolveRef.current?.(null)
          let timeout: ReturnType<typeof setTimeout> | null = null
          const finish = (result: { cols: number; rows: number } | null) => {
            if (timeout) {
              clearTimeout(timeout)
              timeout = null
            }
            if (measureResolveRef.current === finish) {
              measureResolveRef.current = null
            }
            resolve(result)
          }
          measureResolveRef.current = finish
          sendToWebView({ type: 'measure', containerHeight })
          // Why: if the WebView doesn't respond within 2s (e.g., xterm
          // failed to load), resolve null so the caller can disable
          // Fit to Phone rather than hanging indefinitely.
          timeout = setTimeout(() => {
            if (measureResolveRef.current === finish) {
              finish(null)
            }
          }, 2000)
        })
      },
      resetZoom() {
        postMessage({ type: 'reset-zoom' })
      },
      cancelSelect() {
        postMessage({ type: 'cancel-select' })
      },
      doSelectAll() {
        postMessage({ type: 'do-select-all' })
      },
      async awaitReady(): Promise<void> {
        // Why: returns the in-flight ready promise (set by init); resolves
        // immediately if no init is pending. Capped at 3s so a stuck
        // WebView doesn't hang the caller.
        const p = readyPromiseRef.current
        if (!p) {
          return
        }
        await new Promise<void>((resolve) => {
          let settled = false
          const timeout = setTimeout(() => {
            settled = true
            resolve()
          }, 3000)
          void p.finally(() => {
            if (!settled) {
              clearTimeout(timeout)
              settled = true
              resolve()
            }
          })
        })
      }
    }),
    [postMessage, sendToWebView, terminalTheme, textScale]
  )

  return (
    <TerminalWebViewFrame style={style} webViewError={webViewError}>
      <WebView
        ref={webViewRef}
        source={XTERM_WEBVIEW_SOURCE}
        style={styles.webview}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        // Why: Android parent gesture containers can intercept vertical drags
        // before the injected xterm scroll router sees them.
        nestedScrollEnabled
        scalesPageToFit={false}
        // Why: Android WebView defaults textZoom to the system font scale, inflating
        // xterm's DOM glyphs past its canvas-measured cell grid (#4579). iOS ignores it.
        textZoom={100}
        onLoadStart={handleLoadStart}
        onMessage={handleMessage}
      />
    </TerminalWebViewFrame>
  )
})

const styles = StyleSheet.create({
  webview: {
    flex: 1,
    backgroundColor: colors.terminalBg
  }
})
