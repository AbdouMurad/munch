import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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

// How many cards sit in the pile at one time.
// You swipe through these, and when they are ALL gone, a fresh pile of this
// many cards falls down from the sky. The pile only ever gets SMALLER while you
// swipe, so a card never pops up out of nowhere at the bottom.
const HAND_SIZE = 10;

// How the new pile falls in:
const FALL_TIME = 250; // how long ONE card takes to fall, in milliseconds
const FALL_GAP = 50; // how long we wait before dropping the NEXT card

// Makes a list of "fall" numbers, one for each card in a new pile.
// Each one starts at 0 (= still up in the sky, out of sight)
// and later slides to 1 (= landed on the pile).
function makeFalls() {
  return Array.from({ length: HAND_SIZE }, () => new Animated.Value(0));
}

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

// Every card in the pile is turned a tiny bit, so the pile looks messy,
// like real cards somebody stacked in a hurry.
// The tilt LOOKS random, but it is worked out from the card's place in the deck,
// so the same card always gets the same tilt and never wobbles when the screen redraws.
function messyDegrees(placeInDeck: number) {
  return ((placeInDeck * 37) % 7) - 3; // always a number from -3 to 3
}
function messyTilt(placeInDeck: number) {
  return { rotate: `${messyDegrees(placeInDeck)}deg` };
}

// One printed restaurant card: a photo on top, the name and details underneath.
// "children" is anything extra to draw on top of the card (we use it for the glow).
function RestaurantCard({ card, children }: { card: Card; children?: ReactNode }) {
  const { colors } = useAppTheme();
  const photo = photoAddress(card);
  return (
    <ChunkyBox background={colors.card} radius={20}>
      {/* Top half: the restaurant photo. The eye mascot sits underneath,
          so it shows while the photo loads, or if there is no photo. */}
      <View style={[styles.photo, { backgroundColor: colors.soft }]}>
        <Eye size={160} />
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

      {/* Bottom half: the name and details. Every card is the SAME height, so
          they stack neatly. Long words get cut off with "..." (numberOfLines). */}
      <View style={styles.info}>
        <Text numberOfLines={2} style={[styles.restaurantName, { color: colors.text }]}>
          {card.name}
        </Text>
        {/* Something like "Ramen · $$ · 1.2 km" */}
        <Text numberOfLines={1} style={[styles.detail, { color: colors.softText }]}>
          {describe(card)}
        </Text>
        {card.rating && (
          <Text numberOfLines={1} style={[styles.detail, { color: colors.text }]}>
            ★ {card.rating} ({card.ratingCount} reviews)
          </Text>
        )}
        {card.address && (
          <Text numberOfLines={1} style={[styles.detail, { color: colors.softText }]}>
            {card.address}
          </Text>
        )}
      </View>

      {children}
    </ChunkyBox>
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

  // How far the card has been dragged sideways. 0 = resting in the middle,
  // a plus number = dragged right, a minus number = dragged left.
  // It's an "Animated" number, so things that follow it move smoothly.
  // Each new top card gets its OWN fresh dragX (see flyAway below).
  const [dragX, setDragX] = useState(() => new Animated.Value(0));

  // When a card becomes the top card, it straightens out (its crooked tilt
  // springs back to 0). 0 = still crooked like in the pile, 1 = perfectly straight.
  // Each new top card gets a fresh one that starts at 0 (see answer below).
  const [straighten, setStraighten] = useState(() => new Animated.Value(1));
  useEffect(() => {
    Animated.spring(straighten, { toValue: 1, friction: 7, useNativeDriver: false }).start();
  }, [straighten]);

  // Keep the next few photos downloading, so they're ready before their cards
  // show up (this also gets the NEXT hand's photos ready before it falls in).
  useEffect(() => {
    preloadPhotos(game.deck.slice(cardNumber + 1, cardNumber + 1 + PRELOAD_AHEAD));
  }, [cardNumber, game.deck]);

  // A "hand" is the little pile of (up to) 10 cards you are working through.
  // handStart = the place in the deck where this hand begins.
  // Example: handStart = 20 means this hand is cards 20, 21, ... 29.
  const [handStart, setHandStart] = useState(game.startAt);
  // Where this hand ends. Usually handStart + 10, but near the end of the
  // deck there might be fewer than 10 cards left.
  const handEnd = Math.min(handStart + HAND_SIZE, game.deck.length);

  // One "fall" number per card in the hand (see makeFalls above).
  // Every new hand gets brand new ones, so its cards start up in the sky.
  const [falls, setFalls] = useState(makeFalls);
  // True while the cards are still falling. We ignore swipes until they land.
  const [isDealing, setIsDealing] = useState(true);

  // Every time we get a new set of "falls" (= a new hand), drop the cards in.
  // (This also runs once when the screen first opens, so the very first
  // hand falls in too.)
  useEffect(() => {
    // The BOTTOM card falls first and the TOP card falls last, like dealing
    // cards onto a table. falls[0] is the top card, so we go backwards.
    const bottomFirst = [...falls].reverse();
    Animated.stagger(
      FALL_GAP, // start each card a little after the one before it
      bottomFirst.map((fall) =>
        Animated.timing(fall, {
          toValue: 1, // 1 = landed
          duration: FALL_TIME,
          easing: Easing.out(Easing.quad), // fast at first, gentle landing
          useNativeDriver: false, // same as the drag, so they can share a card
        }),
      ),
    ).start(() => setIsDealing(false)); // all landed: you can swipe now!
  }, [falls]);

  // Tell the server what we thought, then show the next card.
  // If that was the last card, go to the "done" screen.
  // (If EVERYONE liked this one, the server says so and game.tsx jumps to the winner.)
  function answer(liked: boolean) {
    game.swipe(card, liked);
    const nextCard = cardNumber + 1;

    if (nextCard >= game.deck.length) {
      // That was the very last card in the whole deck.
      router.replace('/done');
      return;
    }

    setCardNumber(nextCard);
    setStraighten(new Animated.Value(0)); // the new top card starts crooked, then straightens

    // Was that the last card in this hand? Then deal a new hand that starts
    // at the next card. New "falls" make the new cards drop in from the sky.
    if (nextCard >= handEnd) {
      setHandStart(nextCard);
      setFalls(makeFalls());
      setIsDealing(true); // no swiping until the new cards have landed
    }
  }

  // True while a card is flying off the screen. A second tap during that
  // fifth of a second is ignored, so one card can't be answered twice.
  // (A "ref" is a little box that remembers something without redrawing the screen.)
  const flying = useRef(false);

  // Slide the card off the side of the screen, THEN count the answer.
  // Buttons and swipes both use this.
  function flyAway(liked: boolean) {
    // Cards still falling, or a card already flying? Then this tap doesn't count.
    if (isDealing || flying.current) {
      springBack();
      return;
    }
    flying.current = true;
    Animated.timing(dragX, {
      toValue: liked ? 500 : -500, // far enough to be off the screen
      duration: 200, // takes 200 milliseconds (a fifth of a second)
      useNativeDriver: false,
    }).start(() => {
      answer(liked);
      // The next card becomes the top card. Give it a brand new dragX that
      // starts at 0 (the middle). We do NOT slide the old card back: it is
      // gone for good, so nothing jumps or flickers.
      setDragX(new Animated.Value(0));
      flying.current = false;
    });
  }

  // Let go too early (or the drag got interrupted)? The card bounces back to the middle.
  function springBack() {
    if (flying.current) return; // it's on its way out, leave it alone
    Animated.spring(dragX, { toValue: 0, useNativeDriver: false }).start();
  }

  // The finger-watcher (below) is made only ONCE, so a drag keeps working even
  // when the screen redraws in the middle of it (which happens every time a
  // friend swipes). It reads the latest card's dragX and functions from here.
  const latest = useRef({ dragX, flyAway, springBack });
  useEffect(() => {
    latest.current = { dragX, flyAway, springBack };
  });

  // This watches your finger on the card.
  const [panResponder] = useState(() =>
    PanResponder.create({
      // Only start a drag if the finger moves sideways a little.
      // (So a plain tap, or scrolling up and down, doesn't move the card.)
      onMoveShouldSetPanResponder: (_, finger) => Math.abs(finger.dx) > 5,
      // Don't let the scrolling screen steal the finger halfway through a drag.
      onPanResponderTerminationRequest: () => false,
      // While dragging: the card follows the finger. (dx = how far it has moved sideways)
      onPanResponderMove: (_, finger) => latest.current.dragX.setValue(finger.dx),
      // When the finger lets go: far right = yes, far left = nope, otherwise bounce back.
      onPanResponderRelease: (_, finger) => {
        if (finger.dx > SWIPE_DISTANCE) {
          latest.current.flyAway(true);
        } else if (finger.dx < -SWIPE_DISTANCE) {
          latest.current.flyAway(false);
        } else {
          latest.current.springBack();
        }
      },
      // Something interrupted the drag (the phone or browser took over)? Bounce back.
      onPanResponderTerminate: () => latest.current.springBack(),
    }),
  );

  // Not in a room (for example, the page was refreshed)? Go back home.
  if (!room) return <Redirect href="/" />;
  // No card left to show? Then we are done.
  if (!card) return <Redirect href="/done" />;


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
  // The cards we actually draw: every card LEFT in this hand.
  // Example: hand is cards 20-29 and we're on card 23 -> draw 23 to 29.
  // We never draw cards from the NEXT hand, so nothing appears at the bottom.
  // The list goes bottom card first, because things drawn LATER sit on TOP.
  const pile: number[] = [];
  for (let place = handEnd - 1; place >= cardNumber; place--) {
    pile.push(place);
  }

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

      {/* ---------- The pile of restaurant cards ---------- */}
      <View style={styles.cardArea}>
        <View style={styles.cardStack}>
          {pile.map((place) => {
            const isTop = place === cardNumber;

            // This card's own "fall" number. (place - handStart) is its spot
            // in the hand: 0 for the hand's first card, 9 for its last.
            const fall = falls[place - handStart];
            // fall 0 -> 700 pixels ABOVE its spot. fall 1 -> sitting on the pile.
            const fallY = fall.interpolate({
              inputRange: [0, 1],
              outputRange: [-700, 0],
            });
            // Hidden while it waits in the sky, then appears as it starts falling.
            const fallOpacity = fall.interpolate({
              inputRange: [0, 0.1, 1],
              outputRange: [0, 1, 1],
            });

            return (
              <Animated.View
                // The "key" is the card's name tag. It lets a card keep being the
                // same card when it moves up the pile, instead of being redrawn.
                key={game.deck[place].id}
                // Only the top card listens to your finger.
                // "panHandlers" is what connects it to the finger-watcher above.
                {...(isTop ? panResponder.panHandlers : {})}
                style={[
                  styles.stackedCard,
                  {
                    opacity: fallOpacity,
                    transform: isTop
                      ? // The top card falls in, then follows your finger and tilts...
                        [
                          { translateY: fallY },
                          { translateX: dragX },
                          { rotate: tilt },
                          {
                            rotate: straighten.interpolate({
                              inputRange: [0, 1],
                              outputRange: [`${messyDegrees(place)}deg`, '0deg'],
                            }),
                          },
                        ]
                      : // ...the cards underneath just fall in and sit there, a bit crooked.
                        [{ translateY: fallY }, messyTilt(place)],
                  },
                ]}>
                <RestaurantCard card={game.deck[place]}>
                  {/* Only the top card needs the glows. */}
                  {isTop && (
                    <>
                      {/* The GREEN glow. It covers the whole card and fades from
                          nothing (left side) to green (right side). It is invisible
                          until you drag right, because its opacity follows yesGlow. */}
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
                </RestaurantCard>
              </Animated.View>
            );
          })}
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
  // The pile's box. It has a fixed height because the cards inside are
  // "absolute" (stacked on top of each other), so they can't push it open.
  cardStack: {
    height: 386, // photo (220) + details (156) + outline and shadow (10)
    marginHorizontal: 12,
  },
  stackedCard: {
    position: 'absolute', // every card sits in the same spot, one on top of another
    top: 0,
    left: 0,
    right: 0,
    // On a computer, dragging across words would highlight them like in a
    // document. Cards aren't for reading-and-copying, so turn that off.
    userSelect: 'none',
  },
  glow: {
    position: 'absolute', // stretched over the whole card
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    pointerEvents: 'none', // touches go straight through it to the card
  },
  photo: {
    height: 220,
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
    // On a computer, dragging a picture makes the browser start its own
    // "drag this image" move, which cancels our swipe halfway. This makes the
    // mouse go straight through the picture to the card instead.
    pointerEvents: 'none',
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
  // Every line has an exact height, so the text always fits in the box:
  // padding 32 + name 2 x 28 + 3 small lines x 18 + 3 gaps x 4 = 154 (of 156).
  // Without exact heights, some fonts make the lines taller and the last
  // line (usually the address) gets cut off at the bottom.
  info: {
    height: 156,
    padding: 16,
    gap: 4,
  },
  restaurantName: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '900',
  },
  // The small lines under the name: "Ramen · $$ · 1.2 km", the rating, the address.
  detail: {
    fontSize: 14,
    lineHeight: 18,
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
