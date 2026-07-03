import { Platform } from 'react-native'
import { XTERM_HTML, XTERM_HTML_ANDROID } from './terminal-webview-html'

// Why: WebView treats source identity as page identity on some platforms; keep
// parent/session re-renders from reloading xterm and forcing fresh snapshots.
const XTERM_DEFAULT_WEBVIEW_SOURCE = { html: XTERM_HTML }
const XTERM_ANDROID_WEBVIEW_SOURCE = { html: XTERM_HTML_ANDROID }

export const XTERM_WEBVIEW_SOURCE =
  Platform.OS === 'android' ? XTERM_ANDROID_WEBVIEW_SOURCE : XTERM_DEFAULT_WEBVIEW_SOURCE
