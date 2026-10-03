import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { Avatar, ErrorLine, Eye, ProgressBar, Screen } from '@/components/ui';
import { initials, useGame } from '@/game';
import { useAppTheme } from '@/theme';

// DONE SCREEN: you finished swiping, now wait for your slower friends.
// We don't leave this screen ourselves. When the game ends, the server tells
// us (through the socket) and game.tsx moves everyone to the winner screen.
export default function DoneScreen() {
  const { colors } = useAppTheme();
  const game = useGame();
  const room = game.room;

  // Not in a room (for example, the page was refreshed)? Go back home.
  if (!room) return <Redirect href="/" />;

  // Count the friends who are still swiping.
  const slowCount = room.members.filter((member) => member.progress < room.deckSize).length;

  // How I swiped. We counted these ourselves on the swipe screen.
  const mySwipes = [
    { count: game.myYes, label: 'yes' },
    { count: game.myNope, label: 'nope' },
  ];

  return (
    <Screen>
      <Text style={[styles.gameName, { color: colors.text }]}>Lobby {room.code}</Text>

      {/* ---------- The mascot and the big words ---------- */}
      <View style={styles.hero}>
        <Eye size={110} />
        <Text style={[styles.title, { color: colors.text }]}>You&apos;re done!</Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          Waiting on {slowCount} {slowCount === 1 ? 'friend' : 'friends'} to finish swiping.
        </Text>
      </View>

      {/* ---------- Two boxes: how many yes / nope ---------- */}
      <View style={styles.stats}>
        {mySwipes.map((stat) => (
          <View
            key={stat.label}
            style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.text }]}>
            <Text style={[styles.statCount, { color: colors.text }]}>{stat.count}</Text>
            <Text style={{ color: colors.softText }}>{stat.label}</Text>
          </View>
        ))}
      </View>

      {/* ---------- How each friend is doing ---------- */}
      {/* These bars move by themselves: the server tells us after every swipe. */}
      <View>
        {room.members.map((member) => {
          const isDone = member.progress >= room.deckSize;
          return (
            <View key={member.id} style={[styles.playerRow, { borderColor: colors.text }]}>
              <Avatar initials={initials(member.displayName)} done={isDone} />
              <Text style={[styles.playerName, { color: colors.text }]}>
                {member.displayName}
                {member.id === game.myId ? ' (you)' : ''}
              </Text>

              {isDone ? (
                // Finished friends get a check mark.
                <Text style={[styles.doneText, { color: colors.text }]}>✓ Done</Text>
              ) : (
                // Friends still swiping get a little progress bar.
                <>
                  <Text style={{ color: colors.softText }}>
                    {member.progress}/{room.deckSize}
                  </Text>
                  <View style={styles.smallBar}>
                    <ProgressBar fraction={member.progress / room.deckSize} />
                  </View>
                </>
              )}
            </View>
          );
        })}
      </View>

      {/* This empty box grows to push the words to the bottom of the screen. */}
      <View style={styles.spacer} />

      <ErrorLine />
      <Text style={[styles.footnote, { color: colors.softText }]}>
        Results show when everyone finishes
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  gameName: {
    fontSize: 20,
    fontWeight: '900',
  },

  hero: {
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 16,
    textAlign: 'center',
  },

  stats: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1, // each box takes an equal share of the row
    alignItems: 'center',
    borderWidth: 2,
    borderRadius: 14,
    paddingVertical: 12,
  },
  statCount: {
    fontSize: 28,
    fontWeight: '900',
  },

  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 2, // the line under each friend
  },
  playerName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  doneText: {
    fontSize: 14,
    fontWeight: '800',
  },
  smallBar: {
    width: 90,
  },

  spacer: {
    flex: 1,
  },
  footnote: {
    fontSize: 13,
    textAlign: 'center',
  },
});
