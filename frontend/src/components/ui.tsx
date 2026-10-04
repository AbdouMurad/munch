// Little building blocks that many screens share.
// We build each one ONCE here and reuse it everywhere. Less copy-paste!

import { ReactNode, useEffect, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useGame } from '@/game';
import { useAppTheme } from '@/theme';

// ---------- Screen ----------
// The background of every screen. It keeps our stuff away from the phone's
// notch, and lets you scroll if the phone is too small to fit everything.
export function Screen({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.screenContent}>{children}</ScrollView>
    </SafeAreaView>
  );
}

// ---------- ChunkyBox ----------
// A box with an outline and a hard shadow peeking out to the bottom-right.
// This is the "chunky" look used by buttons and cards all over the app.
export function ChunkyBox({ children, background, radius = 16, style, shadow = true }: {
  children: ReactNode;
  background: string; // the color inside the box
  radius?: number; // how round the corners are
  style?: ViewStyle; // any extra rules for the box
  shadow?: boolean; // false = no shadow (e.g. cards under the top one in a pile)
}) {
  const { colors } = useAppTheme();
  return (
    // The wrapper leaves a little room on the right and bottom for the shadow.
    <View style={styles.chunkyWrapper}>
      {/* The shadow: a plain box sitting behind, nudged right and down. */}
      {shadow && (
        <View
          style={[styles.chunkyShadow, { backgroundColor: colors.shadow, borderRadius: radius }]}
        />
      )}
      {/* The real box, on top. */}
      <View
        style={[
          styles.chunkyFront,
          { backgroundColor: background, borderColor: colors.text, borderRadius: radius },
          style,
        ]}>
        {children}
      </View>
    </View>
  );
}

// ---------- ChunkyButton ----------
// A big button. "primary" is the loud main one, otherwise it's a quiet card-colored one.
export function ChunkyButton({ label, primary = false, onPress }: {
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress}>
      <ChunkyBox background={primary ? colors.primary : colors.card} style={styles.button}>
        {/* One line, centered. A label too long for the button ends in "…". */}
        <Text
          numberOfLines={1}
          style={[styles.buttonText, { color: primary ? colors.onPrimary : colors.text }]}>
          {label}
        </Text>
      </ChunkyBox>
    </Pressable>
  );
}

// ---------- BackButton ----------
// The little square "<" button in the top-left corner.
export function BackButton({ onPress }: { onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Go back"
      onPress={onPress}
      style={[styles.backButton, { backgroundColor: colors.card, borderColor: colors.text }]}>
      <Text style={[styles.backButtonText, { color: colors.text }]}>‹</Text>
    </Pressable>
  );
}

// ---------- Eye ----------
// Our mascot: a ring with a dot inside. It stands in for restaurant photos.
// "size" is how wide it is. Everything else is measured from that.
export function Eye({ size }: { size: number }) {
  const { colors } = useAppTheme();
  const dotSize = size * 0.45;
  return (
    <View
      style={[
        styles.eye,
        {
          width: size,
          height: size,
          borderRadius: size / 2, // half the size = a perfect circle
          borderWidth: size * 0.07,
          borderColor: colors.accent,
          backgroundColor: colors.card,
        },
      ]}>
      <View
        style={{
          width: dotSize,
          height: dotSize,
          borderRadius: dotSize / 2,
          backgroundColor: colors.dot,
        }}
      />
    </View>
  );
}

// ---------- Avatar ----------
// A circle with a friend's initials. "done" adds a small check badge.
export function Avatar({ initials, done = false }: { initials: string; done?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.avatar, { backgroundColor: colors.card, borderColor: colors.text }]}>
      <Text style={[styles.avatarText, { color: colors.text }]}>{initials}</Text>
      {done && (
        <View
          style={[styles.avatarBadge, { backgroundColor: colors.accent, borderColor: colors.text }]}>
          <Text style={[styles.avatarBadgeText, { color: colors.onAccent }]}>✓</Text>
        </View>
      )}
    </View>
  );
}

// ---------- ErrorLine ----------
// Shows a problem from the server (like "No room with that code").
// If there is no problem, it shows nothing at all.
export function ErrorLine() {
  const { colors } = useAppTheme();
  const { error } = useGame();
  if (!error) return null;
  return <Text style={[styles.error, { color: colors.accent }]}>{error}</Text>;
}

// ---------- DarkModeSwitch ----------
// An on/off switch for dark mode. The round knob slides across and shows a sun
// (light mode) or a moon (dark mode), drawn as text so it matches our colors.
const TRACK_WIDTH = 56;
const KNOB_SIZE = 22;
// How far the knob slides: the track, minus its outline and padding, minus the knob.
const KNOB_TRAVEL = TRACK_WIDTH - 2 * 2 - 2 * 2 - KNOB_SIZE;

export function DarkModeSwitch() {
  const { colors, isDark, toggleDark } = useAppTheme();

  // 0 = knob on the left (light), 1 = knob on the right (dark). It glides between them.
  const [slide] = useState(() => new Animated.Value(isDark ? 1 : 0));
  useEffect(() => {
    Animated.timing(slide, { toValue: isDark ? 1 : 0, duration: 180, useNativeDriver: false }).start();
  }, [slide, isDark]);
  const knobX = slide.interpolate({ inputRange: [0, 1], outputRange: [0, KNOB_TRAVEL] });

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel="Dark mode"
      accessibilityState={{ checked: isDark }}
      onPress={toggleDark}
      style={[
        styles.switchTrack,
        { backgroundColor: isDark ? colors.primary : colors.soft, borderColor: colors.text },
      ]}>
      <Animated.View
        style={[
          styles.switchKnob,
          { backgroundColor: colors.card, borderColor: colors.text, transform: [{ translateX: knobX }] },
        ]}>
        {/* "\uFE0E" asks for the plain text sun, not the colorful emoji one. */}
        <Text style={[styles.switchSymbol, { color: colors.text }]}>
          {isDark ? '☾' : '☀\uFE0E'}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

// ---------- ProgressBar ----------
// A bar that fills up. "fraction" goes from 0 (empty) to 1 (full).
export function ProgressBar({ fraction }: { fraction: number }) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.barTrack, { backgroundColor: colors.card, borderColor: colors.text }]}>
      <View
        style={[styles.barFill, { backgroundColor: colors.primary, width: `${fraction * 100}%` }]}
      />
    </View>
  );
}

// All the "how it looks" rules live down here.
// Colors are NOT here, because they change with light/dark mode.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  screenContent: {
    flexGrow: 1, // lets the content stretch to the full height of the phone
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 16,
  },

  chunkyWrapper: {
    marginRight: 6,
    marginBottom: 6,
  },
  chunkyShadow: {
    position: 'absolute', // sits behind the box...
    left: 6, // ...nudged right
    top: 6, // ...and down
    right: -6,
    bottom: -6,
  },
  chunkyFront: {
    borderWidth: 2,
    overflow: 'hidden', // keeps things inside from poking past the round corners
  },

  switchTrack: {
    width: TRACK_WIDTH,
    height: 30,
    borderRadius: 15, // fully round ends
    borderWidth: 2,
    padding: 2,
    justifyContent: 'center',
  },
  switchKnob: {
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2, // a circle
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchSymbol: {
    fontSize: 12,
    lineHeight: 14,
    fontWeight: '900',
  },

  button: {
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16, // so long words don't touch the edges
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '800',
    textAlign: 'center',
  },

  backButton: {
    width: 44,
    height: 44,
    borderWidth: 2,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backButtonText: {
    fontSize: 26,
    fontWeight: '800',
    lineHeight: 28,
  },

  eye: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 12,
    fontWeight: '800',
  },
  avatarBadge: {
    position: 'absolute', // sticks to the bottom-right corner of the avatar
    right: -5,
    bottom: -5,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBadgeText: {
    fontSize: 10,
    fontWeight: '900',
  },

  error: {
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },

  barTrack: {
    height: 12,
    borderWidth: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
  },
});
