import { Redirect } from 'expo-router';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar, BackButton, ChunkyButton, ErrorLine, Screen } from '@/components/ui';
import { initials, useGame } from '@/game';
import { useAppTheme } from '@/theme';

// LOBBY SCREEN: wait for friends to join, then the host starts the game.
// The player list updates by itself: the server tells us (through the
// socket) every time someone joins or leaves.
export default function LobbyScreen() {
  const { colors } = useAppTheme();
  const game = useGame();
  const room = game.room;

  // Not in a room (for example, the page was refreshed)? Go back home.
  if (!room) return <Redirect href="/" />;

  // Find "me" in the list of players, to check if I am the host.
  const me = room.members.find((member) => member.id === game.myId);
  const iAmHost = me ? me.isHost : false;

  return (
    <Screen>
      {/* ---------- TOP: leave button, title, invite button ---------- */}
      <View style={styles.topBar}>
        <BackButton onPress={game.leaveRoom} />
        <Text style={[styles.topTitle, { color: colors.text }]}>Lobby</Text>
        <Pressable
          accessibilityRole="button"
          // This opens the phone's share sheet (AirDrop, Messages, ...).
          // TODO: share a join link that fills in the code for you
          onPress={() => Share.share({ message: `Join my Munch game! Code: ${room.code}` })}
          style={[styles.inviteButton, { backgroundColor: colors.card, borderColor: colors.text }]}>
          <Text style={[styles.inviteText, { color: colors.text }]}>Invite</Text>
        </Pressable>
      </View>

      {/* ---------- The big lobby code ---------- */}
      <View style={[styles.codeBanner, { backgroundColor: colors.primary }]}>
        <Text style={[styles.codeLabel, { color: colors.onPrimary }]}>Lobby code</Text>
        <Text style={[styles.code, { color: colors.onPrimary }]}>{room.code}</Text>
      </View>

      {/* ---------- The list of friends ---------- */}
      <View>
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.text }]}>Players</Text>
          <Text style={{ color: colors.softText }}>
            {room.members.length} here · within {room.radiusM / 1000} km
          </Text>
        </View>

        {/* Draw one row for each friend. */}
        {room.members.map((member) => (
          <View key={member.id} style={[styles.playerRow, { borderColor: colors.text }]}>
            <Avatar initials={initials(member.displayName)} />
            <Text style={[styles.playerName, { color: colors.text }]}>
              {member.displayName}
              {member.id === game.myId ? ' (you)' : ''}
            </Text>
            <Text style={[styles.playerStatus, { color: colors.text }]}>
              {member.isHost ? 'Host' : 'Ready'}
            </Text>
          </View>
        ))}
      </View>

      {/* This empty box grows to push the button to the bottom of the screen. */}
      <View style={styles.spacer} />

      <ErrorLine />

      {iAmHost ? (
        // The server answers by sending everyone the cards. When they arrive,
        // game.tsx moves every player to the swipe screen.
        <ChunkyButton label="Start game" primary onPress={game.startGame} />
      ) : (
        <Text style={[styles.waiting, { color: colors.softText }]}>
          Waiting for the host to start...
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topTitle: {
    flex: 1, // takes the space in the middle, pushing Invite to the right edge
    fontSize: 20,
    fontWeight: '900',
  },
  inviteButton: {
    borderWidth: 2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  inviteText: {
    fontSize: 15,
    fontWeight: '800',
  },

  codeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  codeLabel: {
    fontSize: 15,
    fontWeight: '700',
  },
  code: {
    fontSize: 30,
    fontWeight: '900',
    letterSpacing: 3, // a little gap between each letter
  },

  // A row with one thing on the left and one thing on the right.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 2, // the line under each friend
  },
  playerName: {
    flex: 1,
    fontSize: 17,
    fontWeight: '600',
  },
  playerStatus: {
    fontSize: 14,
    fontWeight: '800',
  },

  spacer: {
    flex: 1,
  },
  waiting: {
    fontSize: 16,
    textAlign: 'center',
    paddingVertical: 16,
  },
});
