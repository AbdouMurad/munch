import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { BackButton, ChunkyBox, ChunkyButton, ErrorLine, Screen } from '@/components/ui';
import { useGame } from '@/game';
import { useAppTheme } from '@/theme';

// How many letters are in a lobby code. The server makes codes this long.
const CODE_LENGTH = 6;

// JOIN SCREEN: type the lobby code and your name, then join your friends.
export default function JoinScreen() {
  const { colors } = useAppTheme();
  const game = useGame();

  // What the person has typed so far.
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  // Make a list like [0, 1, 2, 3] so we can draw one box per letter.
  const boxNumbers = Array.from({ length: CODE_LENGTH }, (_, i) => i);

  return (
    <Screen>
      {/* ---------- TOP: back button and screen name ---------- */}
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.topTitle, { color: colors.text }]}>Join a game</Text>
      </View>

      <View>
        <Text style={[styles.title, { color: colors.text }]}>Got a code?</Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          Ask the host for the {CODE_LENGTH}-character lobby code.
        </Text>
      </View>

      {/* ---------- The lobby code boxes ---------- */}
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Lobby code</Text>
        <View>
          <View style={styles.codeRow}>
            {boxNumbers.map((i) => (
              <View key={i} style={styles.codeBox}>
                {code[i] ? (
                  // This box has a letter in it: draw it chunky.
                  <ChunkyBox background={colors.card} style={styles.codeBoxInside}>
                    <Text style={[styles.codeLetter, { color: colors.text }]}>{code[i]}</Text>
                  </ChunkyBox>
                ) : (
                  // This box is still empty. The NEXT one to fill gets a colored outline.
                  <View
                    style={[
                      styles.codeBoxInside,
                      styles.emptyCodeBox,
                      {
                        backgroundColor: colors.card,
                        borderColor: i === code.length ? colors.accent : colors.text,
                      },
                    ]}
                  />
                )}
              </View>
            ))}
          </View>

          {/* A trick! The real typing box is see-through and sits on top of the
              pretty boxes. You tap the boxes, but you're really typing in here. */}
          <TextInput
            accessibilityLabel="Lobby code"
            style={styles.hiddenInput}
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            maxLength={CODE_LENGTH}
            autoCapitalize="characters"
            autoCorrect={false}
          />
        </View>
      </View>

      {/* ---------- Your name ---------- */}
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Your name</Text>
        <TextInput
          style={[
            styles.nameInput,
            { backgroundColor: colors.card, borderColor: colors.text, color: colors.text },
          ]}
          value={name}
          onChangeText={setName}
          placeholder="Sam"
          placeholderTextColor={colors.softText}
          maxLength={24} // the server's limit for names
        />
      </View>

      {/* ---------- A friendly tip ---------- */}
      <View style={[styles.tip, { backgroundColor: colors.soft, borderColor: colors.text }]}>
        <Text style={[styles.tipText, { color: colors.text }]}>
          Opened an invite link? You&apos;ll skip this step.
        </Text>
      </View>

      {/* This empty box grows to push the button to the bottom of the screen. */}
      <View style={styles.spacer} />

      <ErrorLine />

      {/* Ask the server to let us in. If it works, we land in the lobby. */}
      <ChunkyButton label="Join lobby" primary onPress={() => game.joinRoom(code, name)} />
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
    fontSize: 17,
    fontWeight: '800',
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },

  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 4,
  },
  codeBox: {
    flex: 1, // every box takes an equal share of the row
  },
  codeBoxInside: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCodeBox: {
    borderWidth: 2,
    borderRadius: 16,
    marginRight: 6, // same room a ChunkyBox leaves for its shadow, so boxes line up
  },
  codeLetter: {
    fontSize: 24,
    fontWeight: '900',
  },
  hiddenInput: {
    position: 'absolute', // stretch over the whole row of boxes
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    opacity: 0, // 0 = completely see-through
  },
  nameInput: {
    height: 56,
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '700',
  },

  tip: {
    borderWidth: 2,
    borderRadius: 16,
    padding: 16,
  },
  tipText: {
    fontSize: 15,
  },
  spacer: {
    flex: 1,
  },
});
