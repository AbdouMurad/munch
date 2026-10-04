import { Image } from 'expo-image';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ChunkyBox, Eye } from '@/components/ui';
import { Card, describe, photoAddress } from '@/game';
import { useAppTheme } from '@/theme';

// How tall one card is, so a box can hold a pile of them stacked on top of each other:
// photo (220) + details (156) + outline and shadow (10).
export const CARD_HEIGHT = 386;

// Every card in the pile is turned a tiny bit, so the pile looks messy,
// like real cards somebody stacked in a hurry.
// The tilt LOOKS random, but it is worked out from the card's place in the deck,
// so the same card always gets the same tilt and never wobbles when the screen redraws.
export function messyDegrees(placeInDeck: number) {
  return ((placeInDeck * 37) % 7) - 3; // always a number from -3 to 3
}
export function messyTilt(placeInDeck: number) {
  return { rotate: `${messyDegrees(placeInDeck)}deg` };
}

// One printed restaurant card: a photo on top, the name and details underneath.
// "showPhoto" is false for cards buried deep in a pile, so they don't load a photo
// nobody can see (the swipe screen's CARDS_WITH_PHOTOS). Leave it out to show it.
// "children" is anything extra to draw on top of the card (the swipe glows, stickers).
// Used by the swipe screen and the results stack, so both look exactly the same.
export function RestaurantCard({ card, showPhoto = true, children }: {
  card: Card;
  showPhoto?: boolean;
  children?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const photo = showPhoto ? photoAddress(card) : null;
  return (
    <ChunkyBox background={colors.card} radius={20}>
      {/* Top half: the restaurant photo. The eye mascot sits underneath,
          so it shows while the photo loads, or if there is no photo
          (or if this card is too deep in the pile to bother with one). */}
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

const styles = StyleSheet.create({
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
});
