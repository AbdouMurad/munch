import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { InvitesInbox } from '@/components/account-ui';
import { ChunkyButton } from '@/components/ui';
import { useAppTheme } from '@/theme';

// PLAY PAGE: the middle page of the home screen. Start a game or join one.
// (Profile is one swipe to the right, Friends one swipe to the left.)
export default function PlayPage() {
  // Grab our colors, and the switch that flips light/dark mode.
  const { colors, isDark, toggleDark } = useAppTheme();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* ---------- TOP: the app name and the light/dark button ---------- */}
      <View style={styles.topBar}>
        <Text style={[styles.appName, { color: colors.text }]}>munch</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          onPress={toggleDark}
          style={[styles.themeButton, { backgroundColor: colors.card, borderColor: colors.text }]}>
          <Text style={[styles.themeButtonText, { color: colors.text }]}>
            {isDark ? 'LIGHT' : 'DARK'}
          </Text>
        </Pressable>
      </View>

      {/* Friends asking you to join their game (only when signed in). */}
      <InvitesInbox />

      {/* ---------- MIDDLE: the picture and the words ---------- */}
      <View style={styles.middle}>
        {/* The picture is made of 3 boxes stacked on top of each other. */}
        <View style={styles.illustration}>
          {/* Box 1: the card hiding at the back, tilted a little */}
          <View
            style={[
              styles.card,
              styles.backCard,
              { backgroundColor: colors.card, borderColor: colors.text },
            ]}
          />

          {/* Box 2: the front card, tilted the other way */}
          <View
            style={[
              styles.card,
              styles.frontCard,
              { backgroundColor: colors.card, borderColor: colors.text },
            ]}>
            {/* A ring (a circle with just a colored edge)... */}
            <View style={[styles.ring, { borderColor: colors.accent }]}>
              {/* ...with a dot inside it. */}
              <View style={[styles.dot, { backgroundColor: colors.dot }]} />
            </View>
          </View>

          {/* Box 3: the "OH YES" sticker in the top-right corner */}
          <View
            style={[styles.sticker, { backgroundColor: colors.accent, borderColor: colors.text }]}>
            <Text style={[styles.stickerText, { color: colors.onAccent }]}>OH YES</Text>
          </View>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>
          Swipe together.{'\n'}Eat together.
        </Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          Everyone swipes the same spots. The place your group agrees on most wins.
        </Text>
      </View>

      {/* ---------- BOTTOM: the buttons ---------- */}
      <View style={styles.bottom}>
        <ChunkyButton label="Start a game" primary onPress={() => router.push('/create')} />
        <ChunkyButton label="Join with a code" onPress={() => router.push('/join')} />
        <Text style={[styles.footnote, { color: colors.softText }]}>
          Friends can join without an account
        </Text>
      </View>
    </View>
  );
}

// All the "how it looks" rules live down here.
// Colors are NOT here, because they change with light/dark mode (see above).
// Only sizes, spacing, and positions live here, because those never change.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: 20,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 8,
  },
  appName: {
    flex: 1, // pushes the buttons to the right
    fontSize: 22,
    fontWeight: '900',
  },
  themeButton: {
    borderWidth: 2,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  themeButtonText: {
    fontSize: 12,
    fontWeight: '900',
  },

  // The middle part grows to fill the leftover space and centers its stuff.
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  illustration: {
    width: 240,
    height: 260,
    marginBottom: 24,
  },

  // Both cards share this: rounded, with an outline.
  card: {
    position: 'absolute', // "absolute" lets boxes overlap each other
    width: 200,
    height: 220,
    borderWidth: 2,
    borderRadius: 18,
  },
  backCard: {
    left: 20,
    top: 30,
    transform: [{ rotate: '8deg' }],
  },
  frontCard: {
    left: 5,
    top: 20,
    transform: [{ rotate: '-5deg' }],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A circle = a square with really round corners (borderRadius = half the size).
  ring: {
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 58,
    height: 58,
    borderRadius: 29,
  },
  sticker: {
    position: 'absolute',
    top: 0,
    right: -10,
    borderWidth: 2,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    transform: [{ rotate: '8deg' }],
  },
  stickerText: {
    fontWeight: '900',
    fontSize: 16,
  },

  title: {
    fontSize: 38,
    fontWeight: '900',
    textAlign: 'center',
    lineHeight: 42,
  },
  subtitle: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 12,
    paddingHorizontal: 8,
  },

  bottom: {
    gap: 14,
    paddingBottom: 8,
  },
  footnote: {
    fontSize: 13,
    textAlign: 'center',
  },
});
