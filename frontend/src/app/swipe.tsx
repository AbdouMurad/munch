import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { ReactNode, useEffect, useState } from 'react';
import {
  Animated,
  GestureResponderHandlers,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { Avatar, ChunkyBox, ErrorLine, Eye, Screen } from '@/components/ui';
import {
  Card,
  describe,
  initials,
  photoAddress,
  PRELOAD_AHEAD,
  preloadPhotos,
  useGame,
} from '@/game';
import { useAppTheme } from '@/theme';

// One of the round buttons under the card (nope, yes).
// It's only used on this screen, so it lives here.
function RoundButton({ symbol, label, background, symbolColor, onPress }: {
  symbol: string; // the little picture inside, like "♥"
  label: string; // what a screen reader says out loud
  background: string;
  symbolColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <ChunkyBox background={background} radius={32} style={styles.roundButton}>
        <Text style={[styles.roundButtonSymbol, { color: symbolColor }]}>{symbol}</Text>
      </ChunkyBox>
    </Pressable>
  );
}

// How far (in pixels) you must drag a card before it counts as an answer.
// Drag less than this and let go, and the card bounces back to the middle.
const SWIPE_DISTANCE = 120;

// Makes a "gradient": a color that fades from see-through to solid.
//   direction = which way it gets stronger ("right" or "left")
// Phones and web browsers spell this rule differently, so we write it both
// ways and each one reads the spelling it understands.
function fadeTo(direction: 'left' | 'right', color: string) {
  // The "00" on the end of a color means "completely see-through".
  const gradient = `linear-gradient(to ${direction}, ${color}00, ${color})`;
  return {
    experimental_backgroundImage: gradient, // phones
    backgroundImage: gradient, // web browsers
  } as ViewStyle;
}

// What one restaurant card looks like: photo on top, details underneath.
// The swipe screen draws TWO of these: the card you're looking at, and the next
// one hiding right under it. That way the next card (and its photo) is already
// drawn when the top one flies away, so it never shows up blank.
// "children" is for extra things drawn on top of the card (the yes/nope glows).
function RestaurantCard({ card, children }: { card: Card; children?: ReactNode }) {
  const { colors } = useAppTheme();
  const photo = photoAddress(card);
  return (
    <ChunkyBox background={colors.card} radius={20}>
      {/* Top half: the restaurant photo. The eye mascot sits underneath,
          so it shows while the photo loads, or if there is no photo. */}
      <View style={[styles.photo, { backgroundColor: colors.soft }]}>
        <Eye size={170} />
        {photo && (
          <Image
            source={photo}
            style={styles.photoImage}
            contentFit="cover" // fill the box, cropping the edges if needed
            transition={150} // fade in instead of popping in
            accessibilityLabel={`Photo of ${card.name}`}
          />
        )}
      </View>

      {/* Bottom half: the name and details. Every card is the SAME height, so the
          top card and the one under it always line up. Text that is too long gets
          cut off with "…" (numberOfLines) instead of making the card taller. */}
      <View style={styles.info}>
        <Text numberOfLines={2} style={[styles.restaurantName, { color: colors.text }]}>
          {card.name}
        </Text>
        {/* Something like "Ramen · $$ · 1.2 km" */}
        <Text numberOfLines={1} style={{ color: colors.softText }}>
          {describe(card)}
        </Text>
        {card.rating && (
          <Text numberOfLines={1} style={{ color: colors.text }}>
            ★ {card.rating} ({card.ratingCount} reviews)
          </Text>
        )}
        {card.address && (
          <Text numberOfLines={2} style={{ color: colors.softText }}>
            {card.address}
          </Text>
        )}
      </View>

      {children}
    </ChunkyBox>
  );
}

// How many cards the pile shows: the top one plus 3 underneath.
// As the deck runs out, the pile gets smaller: that's how you can see your progress.
const PILE_SIZE = 4;

// A number between -1 and 1 that is always the same for the same restaurant.
// Each card uses it for its own crooked angle, so a card keeps the same angle
// while it moves up the pile instead of jiggling around.
// "salt" just lets us get two different numbers out of one id.
function wobble(id: string, salt: number) {
  let n = salt;
  for (const letter of id) n = (n * 31 + letter.charCodeAt(0)) | 0;
  return (n % 1000) / 1000;
}

// One card in the pile.
//   depth 0 = the top card: straight, and it follows your finger ("drag")
//   depth 1 = right under it, depth 2 = under that, ...
// Cards further down sit a bit lower, a bit smaller and a bit crooked, like a
// real messy pile. When you swipe, every card moves up one spot and the new
// top card slides into place and straightens out by itself.
function StackCard({ card, depth, drag, children }: {
  card: Card;
  depth: number;
  drag?: {
    x: Animated.Value; // how far the top card is dragged sideways
    tilt: Animated.AnimatedInterpolation<string>; // the tilt that comes from dragging
    handlers: GestureResponderHandlers; // connects the card to the finger-watcher
  };
  children?: ReactNode; // extra things drawn on the card (the yes/nope glows)
}) {
  // "depth", but animated: when it changes, it glides from the old value to the new one.
  const [smoothDepth] = useState(() => new Animated.Value(depth));
  useEffect(() => {
    Animated.spring(smoothDepth, { toValue: depth, friction: 7, useNativeDriver: false }).start();
  }, [smoothDepth, depth]);

  // This card's own crooked angle and sideways nudge, for while it's in the pile.
  const crookedAngle = wobble(card.id, 1) * 6; // up to 6 degrees either way
  const nudge = wobble(card.id, 2) * 10; // up to 10 pixels either way

  // At depth 0 the card is straight and centered. From depth 1 down it has its
  // crooked angle and nudge, sits 12 px lower per level, and shrinks a little.
  const angle = smoothDepth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${crookedAngle}deg`],
    extrapolate: 'clamp',
  });
  const shiftX = smoothDepth.interpolate({
    inputRange: [0, 1],
    outputRange: [0, nudge],
    extrapolate: 'clamp',
  });
  const dropY = Animated.multiply(smoothDepth, 12);
  const size = smoothDepth.interpolate({
    inputRange: [0, PILE_SIZE - 1],
    outputRange: [1, 0.95],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      {...drag?.handlers}
      style={[
        depth > 0 && styles.underCard,
        {
          transform: [
            { translateX: drag ? drag.x : 0 },
            { translateX: shiftX },
            { translateY: dropY },
            { rotate: drag ? drag.tilt : '0deg' },
            { rotate: angle },
            { scale: size },
          ],
        },
      ]}>
      <RestaurantCard card={card}>{children}</RestaurantCard>
    </Animated.View>
  );
}

// SWIPE SCREEN: look at one restaurant at a time and say yes or no.
// You can answer two ways: tap a button, or drag the card left or right.
export default function SwipeScreen() {
  const { colors } = useAppTheme();

  const game = useGame();
  const room = game.room;

  // Which card we are looking at. 0 is the first one.
  // (The server tells us where to start, in case we are coming back mid-game.)
  const [cardNumber, setCardNumber] = useState(game.startAt);
  const card = game.deck[cardNumber];
  // The pile: the top card first, then the ones underneath it.
  const pile = game.deck.slice(cardNumber, cardNumber + PILE_SIZE);

  // How far the top card has been dragged sideways. 0 = resting in the middle,
  // a plus number = dragged right, a minus number = dragged left.
  // It's an "Animated" number, so things that follow it move smoothly.
  // Every new top card gets a brand new one that starts at 0 (see answer()).
  const [dragX, setDragX] = useState(() => new Animated.Value(0));

  // Keep the next few photos downloading, so they're ready before you swipe.
  // (Ones already downloaded are skipped, so this is cheap to repeat every card.)
  useEffect(() => {
    preloadPhotos(game.deck.slice(cardNumber + 1, cardNumber + 1 + PRELOAD_AHEAD));
  }, [cardNumber, game.deck]);

  // Not in a room (for example, the page was refreshed)? Go back home.
  if (!room) return <Redirect href="/" />;
  // No card left to show? Then we are done.
  if (!card) return <Redirect href="/done" />;

  // Tell the server what we thought, then show the next card.
  // If that was the last card, go to the "done" screen.
  // (If EVERYONE liked this one, the server says so and game.tsx jumps to the winner.)
  function answer(liked: boolean) {
    game.swipe(card, liked);
    if (cardNumber + 1 < game.deck.length) {
      setCardNumber(cardNumber + 1);
      // A fresh drag number for the new top card. (Setting the old one back to 0
      // would make the card that just flew away jump back for a split second.)
      setDragX(new Animated.Value(0));
    } else {
      router.replace('/done');
    }
  }

  // Slide the card off the side of the screen, THEN count the answer.
  // Buttons and swipes both use this.
  function flyAway(liked: boolean) {
    Animated.timing(dragX, {
      toValue: liked ? 500 : -500, // far enough to be off the screen
      duration: 200, // takes 200 milliseconds (a fifth of a second)
      useNativeDriver: false,
    }).start(() => answer(liked));
  }

  // This watches your finger on the card.
  const panResponder = PanResponder.create({
    // Only start a drag if the finger moves sideways a little.
    // (So a plain tap, or scrolling up and down, doesn't move the card.)
    onMoveShouldSetPanResponder: (_, finger) => Math.abs(finger.dx) > 5,
    // Don't let the scrolling screen steal the finger halfway through a drag.
    onPanResponderTerminationRequest: () => false,
    // While dragging: the card follows the finger. (dx = how far it has moved sideways)
    onPanResponderMove: (_, finger) => dragX.setValue(finger.dx),
    // When the finger lets go: far right = yes, far left = nope, otherwise bounce back.
    onPanResponderRelease: (_, finger) => {
      if (finger.dx > SWIPE_DISTANCE) {
        flyAway(true);
      } else if (finger.dx < -SWIPE_DISTANCE) {
        flyAway(false);
      } else {
        Animated.spring(dragX, { toValue: 0, useNativeDriver: false }).start();
      }
    },
  });

  // These numbers FOLLOW dragX. "interpolate" means: when dragX is this, I am that.
  // The card tilts a little as it moves, like a real card in your hand.
  const tilt = dragX.interpolate({
    inputRange: [-200, 0, 200],
    outputRange: ['-10deg', '0deg', '10deg'],
  });
  // The green glow: invisible in the middle, slowly appearing as the card goes right.
  // ("clamp" means it stops at the end numbers instead of going past them.)
  const yesGlow = dragX.interpolate({
    inputRange: [0, SWIPE_DISTANCE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  // The red glow: the same thing, but for going left.
  const nopeGlow = dragX.interpolate({
    inputRange: [-SWIPE_DISTANCE, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  // How many cards are left, counting the one we are looking at.
  const cardsLeft = game.deck.length - cardNumber;

  // Count the friends who have finished all their cards.
  const finishedCount = room.members.filter((m) => m.progress >= room.deckSize).length;

  return (
    <Screen>
      {/* ---------- TOP: lobby code and a way out ---------- */}
      <View style={styles.row}>
        <View>
          <Text style={[styles.gameName, { color: colors.text }]}>Lobby {room.code}</Text>
          <Text style={{ color: colors.softText }}>{room.members.length} players</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={game.leaveRoom}>
          <Text style={[styles.leave, { color: colors.text }]}>Leave</Text>
        </Pressable>
      </View>

      {/* ---------- How far along we are ---------- */}
      <View style={styles.progress}>
        <View style={styles.row}>
          <Text style={{ color: colors.softText }}>
            {cardsLeft} {cardsLeft === 1 ? 'card' : 'cards'} left
          </Text>
          <Text style={{ color: colors.softText }}>
            {finishedCount} of {room.members.length} finished
          </Text>
        </View>

        {/* One little circle per friend. A check means they are finished. */}
        <View style={styles.avatars}>
          {room.members.map((member) => (
            <Avatar
              key={member.id}
              initials={initials(member.displayName)}
              done={member.progress >= room.deckSize}
            />
          ))}
        </View>
      </View>

      {/* ---------- The restaurant card ---------- */}
      <View style={styles.cardArea}>
        {/* This box is exactly as big as the top card. The cards underneath
            copy its size and peek out below it. */}
        <View style={styles.cardStack}>
          {/* Every card in the pile is a REAL card, photo and all, so nothing
              has to be drawn (or change color) when it reaches the top.
              The "key" is the restaurant's id: when you swipe, React sees the
              same cards again, just one spot higher, and moves them instead of
              drawing them again from scratch. That's why photos never flash blank.
              We draw the bottom card first, so the top card is drawn last, on top. */}
          {pile
            .map((pileCard, depth) => (
              <StackCard
                key={pileCard.id}
                card={pileCard}
                depth={depth}
                drag={
                  depth === 0
                    ? { x: dragX, tilt, handlers: panResponder.panHandlers }
                    : undefined
                }>
                {depth === 0 && (
                  <>
                    {/* The GREEN glow. It covers the whole card and fades from nothing
                        (left side) to green (right side). It is invisible until you
                        drag right, because its opacity follows yesGlow. */}
                    <Animated.View
                      style={[styles.glow, fadeTo('right', colors.yes), { opacity: yesGlow }]}>
                      <View
                        style={[styles.sticker, styles.yesSticker, { borderColor: colors.card }]}>
                        <Text style={[styles.stickerText, { color: colors.card }]}>OH YES</Text>
                      </View>
                    </Animated.View>

                    {/* The RED glow: the mirror image, for dragging left. */}
                    <Animated.View
                      style={[styles.glow, fadeTo('left', colors.nope), { opacity: nopeGlow }]}>
                      <View
                        style={[styles.sticker, styles.nopeSticker, { borderColor: colors.card }]}>
                        <Text style={[styles.stickerText, { color: colors.card }]}>NOPE</Text>
                      </View>
                    </Animated.View>
                  </>
                )}
              </StackCard>
            ))
            .reverse()}
        </View>
      </View>

      <ErrorLine />

      {/* ---------- BOTTOM: nope and yes ---------- */}
      <View style={styles.buttons}>
        <RoundButton
          symbol="✕"
          label="Nope"
          background={colors.card}
          symbolColor={colors.text}
          onPress={() => flyAway(false)}
        />
        <RoundButton
          symbol="♥"
          label="Yes"
          background={colors.primary}
          symbolColor={colors.onPrimary}
          onPress={() => flyAway(true)}
        />
      </View>
      <Text style={[styles.hint, { color: colors.softText }]}>
        Swipe right for yes, left for no
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  // A row with one thing on the left and one thing on the right.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  gameName: {
    fontSize: 20,
    fontWeight: '900',
  },
  leave: {
    fontSize: 15,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },
  progress: {
    gap: 8,
  },
  avatars: {
    flexDirection: 'row',
    gap: 4,
  },

  cardArea: {
    flex: 1, // the card gets all the leftover space
    justifyContent: 'center',
  },
  cardStack: {
    marginHorizontal: 10,
    marginBottom: 40, // room for the pile to peek out underneath
  },
  glow: {
    position: 'absolute', // stretched over the whole card
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    pointerEvents: 'none', // touches go straight through it to the card
  },
  // Cards under the top one sit exactly where the top card is (their own
  // tilt and drop are added on top of that).
  underCard: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    pointerEvents: 'none', // you can only drag the top card
  },
  photo: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The picture covers the whole photo box, on top of the mascot.
  photoImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sticker: {
    position: 'absolute', // pinned near the top of the card
    top: 18,
    borderWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  // "OH YES" sits on the green (right) side, "NOPE" on the red (left) side.
  yesSticker: {
    right: 16,
    transform: [{ rotate: '8deg' }],
  },
  nopeSticker: {
    left: 16,
    transform: [{ rotate: '-8deg' }],
  },
  stickerText: {
    fontSize: 22,
    fontWeight: '900',
  },
  info: {
    // Fixed, so every card is the same size. Fits the longest card allowed:
    // a 2-line name, the details, the rating and a 2-line address.
    height: 190,
    padding: 16,
    gap: 6,
  },
  restaurantName: {
    fontSize: 26,
    lineHeight: 30, // set exactly, so 2 lines of name always take the same space
    fontWeight: '900',
  },

  buttons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
  },
  roundButton: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundButtonSymbol: {
    fontSize: 26,
    fontWeight: '900',
  },
  hint: {
    fontSize: 13,
    textAlign: 'center',
  },
});
