import { useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Our colors, in two boxes: one for light mode, one for dark mode.
// Both boxes have the SAME names, so the screen can use either one.
const LIGHT = {
  background: '#FFE55C', // sunny yellow
  card: '#FFFFFF',
  text: '#161616', // words, outlines, and shadows
  softText: '#4A4220', // quieter words
  accent: '#D93A21', // the red ring and the sticker
  dot: '#161616', // the dot in the middle of the ring
  onAccent: '#FFFFFF', // words that sit on the sticker
  primary: '#161616', // the "Start a game" button
  onPrimary: '#FFE55C', // words on that button
};

// Dark mode ("chili crisp"): dark brown, cream words, hot orange and gold.
const DARK = {
  background: '#160F0D',
  card: '#2A1A16',
  text: '#F8EBDB',
  softText: '#B9A898',
  accent: '#FF5A3C',
  dot: '#E8B04B',
  onAccent: '#160F0D',
  primary: '#FF5A3C',
  onPrimary: '#160F0D',
};

// A button is the same every time, only its words, colors, and job change.
// So we build it ONCE here and reuse it below. Less copy-paste!
function ChunkyButton({ label, background, textColor, outline, onPress }: {
  label: string;
  background: string;
  textColor: string;
  outline: string;
  onPress: () => void;
}) {
  return (
    <View style={styles.buttonWrapper}>
      {/* The box behind the button that peeks out to the bottom-right.
          That's how we get the chunky look! */}
      <View style={[styles.buttonShadow, { backgroundColor: outline }]} />
      <Pressable
        accessibilityRole="button"
        style={[styles.button, { backgroundColor: background, borderColor: outline }]}
        onPress={onPress}>
        <Text style={[styles.buttonText, { color: textColor }]}>{label}</Text>
      </Pressable>
    </View>
  );
}

// A "screen" is just a function that returns what we want to show.
export default function HomeScreen() {
  // Start in the same mode as the phone. The top-right button can flip it.
  const [isDark, setIsDark] = useState(useColorScheme() === 'dark');

  // Pick the right box of colors for the current mode.
  const colors = isDark ? DARK : LIGHT;

  return (
    // SafeAreaView keeps our stuff away from the phone's notch and bottom bar.
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* ---------- TOP: the app name and the light/dark button ---------- */}
      <View style={styles.topBar}>
        <Text style={[styles.appName, { color: colors.text }]}>munch</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          onPress={() => setIsDark(!isDark)}
          style={[styles.themeButton, { backgroundColor: colors.card, borderColor: colors.text }]}>
          <Text style={[styles.themeButtonText, { color: colors.text }]}>
            {isDark ? 'LIGHT' : 'DARK'}
          </Text>
        </Pressable>
      </View>

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
        <ChunkyButton
          label="Start a game"
          background={colors.primary}
          textColor={colors.onPrimary}
          outline={colors.text}
          // TODO: go to the "create a game" screen once it exists
          onPress={() => {}}
        />
        <ChunkyButton
          label="Join with a code"
          background={colors.card}
          textColor={colors.text}
          outline={colors.text}
          // TODO: go to the "enter a code" screen once it exists
          onPress={() => {}}
        />
        <Text style={[styles.footnote, { color: colors.softText }]}>
          Friends can join without an account
        </Text>
      </View>
    </SafeAreaView>
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
    marginTop: 8,
  },
  appName: {
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
  // The wrapper leaves a little room on the right and bottom for the shadow box.
  buttonWrapper: {
    marginRight: 6,
    marginBottom: 6,
  },
  buttonShadow: {
    position: 'absolute', // sits behind the button...
    left: 6, // ...nudged right
    top: 6, // ...and down
    right: -6,
    bottom: -6,
    borderRadius: 16,
  },
  button: {
    height: 58,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '800',
  },
  footnote: {
    fontSize: 13,
    textAlign: 'center',
  },
});
