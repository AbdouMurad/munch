import Constants from 'expo-constants';
import { router } from 'expo-router';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { CardTaxi, Logo, useCity } from '@/city';
import { InvitesInbox } from '@/components/account-ui';
import { ChunkyButton, DarkModeSwitch } from '@/components/ui';
import { useAppTheme } from '@/theme';

// PLAY PAGE: the middle page of the home screen. Start a game or join one.
// (Profile is one swipe to the right, Friends one swipe to the left.)
export default function PlayPage() {
  // Grab our colors.
  const { colors } = useAppTheme();
  // Which special city we're in (Vancouver, Toronto, Edmonton), or null for none.
  const city = useCity();
  // A short phone (like an iPhone SE) doesn't have room for the full-size picture and
  // big words above the bar at the bottom, so they shrink to fit.
  const { height } = useWindowDimensions();
  const compact = height < 760;
  const pictureScale = compact ? 0.7 : 1;
  // Which version of the code this is (stamped on when the app is built, see
  // app.config.js). Not stamped, like while we're developing? Then don't show it.
  const version = Constants.expoConfig?.extra?.version;

  return (
    // Scrolls if it STILL doesn't fit (a tiny screen), instead of things overlapping.
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.screen}
      showsVerticalScrollIndicator={false}>
      {/* ---------- TOP: the app name and the dark mode switch ---------- */}
      <View style={styles.topBar}>
        {/* The logo. In Vancouver, Toronto or Edmonton it's that city's special
            logo; anywhere else it's just the word "munch" (see city.tsx). */}
        <View style={styles.appName}>
          <Logo />
        </View>
        {/* On/off switch for dark mode: a sun or a moon slides across. */}
        <DarkModeSwitch />
      </View>

      {/* Friends asking you to join their game (only when signed in). */}
      <InvitesInbox />

      {/* ---------- MIDDLE: the picture and the words ---------- */}
      <View style={styles.middle}>
        {/* The picture is made of 3 boxes stacked on top of each other.
            On a short phone it's drawn smaller ("scale"), in a shorter box. */}
        <View style={[styles.pictureBox, { height: 260 * pictureScale }]}>
          <View style={[styles.illustration, { transform: [{ scale: pictureScale }] }]}>
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
              {city ? (
                // In a special city: that city's taxi drives across the card.
                <CardTaxi width={184} />
              ) : (
                // Anywhere else: the bullseye. A ring (a circle with just a colored edge)...
                <View style={[styles.ring, { borderColor: colors.accent }]}>
                  {/* ...with a dot inside it. */}
                  <View style={[styles.dot, { backgroundColor: colors.dot }]} />
                </View>
              )}
            </View>

            {/* Box 3: the "OH YES" sticker in the top-right corner */}
            <View
              style={[styles.sticker, { backgroundColor: colors.accent, borderColor: colors.text }]}>
              <Text style={[styles.stickerText, { color: colors.onAccent }]}>OH YES</Text>
            </View>
          </View>
        </View>

        <Text style={[styles.title, compact && styles.titleCompact, { color: colors.text }]}>
          Swipe together.{'\n'}Eat together.
        </Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          Everyone swipes the same spots. The first place most of you like wins.
        </Text>
      </View>

      {/* ---------- BOTTOM: the buttons ---------- */}
      <View style={styles.bottom}>
        <ChunkyButton label="Start a game" primary onPress={() => router.push('/create')} />
        <ChunkyButton label="Join with a code" onPress={() => router.push('/join')} />
        <Text style={[styles.footnote, { color: colors.softText }]}>
          Friends can join without an account
        </Text>
        {/* Which version of the code this is (the latest git commit), in tiny
            faint letters. It's only here to help us when something goes wrong:
            "what does it say at the bottom of your home screen?" */}
        {version && (
          <Text style={[styles.version, { color: colors.softText }]}>version {version}</Text>
        )}
      </View>
    </ScrollView>
  );
}

// All the "how it looks" rules live down here.
// Colors are NOT here, because they change with light/dark mode (see above).
// Only sizes, spacing, and positions live here, because those never change.
const styles = StyleSheet.create({
  screen: {
    flexGrow: 1, // fill the page, but grow taller (and scroll) if it has to
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
    alignItems: 'flex-start', // keep the logo on the left, at its own size
  },
  // The middle part grows to fill the leftover space and centers its stuff.
  middle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Holds the picture. Its height shrinks with the picture on short phones.
  pictureBox: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  illustration: {
    width: 240,
    height: 260,
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
  titleCompact: {
    fontSize: 30,
    lineHeight: 34,
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
  version: {
    fontSize: 10,
    textAlign: 'center',
    opacity: 0.6, // faint, so it doesn't draw attention
  },
});
