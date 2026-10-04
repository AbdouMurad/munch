// THE SIGN-IN POP-UP: slides up from the bottom when you tap "Sign in".
//   - Sign in with email   (an account you already have)
//   - Create account       (new here)
//   - Continue with Google (web only for now)
// Tap outside the card, or "Not now", to close it.

import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Message } from '@/components/account-ui';
import { ChunkyBox, ChunkyButton } from '@/components/ui';
import { useGoogleSignIn } from '@/google-signin';
import { useAppTheme } from '@/theme';

export function SignInSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors } = useAppTheme();
  const [problem, setProblem] = useState('');

  // Google said yes. Brand-new people still pick a name and handle: FinishSigningUp
  // (app/_layout.tsx) notices there's no handle yet and opens that step for us.
  function signedIn() {
    onClose();
  }

  const google = useGoogleSignIn({ onSignedIn: signedIn, onError: setProblem });

  // The email options open the sign-in screen, with words that match what you picked.
  function openEmail(mode: 'signin' | 'create') {
    onClose();
    router.push(`/signin?mode=${mode}`);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* An invisible layer behind the card: tapping outside the card closes it. */}
      <Pressable accessibilityLabel="Close" style={styles.backdrop} onPress={onClose} />

      <View style={[styles.sheet, { backgroundColor: colors.background, borderColor: colors.text }]}>
        {/* The little handle bar at the top, like on most phone pop-ups. */}
        <View style={[styles.grabber, { backgroundColor: colors.softText }]} />

        <Text style={[styles.title, { color: colors.text }]}>Join munch</Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          Save your taste, add friends, and get invited to their games.
        </Text>

        <ChunkyButton label="Sign in with email" primary onPress={() => openEmail('signin')} />
        <ChunkyButton label="Create account" onPress={() => openEmail('create')} />
        {google.available && <GoogleButton onPress={google.start} />}

        <Message text={problem} />
        <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}>
          <Text style={[styles.notNow, { color: colors.softText }]}>Not now</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

// ---------- GoogleButton ----------
// Google's own look (their blue, with the coloured "G" on a white square), inside the
// same chunky box as our other buttons: outline plus the hard shadow at the bottom-right.
const GOOGLE_BLUE = '#4285F4';

function GoogleButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Continue with Google" onPress={onPress}>
      <ChunkyBox background={GOOGLE_BLUE} style={styles.google}>
        <View style={styles.googleLogoBox}>
          <Image
            source={require('../../assets/images/google-g.svg')}
            style={styles.googleLogo}
            contentFit="contain"
          />
        </View>
        <Text style={styles.googleText}>Continue with Google</Text>
      </ChunkyBox>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute', // covers the whole screen behind the card
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopWidth: 2,
    borderLeftWidth: 2,
    borderRightWidth: 2,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
    gap: 12,
    // A soft shadow above the card, so it stands out without darkening the screen.
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 16, // Android's version of a shadow
  },
  google: {
    height: 58, // same height as the other buttons
    flexDirection: 'row',
    alignItems: 'center',
    padding: 5,
  },
  googleLogoBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  googleLogo: {
    width: 22,
    height: 22,
  },
  googleText: {
    flex: 1,
    textAlign: 'center',
    marginRight: 44, // balances the logo box, so the words sit in the middle
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    marginBottom: 4,
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 4,
  },
  notNow: {
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: 4,
  },
});
