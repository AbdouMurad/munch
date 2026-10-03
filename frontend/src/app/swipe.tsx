import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, ChunkyBox, ErrorLine, Eye, ProgressBar, Screen } from '@/components/ui';
import { describe, initials, useGame } from '@/game';
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

// SWIPE SCREEN: look at one restaurant at a time and say yes or no.
export default function SwipeScreen() {
  const { colors } = useAppTheme();

  const game = useGame();
  const room = game.room;

  // Which card we are looking at. 0 is the first one.
  // (The server tells us where to start, in case we are coming back mid-game.)
  const [cardNumber, setCardNumber] = useState(game.startAt);
  const card = game.deck[cardNumber];

  // Not in a room (for example, the page was refreshed)? Go back home.
  if (!room) return <Redirect href="/" />;
  // No card left to show? Then we are done.
  if (!card) return <Redirect href="/done" />;

  // Tell the server what we thought, then show the next card.
  // If that was the last card, go to the "done" screen.
  // (If EVERYONE liked this one, the server says so and game.tsx jumps to the winner.)
  // TODO: let people drag the card left/right too (right now only the buttons work)
  function answer(liked: boolean) {
    game.swipe(card, liked);
    if (cardNumber + 1 < game.deck.length) {
      setCardNumber(cardNumber + 1);
    } else {
      router.replace('/done');
    }
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
            Card {cardNumber + 1} of {game.deck.length}
          </Text>
          <Text style={{ color: colors.softText }}>
            {finishedCount} of {room.members.length} finished
          </Text>
        </View>
        <ProgressBar fraction={(cardNumber + 1) / game.deck.length} />

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
        {/* This box is exactly as big as the card, so the pretend card
            behind it can copy its size. */}
        <View>
          {/* A pretend card peeking out behind, so it looks like a stack. */}
          <View
            style={[styles.backCard, { backgroundColor: colors.soft, borderColor: colors.softText }]}
          />

          {/* The real card, tilted a tiny bit. */}
          <View style={styles.tilt}>
            <ChunkyBox background={colors.card} radius={20}>
              {/* Top half: the restaurant photo (our eye mascot for now).
                  TODO: show the real photo once the server sends photoUrl */}
              <View style={[styles.photo, { backgroundColor: colors.soft }]}>
                <Eye size={170} />
                <View style={[styles.sticker, { borderColor: colors.accent }]}>
                  <Text style={[styles.stickerText, { color: colors.accent }]}>OH YES</Text>
                </View>
              </View>

              {/* Bottom half: the name and details. */}
              <View style={styles.info}>
                <Text style={[styles.restaurantName, { color: colors.text }]}>{card.name}</Text>
                {/* Something like "Ramen · $$ · 1.2 km" */}
                <Text style={{ color: colors.softText }}>{describe(card)}</Text>
                {card.rating && (
                  <Text style={{ color: colors.text }}>
                    ★ {card.rating} ({card.ratingCount} reviews)
                  </Text>
                )}
                {card.address && <Text style={{ color: colors.softText }}>{card.address}</Text>}
              </View>
            </ChunkyBox>
          </View>
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
          onPress={() => answer(false)}
        />
        <RoundButton
          symbol="♥"
          label="Yes"
          background={colors.primary}
          symbolColor={colors.onPrimary}
          onPress={() => answer(true)}
        />
      </View>
      <Text style={[styles.hint, { color: colors.softText }]}>
        Tap the heart for yes, the X for no
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
  backCard: {
    position: 'absolute', // sits behind the real card
    top: 6,
    bottom: 6,
    left: 0,
    right: 30,
    borderWidth: 2,
    borderRadius: 20,
    transform: [{ rotate: '-3deg' }],
  },
  tilt: {
    marginHorizontal: 10,
    transform: [{ rotate: '2deg' }],
  },
  photo: {
    height: 240,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sticker: {
    position: 'absolute', // pinned to the top-left corner of the photo
    top: 14,
    left: 14,
    borderWidth: 3,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 2,
    transform: [{ rotate: '-8deg' }],
  },
  stickerText: {
    fontSize: 22,
    fontWeight: '900',
  },
  info: {
    padding: 16,
    gap: 6,
  },
  restaurantName: {
    fontSize: 26,
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
