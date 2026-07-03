import type { PropsWithChildren } from 'react'
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors, radii, spacing, typography } from '../theme/mobile-theme'

type Props = PropsWithChildren<{
  style?: StyleProp<ViewStyle>
  webViewError: string | null
}>

export function TerminalWebViewFrame({ children, style, webViewError }: Props) {
  return (
    <View style={[styles.container, style]}>
      {children}
      {webViewError ? (
        <View pointerEvents="none" style={styles.diagnostic}>
          <Text style={styles.diagnosticText} numberOfLines={3}>
            Terminal WebView error: {webViewError}
          </Text>
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.terminalBg
  },
  diagnostic: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    borderWidth: 1,
    borderColor: colors.statusRed,
    backgroundColor: colors.bgPanel
  },
  diagnosticText: {
    color: colors.textPrimary,
    fontSize: typography.metaSize,
    fontFamily: typography.monoFamily,
    lineHeight: spacing.lg
  }
})
