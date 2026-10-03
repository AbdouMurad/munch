import { Redirect } from 'expo-router';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { ChunkyBox, ChunkyButton, Eye, Screen } from '@/components/ui';
import { describe, useGame } from '@/game';
import { useAppTheme } from '@/theme';

// WINNER SCREEN: the game is over, here is where we're eating!
// The server decides how the game ended and game.tsx saves it in "result":
//   - matched:     EVERYONE liked the same restaurant.
//   - not matched: nobody agreed, so we show the most-liked restaurants.
export default function WinnerScreen() {
  const { colors } = useAppTheme();
  const game = useGame();
  const room = game.room;
  const result = game.result;

  // No room or no result yet (for example, the page was refreshed)? Go back home.
  if (!room || !result) return <Redirect href="/" />;

  // The first pick is the winner. The rest are the runners-up.
  // "winner" is empty if nobody liked anything at all.
  const winner = result.picks[0];
  const runnersUp = result.picks.slice(1);

  return (
    <Screen>
      {/* ---------- TOP: lobby code and "Play again" ---------- */}
      <View style={styles.row}>
        <Text style={[styles.gameName, { color: colors.text }]}>Lobby {room.code}</Text>
        <Pressable
          accessibilityRole="button"
          // Leave this room and go back to the home screen.
          onPress={game.leaveRoom}
          style={[styles.againButton, { backgroundColor: colors.card, borderColor: colors.text }]}>
          <Text style={[styles.againText, { color: colors.text }]}>Play again</Text>
        </Pressable>
      </View>

      {!winner ? (
        // ---------- Nobody liked anything ----------
        <View style={styles.nothing}>
          <Eye size={110} />
          <Text style={[styles.winnerName, { color: colors.text }]}>No winner this time</Text>
          <Text style={{ color: colors.softText }}>Nobody said yes to anything. Play again?</Text>
        </View>
      ) : (
        <>
          <Text style={[styles.intro, { color: colors.text }]}>
            {result.matched ? "Tonight you're eating at" : 'Nobody agreed, but the top pick is'}
          </Text>

          {/* ---------- The winning restaurant ---------- */}
          <ChunkyBox background={colors.card} radius={20}>
            <View style={[styles.photo, { backgroundColor: colors.soft }]}>
              <Eye size={140} />
              <View
                style={[
                  styles.sticker,
                  { backgroundColor: colors.accent, borderColor: colors.text },
                ]}>
                <Text style={[styles.stickerText, { color: colors.onAccent }]}>
                  {result.matched ? '♛ WINNER' : 'TOP PICK'}
                </Text>
              </View>
            </View>

            <View style={styles.info}>
              <Text style={[styles.winnerName, { color: colors.text }]}>{winner.card.name}</Text>
              {/* Something like "Ramen · $$ · 1.2 km" */}
              <Text style={{ color: colors.softText }}>{describe(winner.card)}</Text>
              <Text style={[styles.votes, { color: colors.text }]}>
                {winner.likes} of {room.members.length} said yes
              </Text>
            </View>
          </ChunkyBox>

          {/* Only show Directions if the server gave us a maps link. */}
          {winner.card.mapsUri && (
            <ChunkyButton
              label="Directions"
              primary
              onPress={() => Linking.openURL(winner.card.mapsUri!)}
            />
          )}

          {/* ---------- The restaurants that almost won ---------- */}
          {runnersUp.length > 0 && (
            <Text style={[styles.label, { color: colors.text }]}>Runners-up</Text>
          )}
          {runnersUp.map((pick, i) => (
            <View
              key={pick.card.id}
              style={[styles.runnerUp, { backgroundColor: colors.card, borderColor: colors.text }]}>
              {/* Their place: the first runner-up came 2nd, the next came 3rd... */}
              <View
                style={[styles.place, { backgroundColor: colors.soft, borderColor: colors.text }]}>
                <Text style={[styles.placeText, { color: colors.text }]}>{i + 2}</Text>
              </View>

              <View style={styles.runnerUpInfo}>
                <Text style={[styles.runnerUpName, { color: colors.text }]}>{pick.card.name}</Text>
                <Text style={{ color: colors.softText }}>{describe(pick.card)}</Text>
              </View>

              <Text style={[styles.runnerUpVotes, { color: colors.text }]}>
                {pick.likes}/{room.members.length}
              </Text>
            </View>
          ))}
        </>
      )}
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
  againButton: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  againText: {
    fontSize: 15,
    fontWeight: '800',
  },
  intro: {
    fontSize: 18,
    fontWeight: '600',
  },
  nothing: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 40,
  },

  photo: {
    height: 190,
    alignItems: 'center',
    justifyContent: 'center',
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
  info: {
    padding: 16,
    gap: 6,
  },
  winnerName: {
    fontSize: 28,
    fontWeight: '900',
  },
  votes: {
    fontSize: 14,
    fontWeight: '800',
  },

  label: {
    fontSize: 14,
    fontWeight: '800',
  },
  runnerUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 2,
    borderRadius: 14,
    padding: 12,
  },
  place: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeText: {
    fontSize: 14,
    fontWeight: '900',
  },
  runnerUpInfo: {
    flex: 1,
  },
  runnerUpName: {
    fontSize: 16,
    fontWeight: '800',
  },
  runnerUpVotes: {
    fontSize: 15,
    fontWeight: '900',
  },
});
