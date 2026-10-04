import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  GestureResponderHandlers,
  PanResponder,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CARD_HEIGHT, messyDegrees, RestaurantCard } from '@/components/restaurant-card';
import { Card } from '@/game';
import { useAppTheme } from '@/theme';

// One restaurant in the results: the card, its sticker ("♛ WINNER", "TOP PICK", ...)
// and how many friends liked it.
export type ResultItem = { card: Card; sticker: string; likes: number };

// How far (in pixels) you drag the top card before it goes to the bottom of the pile.
const SWIPE_DISTANCE = 100;
// How many cards peek out under the top one. The rest hide behind the last of these.
const PEEKING = 3;

// RESULTS STACK: every restaurant we ended up with, as a pile of cards.
// Swipe the top card left or right and it goes to the BOTTOM of the pile, so
// you can flip through them all, round and round. "flipRef" lets the screen
// flip to the next card with a button too (handy on a computer).
// "onTopChange" tells the screen which restaurant is on top (for its Directions button).
export function ResultStack({ items, memberCount, onTopChange, flipRef }: {
  items: ResultItem[];
  memberCount: number; // how many friends played, for "2 of 3 said yes"
  onTopChange: (restaurantId: string) => void;
  flipRef: React.RefObject<(() => void) | null>;
}) {
  // The pile, as places in "items": the first number is the top card.
  const [order, setOrder] = useState(() => items.map((_, i) => i));
  // How far the top card is dragged sideways. Every new top card gets a fresh one.
  const [dragX, setDragX] = useState(() => new Animated.Value(0));
  // True while a card is flying off, so a second swipe or tap can't double up.
  const flying = useRef(false);

  // Tell the screen whenever a different card comes to the top.
  const topId = items[order[0]].card.id;
  useEffect(() => {
    onTopChange(topId);
  }, [topId, onTopChange]);

  // Send the top card off the side, then put it at the bottom of the pile.
  function flip(toTheRight: boolean) {
    if (flying.current || items.length < 2) {
      springBack();
      return;
    }
    flying.current = true;
    Animated.timing(dragX, {
      toValue: toTheRight ? 500 : -500,
      duration: 200,
      useNativeDriver: false,
    }).start(() => {
      setOrder((old) => [...old.slice(1), old[0]]);
      setDragX(new Animated.Value(0));
      flying.current = false;
    });
  }

  // Let go too early (or the drag got interrupted)? The card bounces back.
  function springBack() {
    if (flying.current) return;
    Animated.spring(dragX, { toValue: 0, useNativeDriver: false }).start();
  }

  // The finger-watcher is made only ONCE (so a redraw mid-drag can't break it),
  // and reads the latest dragX and functions from here. Same as the swipe screen.
  const latest = useRef({ dragX, flip, springBack });
  useEffect(() => {
    latest.current = { dragX, flip, springBack };
    flipRef.current = () => flip(false);
  });
  const [panResponder] = useState(() =>
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, finger) => Math.abs(finger.dx) > 5,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, finger) => latest.current.dragX.setValue(finger.dx),
      onPanResponderRelease: (_, finger) => {
        if (Math.abs(finger.dx) > SWIPE_DISTANCE) {
          latest.current.flip(finger.dx > 0);
        } else {
          latest.current.springBack();
        }
      },
      onPanResponderTerminate: () => latest.current.springBack(),
    }),
  );

  // The card tilts a little as you drag it, like on the swipe screen.
  const tilt = dragX.interpolate({
    inputRange: [-200, 0, 200],
    outputRange: ['-10deg', '0deg', '10deg'],
  });

  return (
    <View style={styles.pile}>
      {/* Bottom card first: things drawn later sit on top. */}
      {[...order].reverse().map((itemIndex) => {
        const depth = order.indexOf(itemIndex);
        return (
          <PileCard
            // The restaurant's id, so a card stays the SAME card as it moves around
            // the pile (it slides to its new spot instead of being drawn again).
            key={items[itemIndex].card.id}
            item={items[itemIndex]}
            tilt={messyDegrees(itemIndex)}
            depth={depth}
            drag={depth === 0 ? { x: dragX, tilt, handlers: panResponder.panHandlers } : undefined}>
            <Stickers item={items[itemIndex]} memberCount={memberCount} />
          </PileCard>
        );
      })}
    </View>
  );
}

// One card in the pile. depth 0 = on top (straight, follows your finger),
// 1 = just under it, and so on. Deeper cards sit lower, smaller and a bit
// crooked. When a card's depth changes, it glides to its new spot.
function PileCard({ item, tilt, depth, drag, children }: {
  item: ResultItem;
  tilt: number; // this card's own crooked angle, in degrees
  depth: number;
  drag?: {
    x: Animated.Value;
    tilt: Animated.AnimatedInterpolation<string>;
    handlers: GestureResponderHandlers;
  };
  children: ReactNode;
}) {
  // "depth", but animated: it springs from the old value to the new one.
  const [smoothDepth] = useState(() => new Animated.Value(depth));
  useEffect(() => {
    Animated.spring(smoothDepth, { toValue: depth, friction: 7, useNativeDriver: false }).start();
  }, [smoothDepth, depth]);

  const dropY = smoothDepth.interpolate({
    inputRange: [0, PEEKING],
    outputRange: [0, PEEKING * 10],
    extrapolate: 'clamp',
  });
  const size = smoothDepth.interpolate({
    inputRange: [0, PEEKING],
    outputRange: [1, 0.94],
    extrapolate: 'clamp',
  });
  const angle = smoothDepth.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${tilt}deg`],
    extrapolate: 'clamp',
  });

  return (
    <Animated.View
      {...drag?.handlers}
      style={[
        styles.card,
        depth > 0 && styles.under,
        {
          transform: [
            { translateX: drag ? drag.x : 0 },
            { translateY: dropY },
            { rotate: drag ? drag.tilt : '0deg' },
            { rotate: angle },
            { scale: size },
          ],
        },
      ]}>
      <RestaurantCard card={item.card}>{children}</RestaurantCard>
    </Animated.View>
  );
}

// The sticker in the top-left corner ("♛ WINNER") and the likes in the top-right.
function Stickers({ item, memberCount }: { item: ResultItem; memberCount: number }) {
  const { colors } = useAppTheme();
  return (
    <>
      <View style={[styles.sticker, { backgroundColor: colors.accent, borderColor: colors.text }]}>
        <Text style={[styles.stickerText, { color: colors.onAccent }]}>{item.sticker}</Text>
      </View>
      <View style={[styles.likes, { backgroundColor: colors.card, borderColor: colors.text }]}>
        <Text style={[styles.likesText, { color: colors.text }]}>
          ♥ {item.likes} of {memberCount}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // Tall enough for one card plus the cards peeking out underneath.
  pile: {
    height: CARD_HEIGHT + PEEKING * 10,
  },
  card: {
    position: 'absolute', // every card sits in the same spot, one on top of another
    top: 0,
    left: 0,
    right: 0,
    userSelect: 'none', // dragging with a mouse shouldn't highlight the words
  },
  under: {
    pointerEvents: 'none', // you can only drag the top card
  },
  sticker: {
    position: 'absolute', // pinned to the top-left corner of the photo
    top: 14,
    left: 14,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 3,
    transform: [{ rotate: '-6deg' }],
  },
  stickerText: {
    fontSize: 18,
    fontWeight: '900',
  },
  likes: {
    position: 'absolute', // pinned to the top-right corner of the photo
    top: 14,
    right: 14,
    borderWidth: 2,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  likesText: {
    fontSize: 14,
    fontWeight: '900',
  },
});
