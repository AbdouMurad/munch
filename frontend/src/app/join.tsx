import { router, useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BackButton, ChunkyBox, ChunkyButton, ErrorLine, Screen } from '@/components/ui';
import { TaxiLoading } from '@/city';
import { useGame } from '@/game';
import { useAppTheme } from '@/theme';

// How many letters are in a lobby code. The server makes codes this long.
const CODE_LENGTH = 6;

// JOIN SCREEN: type the lobby code and your name, then join your friends.
export default function JoinScreen() {
  const { colors } = useAppTheme();
  const game = useGame();

  // Did we get here by tapping an invite link? Then the link has a sticky note
  // on it, like "?code=ABC234", and this reads it. No link = no code (undefined).
  const { code: codeFromLink } = useLocalSearchParams<{ code?: string }>();
  // True if the link gave us a code, so we can say "You're invited!".
  const cameFromLink = !!codeFromLink;

  // What the person has typed so far.
  // If we came from an invite link, the code starts already filled in.
  // (Made CAPITAL and cut to 6 letters, in case the link got messed up.)
  const [code, setCode] = useState((codeFromLink ?? '').toUpperCase().slice(0, CODE_LENGTH));
  const [name, setName] = useState('');

  // Make a list like [0, 1, 2, 3] so we can draw one box per letter.
  const boxNumbers = Array.from({ length: CODE_LENGTH }, (_, i) => i);

  // A "ref" is like a remote control for the hidden typing box.
  // It lets us say "hey typing box, wake up!" from anywhere on this screen.
  const codeInput = useRef<TextInput>(null);

  // Called when you tap the letter boxes: make the keyboard pop up.
  //
  // WHY we need this: phones (iPhones especially) refuse to let you tap
  // something that is completely see-through. So the hidden typing box never
  // felt your finger, and the keyboard never came up. Now the pretty boxes
  // catch the tap and use the remote control to wake up the typing box.
  function openKeyboard() {
    const input = codeInput.current;
    if (!input) return;

    // If you already tapped once and then hid the keyboard, the typing box is
    // still "awake", so telling it to wake up again does nothing on Android.
    // So we put it to sleep first, then wake it up a moment later.
    if (input.isFocused()) {
      input.blur(); // "blur" = stop typing here (keyboard goes away)
      setTimeout(() => input.focus(), 50); // 50 milliseconds later: start again
    } else {
      input.focus(); // "focus" = start typing here (keyboard comes up)
    }
  }

  return (
    <Screen>
      {/* ---------- TOP: back button and screen name ---------- */}
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.topTitle, { color: colors.text }]}>Join a game</Text>
      </View>

      <View>
        {/* Came from an invite link? The code is already done, so the
            words say so. Otherwise, ask for the code like normal. */}
        <Text style={[styles.title, { color: colors.text }]}>
          {cameFromLink ? "You're invited!" : 'Got a code?'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          {cameFromLink
            ? 'We filled in the code for you. Just add your name.'
            : `Ask the host for the ${CODE_LENGTH}-character lobby code.`}
        </Text>
      </View>

      {/* ---------- The lobby code boxes ---------- */}
      <View style={styles.field}>
        <Text style={[styles.label, { color: colors.text }]}>Lobby code</Text>
        {/* The whole row of boxes is one big button: tap it to type. */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Lobby code. Tap to type it."
          onPress={openKeyboard}>
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
              pretty boxes. You tap the boxes (the button above), and the button
              wakes up this box, so you're really typing in here. */}
          <TextInput
            ref={codeInput} // connect the remote control (see openKeyboard)
            accessibilityLabel="Lobby code"
            // Let taps go straight THROUGH this box to the button underneath,
            // so tapping works the same way on every phone and on the web.
            pointerEvents="none"
            style={styles.hiddenInput}
            value={code}
            onChangeText={(text) => setCode(text.toUpperCase())}
            maxLength={CODE_LENGTH}
            autoCapitalize="characters" // the keyboard starts in CAPITAL letters
            autoCorrect={false} // don't "fix" the code into a real word
            autoComplete="off" // don't suggest saved passwords or emails
            spellCheck={false} // no red squiggly lines under the code
          />
        </Pressable>
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
          // Came from a link? The name is the only thing left to type, so
          // open the keyboard right away on this box.
          autoFocus={cameFromLink}
          maxLength={24} // the server's limit for names
        />
      </View>

      {/* ---------- A friendly tip (only if you typed the code yourself) ---------- */}
      {!cameFromLink && (
        <View style={[styles.tip, { backgroundColor: colors.soft, borderColor: colors.text }]}>
          <Text style={[styles.tipText, { color: colors.text }]}>
            Tip: if the host sends you an invite link, tap it and the code fills in by itself.
          </Text>
        </View>
      )}

      {/* This empty box grows to push the button to the bottom of the screen. */}
      <View style={styles.spacer} />

      <ErrorLine />

      {/* Ask the server to let us in. If it works, we land in the lobby. */}
      {game.connecting ? (
        // We asked the server and are waiting for it to answer.
        // Show the taxi so people know something is happening.
        <TaxiLoading label="Finding your friends..." />
      ) : (
        <ChunkyButton label="Join lobby" primary onPress={() => game.joinRoom(code, name)} />
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
