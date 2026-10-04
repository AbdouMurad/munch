import { Redirect } from 'expo-router';
import { ReactNode, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

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
  // A short phone (like an iPhone SE) gets shorter photos, so the card, "Get directions"
  // and "Play again" all fit without scrolling.
  const { height } = useWindowDimensions();
  const photoHeight = height < 760 ? 140 : 220;

  // No room or no result yet (for example, the page was refreshed)? Go back home.
  if (!room || !result) return <Redirect href="/" />;

  const items = resultItems(result);
  const top = items.find((item) => item.card.id === topId) ?? items[0];

  return (
    <Screen>
      {/* ---------- TOP: lobby code ---------- */}
      <Text style={[styles.gameName, { color: colors.text }]}>Lobby {room.code}</Text>

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
            photoHeight={photoHeight}
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

      {/* ---------- BOTTOM: two big round buttons, side by side ---------- */}
      <View style={styles.roundButtons}>
        {/* Leave this room and go back to the home screen. */}
        <RoundButton
          symbol={<HouseIcon color={colors.text} />}
          label="Home"
          onPress={game.leaveRoom}
        />
        {/* Back to the lobby of THIS room, with the same friends, for another round. */}
        <RoundButton symbol="↻" label="Play again" primary onPress={game.playAgain} />
      </View>
    </Screen>
  );
}

// A big round button with its words underneath. A plain circle with an outline
// (no shadow, so it reads as ONE button). "primary" = the filled, main-color one.
// "symbol" is a character like "↻", or a drawn icon like <HouseIcon />.
function RoundButton({ symbol, label, primary = false, onPress }: {
  symbol: ReactNode;
  label: string;
  primary?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.roundButton}>
      <View
        style={[
          styles.circle,
          { backgroundColor: primary ? colors.primary : colors.card, borderColor: colors.text },
        ]}>
        {typeof symbol === 'string' ? (
          <Text style={[styles.symbol, { color: primary ? colors.onPrimary : colors.text }]}>
            {symbol}
          </Text>
        ) : (
          symbol
        )}
      </View>
      <Text style={[styles.roundLabel, { color: colors.text }]}>{label}</Text>
    </Pressable>
  );
}

// A little house, drawn with boxes instead of a "⌂" character: characters sit wherever
// the phone's font puts them (often off-center), but boxes go exactly where we say.
//   roof = a square turned on its corner with only two sides drawn, so it looks like "^"
//   body = a box with no top side, sitting under the roof
function HouseIcon({ color }: { color: string }) {
  return (
    <View style={styles.house}>
      <View style={[styles.roof, { borderColor: color }]} />
      <View style={[styles.houseBody, { borderColor: color }]} />
    </View>
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
  spacer: {
    flex: 1,
  },
  // The two round buttons, centered side by side.
  roundButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 40,
  },
  roundButton: {
    alignItems: 'center',
    gap: 6,
  },
  circle: {
    width: 80,
    height: 80,
    borderRadius: 40, // half the size = a perfect circle
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: {
    fontSize: 36,
    fontWeight: '900',
  },
  // The house icon: 32 wide, 30 tall, so it sits in the middle of the circle.
  house: {
    width: 32,
    height: 30,
  },
  roof: {
    position: 'absolute',
    left: 5, // (32 - 22) / 2: centered left to right
    top: 5, // turned on its corner, the tip pokes up to the top of the icon
    width: 22,
    height: 22,
    borderTopWidth: 4,
    borderLeftWidth: 4,
    transform: [{ rotate: '45deg' }],
  },
  houseBody: {
    position: 'absolute',
    left: 6,
    top: 15,
    width: 20,
    height: 15,
    borderWidth: 4,
    borderTopWidth: 0, // the roof is its top
  },
  roundLabel: {
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
