import { Redirect } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ResultItem, ResultStack } from '@/components/result-stack';
import { ChunkyButton, Eye, Screen } from '@/components/ui';
import { Result, useGame } from '@/game';
import { useAppTheme } from '@/theme';

// WINNER SCREEN: the game is over, here is where we're eating!
// The server decides how the game ended and game.tsx saves it in "result":
//   - matched:     enough of us liked the same restaurant. That's the winner.
//   - not matched: everyone ran out of cards, so we show the most-liked restaurants.
// They show up as a pile of cards: swipe the top one to send it to the bottom.
export default function WinnerScreen() {
  const { colors } = useAppTheme();
  const game = useGame();
  const room = game.room;
  const result = game.result;

  // Which restaurant is on top of the pile right now (for the Directions button).
  const [topId, setTopId] = useState<string | null>(null);
  // Lets the "Next" button flip the pile, same as a swipe (handy on a computer).
  const flipRef = useRef<(() => void) | null>(null);

  // No room or no result yet (for example, the page was refreshed)? Go back home.
  if (!room || !result) return <Redirect href="/" />;

  const items = resultItems(result);
  const top = items.find((item) => item.card.id === topId) ?? items[0];

  return (
    <Screen>
      {/* ---------- TOP: lobby code and "Leave" ---------- */}
      <View>
        <Text style={[styles.gameName, { color: colors.text }]}>Lobby {room.code}</Text>
        <Pressable accessibilityRole="button" onPress={game.leaveRoom}>
          <Text style={[styles.leave, { color: colors.softText }]}>Leave</Text>
        </Pressable>
      </View>

      {!top ? (
        // ---------- There is nothing to show ----------
        <View style={styles.nothing}>
          <Eye size={110} />
          <Text style={[styles.title, { color: colors.text }]}>No winner this time</Text>
          <Text style={[styles.nothingText, { color: colors.softText }]}>
            {room.deckSize === 0
              ? // The server found no restaurants that fit the host's rules.
                'No restaurants matched those rules. Try a bigger distance or fewer rules.'
              : 'Nobody said yes to anything. Play again?'}
          </Text>
        </View>
      ) : (
        <>
          <Text style={[styles.intro, { color: colors.text }]}>{intro(result)}</Text>

          {/* ---------- All the restaurants, as a pile of cards ---------- */}
          <ResultStack
            items={items}
            memberCount={room.members.length}
            onTopChange={setTopId}
            flipRef={flipRef}
          />

          {/* More than one? Say so, and give computers a button to flip through. */}
          {items.length > 1 && (
            <View style={styles.row}>
              <Text style={{ color: colors.softText }}>Swipe to see all {items.length}</Text>
              <Pressable accessibilityRole="button" onPress={() => flipRef.current?.()}>
                <Text style={[styles.next, { color: colors.text }]}>Next ›</Text>
              </Pressable>
            </View>
          )}

          {/* Directions to whichever restaurant is on top (if the server gave us a link). */}
          {top.card.mapsUri && (
            <ChunkyButton
              label="Get directions" // to the card on top (its name is right above)
              primary
              onPress={() => Linking.openURL(top.card.mapsUri!)}
            />
          )}
        </>
      )}

      {/* This empty box grows to push "Play again" to the bottom of the screen. */}
      <View style={styles.spacer} />

      {/* ---------- BOTTOM: a big round "Play again" button ---------- */}
      {/* Back to the lobby of THIS room, with the same friends, for another round. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Play again"
        onPress={game.playAgain}
        style={styles.again}>
        {/* A plain circle with an outline (no shadow, so it reads as ONE button). */}
        <View
          style={[styles.againCircle, { backgroundColor: colors.primary, borderColor: colors.text }]}>
          <Text style={[styles.againSymbol, { color: colors.onPrimary }]}>↻</Text>
        </View>
        <Text style={[styles.againText, { color: colors.text }]}>Play again</Text>
      </Pressable>
    </Screen>
  );
}

// The cards for the pile, each with its sticker.
function resultItems(result: Result): ResultItem[] {
  return result.picks.map((pick, i) => ({
    card: pick.card,
    sticker: result.matched ? '♛ WINNER' : i === 0 ? 'TOP PICK' : `#${i + 1}`,
    likes: pick.likes,
  }));
}

// The words above the pile. For a winner, it depends on the time on this phone.
function intro(result: Result) {
  if (!result.matched) return 'Nobody agreed, but these got the most likes';
  const hour = new Date().getHours(); // 0 = midnight, 13 = 1 PM, 23 = 11 PM
  if (hour >= 5 && hour < 11) return "This morning you're eating at";
  if (hour >= 11 && hour < 16) return "For lunch you're eating at";
  if (hour >= 16 && hour < 22) return "Tonight you're eating at";
  return "Late night, you're eating at";
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
    fontSize: 14,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  spacer: {
    flex: 1,
  },
  // The round button sits in the middle, with its words underneath.
  again: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
  },
  againCircle: {
    width: 80,
    height: 80,
    borderRadius: 40, // half the size = a perfect circle
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  againSymbol: {
    fontSize: 36,
    fontWeight: '900',
  },
  againText: {
    fontSize: 15,
    fontWeight: '800',
  },
  intro: {
    fontSize: 18,
    fontWeight: '600',
  },
  next: {
    fontSize: 15,
    fontWeight: '800',
  },
  nothingText: {
    fontSize: 16,
    textAlign: 'center',
  },
  nothing: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 40,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
  },
});
