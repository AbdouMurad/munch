import * as Clipboard from 'expo-clipboard';
import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, View } from 'react-native';

import { Avatar, BackButton, ChunkyButton, ErrorLine, Screen } from '@/components/ui';
import { initials, joinLink, useGame } from '@/game';
import { useAppTheme } from '@/theme';

// LOBBY SCREEN: wait for friends to join, then the host starts the game.
// The player list updates by itself: the server tells us (through the
// socket) every time someone joins or leaves.
export default function LobbyScreen() {
  const { colors } = useAppTheme();
  const game = useGame();
  const room = game.room;

  // A short message we show for a moment after copying something,
  // like "Copied!". It's empty ('') when there is nothing to say.
  const [copiedMessage, setCopiedMessage] = useState('');

  // Not in a room (for example, the page was refreshed)? Go back home.
  if (!room) return <Redirect href="/" />;

  // Find "me" in the list of players, to check if I am the host.
  const me = room.members.find((member) => member.id === game.myId);
  const iAmHost = me ? me.isHost : false;

  // Called when you tap the big code box.
  // It puts the code on the phone's "clipboard": an invisible pocket that holds
  // one thing you copied. Later you can "paste" it anywhere, like in a text to a friend.
  async function copyCode(code: string) {
    await Clipboard.setStringAsync(code); // put the code in the pocket
    showCopied('Copied! ✓');
  }

  // Show a little message under "Lobby code" for 1.5 seconds, then hide it.
  function showCopied(message: string) {
    setCopiedMessage(message);
    setTimeout(() => setCopiedMessage(''), 1500);
  }

  // Called when you tap the share button ("AirDrop" on iPhones, "Invite" elsewhere).
  //
  // HOW AIRDROP WORKS HERE: an app is not allowed to AirDrop by itself. What we
  // CAN do is open the iPhone's share sheet, and AirDrop is the first thing in
  // it. You tap AirDrop, tap your friend, and the link pops up on their phone.
  // They tap it and land on the Join screen with the code already filled in.
  // All they have to type is their name!
  // (The same sheet also has Messages, WhatsApp, and so on, for friends far away.)
  async function shareLink(code: string) {
    const link = joinLink(code);

    // What we hand to the share sheet depends on the kind of phone:
    //  - iPhones and web browsers: JUST the link, as a "url". This matters for
    //    AirDrop! A plain link opens the moment your friend accepts it. If we
    //    wrapped it in a sentence, AirDrop would send a text note instead, and
    //    your friend would have to dig the link out of it.
    //  - Android phones: they only understand a "message", so we send a
    //    sentence with the link inside.
    const whatToShare =
      Platform.OS === 'android'
        ? { message: `Join my Munch game! Tap the link to join: ${link}` }
        : { url: link };

    try {
      await Share.share(whatToShare);
    } catch {
      // Some computer web browsers have no share sheet, so Share.share fails.
      // No problem: copy the link instead, so you can paste it to your friends.
      await Clipboard.setStringAsync(link);
      showCopied('Link copied! ✓');
    }
  }

  return (
    <Screen>
      {/* ---------- TOP: leave button, title, invite button ---------- */}
      <View style={styles.topBar}>
        <BackButton onPress={game.leaveRoom} />
        <Text style={[styles.topTitle, { color: colors.text }]}>Lobby</Text>
        <Pressable
          accessibilityRole="button"
          // Share a link that joins this game (see shareLink above).
          onPress={() => shareLink(room.code)}
          style={[styles.inviteButton, { backgroundColor: colors.card, borderColor: colors.text }]}>
          {/* On iPhones the button says "AirDrop", so people know they can. */}
          <Text style={[styles.inviteText, { color: colors.text }]}>
            {Platform.OS === 'ios' ? 'AirDrop' : 'Invite'}
          </Text>
        </Pressable>
      </View>

      {/* ---------- The big lobby code (tap it to copy!) ---------- */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Lobby code ${room.code}. Tap to copy.`}
        onPress={() => copyCode(room.code)}
        // "pressed" is true while your finger is on the box. We make the box a
        // little see-through then, so you can tell your tap did something.
        style={({ pressed }) => [
          styles.codeBanner,
          { backgroundColor: colors.primary, opacity: pressed ? 0.7 : 1 },
        ]}>
        <View>
          <Text style={[styles.codeLabel, { color: colors.onPrimary }]}>Lobby code</Text>
          {/* The small hint underneath. It changes to "Copied!" for a moment. */}
          <Text style={[styles.copyHint, { color: colors.onPrimary }]}>
            {copiedMessage || 'Tap to copy'}
          </Text>
        </View>
        <Text style={[styles.code, { color: colors.onPrimary }]}>{room.code}</Text>
      </Pressable>

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
  copyHint: {
    fontSize: 13,
    opacity: 0.8, // a little faded, so it looks less important than "Lobby code"
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
