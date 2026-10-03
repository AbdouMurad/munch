import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Our colors. Having them in one place means we can change them easily later!
const YELLOW = '#FFE55C'; // the sunny background
const BLACK = '#161616'; // text, borders, and shadows
const RED = '#D93A21'; // the ring and the "OH YES" sticker
const WHITE = '#FFFFFF';
const DARK_BACKGROUND = '#20201D';
const DARK_TEXT = '#FFF8D6';
const DARK_CARD = '#34332D';
const DARK_SECONDARY = '#D8CF9A';

// A "screen" is just a function that returns what we want to show.
export default function HomeScreen() {
  const [isDark, setIsDark] = useState(false);
  const colors = isDark
    ? {
        background: DARK_BACKGROUND,
        text: DARK_TEXT,
        card: DARK_CARD,
        secondary: DARK_SECONDARY,
      }
    : {
        background: YELLOW,
        text: BLACK,
        card: WHITE,
        secondary: '#4A4220',
      };

  return (
    // SafeAreaView keeps our stuff away from the phone's notch and bottom bar.
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      {/* ---------- TOP: the app name and theme toggle ---------- */}
      <View style={styles.topBar}>
        <Text style={[styles.appName, { color: colors.text }]}>munch</Text>
        <Pressable
          accessibilityLabel={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
          accessibilityRole="button"
          onPress={() => setIsDark((current) => !current)}
          style={[styles.themeButton, { backgroundColor: colors.card, borderColor: colors.text }]}
        >
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
          <View style={[styles.card, styles.backCard, { backgroundColor: colors.card, borderColor: colors.text, shadowColor: colors.text }]} />

          {/* Box 2: the front card, tilted the other way */}
          <View style={[styles.card, styles.frontCard, { backgroundColor: colors.card, borderColor: colors.text, shadowColor: colors.text }]}>
            {/* A red ring (a circle with just a red edge)... */}
            <View style={styles.ring}>
              {/* ...with a black dot inside it. */}
                <View style={[styles.dot, { backgroundColor: colors.text }]} />
            </View>
          </View>

          {/* Box 3: the red "OH YES" sticker in the top-right corner */}
          <View style={[styles.sticker, { borderColor: colors.text }]}>
            <Text style={styles.stickerText}>OH YES</Text>
          </View>
        </View>

        <Text style={[styles.title, { color: colors.text }]}>Swipe together.{'\n'}Eat together.</Text>
        <Text style={[styles.subtitle, { color: colors.secondary }]}>
          Everyone swipes the same spots. The place your group agrees on most wins.
        </Text>
      </View>

      {/* ---------- BOTTOM: the buttons ---------- */}
      <View style={styles.bottom}>
        {/* Each button sits on top of a black "shadow" box that peeks out
            to the bottom-right. That's how we get the chunky look! */}
        <View style={styles.buttonWrapper}>
          <View style={[styles.buttonShadow, { backgroundColor: colors.text }]} />
          <Pressable
            style={[styles.button, { backgroundColor: colors.text, borderColor: colors.text }]}
            // TODO: go to the "create a game" screen once it exists
            onPress={() => console.log('Start a game!')}>
            <Text style={[styles.buttonText, { color: colors.background }]}>Start a game</Text>
          </Pressable>
        </View>

        <View style={styles.buttonWrapper}>
          <View style={[styles.buttonShadow, { backgroundColor: colors.text }]} />
          <Pressable
            style={[styles.button, { backgroundColor: colors.card, borderColor: colors.text }]}
            // TODO: go to the "enter a code" screen once it exists
            onPress={() => console.log('Join with a code!')}>
            <Text style={[styles.buttonText, { color: colors.text }]}>Join with a code</Text>
          </Pressable>
        </View>

        <Text style={[styles.footnote, { color: colors.secondary }]}>Friends can join without an account</Text>
      </View>
    </SafeAreaView>
  );
}

// All the "how it looks" rules live down here.
const styles = StyleSheet.create({
  // The whole screen: yellow, with some space on the left and right.
  screen: {
    flex: 1,
    backgroundColor: YELLOW,
    paddingHorizontal: 20,
  },
  appName: {
    fontSize: 22,
    fontWeight: '900',
    color: BLACK,
    marginTop: 8,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  themeButton: {
    marginTop: 8,
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

  // Both cards share this: white, rounded, black outline, and a black shadow.
  card: {
    position: 'absolute', // "absolute" lets boxes overlap each other
    width: 200,
    height: 220,
    backgroundColor: WHITE,
    borderWidth: 2,
    borderColor: BLACK,
    borderRadius: 18,
    shadowColor: BLACK,
    shadowOffset: { width: 6, height: 6 },
    shadowOpacity: 1,
    shadowRadius: 0, // 0 = sharp edge, not blurry
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
    borderColor: RED,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: BLACK,
  },
  sticker: {
    position: 'absolute',
    top: 0,
    right: -10,
    backgroundColor: RED,
    borderWidth: 2,
    borderColor: BLACK,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    transform: [{ rotate: '8deg' }],
  },
  stickerText: {
    color: WHITE,
    fontWeight: '900',
    fontSize: 16,
  },

  title: {
    fontSize: 38,
    fontWeight: '900',
    color: BLACK,
    textAlign: 'center',
    lineHeight: 42,
  },
  subtitle: {
    fontSize: 15,
    color: '#4A4220',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 12,
    paddingHorizontal: 8,
  },

  bottom: {
    gap: 14,
    paddingBottom: 8,
  },
  // The wrapper is a bit shorter/narrower than its shadow so the shadow can peek out.
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
    backgroundColor: BLACK,
    borderRadius: 16,
  },
  button: {
    height: 58,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: BLACK,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '800',
  },
  footnote: {
    fontSize: 13,
    color: '#4A4220',
    textAlign: 'center',
  },
});
