import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { useAccount } from '@/account';
import { useTabs } from '@/tabs';
import { Field, Message } from '@/components/account-ui';
import { BackButton, ChunkyButton, Screen } from '@/components/ui';
import { useAppTheme } from '@/theme';

// On the web, Google opens a popup. This closes it once Google sends us back.
WebBrowser.maybeCompleteAuthSession();

// The "Web application" OAuth client id from Google Cloud Console.
// Google sign-in in a phone app needs a development build (see frontend/README.md),
// so for now the Google button only shows on the web.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE = { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' };

// SIGN IN SCREEN: type your email, get a 6-digit code, type it in. Or use Google.
export default function SignInScreen() {
  const { colors } = useAppTheme();
  const account = useAccount();
  const tabs = useTabs();

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false); // step 2: typing the code
  const [problem, setProblem] = useState('');
  const [nonce] = useState(() => Crypto.randomUUID()); // one per screen, not per redraw

  // Ask Google for an "ID token": a signed note from Google saying who you are.
  // The server checks Google's signature, so we can't fake it.
  const [, googleResponse, askGoogle] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_WEB_CLIENT_ID ?? 'not-set',
      redirectUri: AuthSession.makeRedirectUri(),
      responseType: AuthSession.ResponseType.IdToken,
      scopes: ['openid', 'email', 'profile'],
      usePKCE: false,
      extraParams: { nonce },
    },
    GOOGLE,
  );

  // Signed in! New people land on their profile to pick a handle.
  function done(isNew: boolean) {
    if (isNew) tabs.setTab('profile');
    router.back();
  }

  useEffect(() => {
    if (googleResponse?.type !== 'success') return;
    const idToken = googleResponse.params.id_token;
    account
      .googleSignIn(idToken)
      .then(done)
      .catch((e: Error) => setProblem(e.message));
  }, [googleResponse]); // eslint-disable-line react-hooks/exhaustive-deps

  async function sendCode() {
    setProblem('');
    try {
      await account.emailStart(email.trim());
      setCodeSent(true);
    } catch (e) {
      setProblem((e as Error).message);
    }
  }

  async function checkCode() {
    setProblem('');
    try {
      done(await account.emailVerify(email.trim(), code.trim()));
    } catch (e) {
      setProblem((e as Error).message);
    }
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.topTitle, { color: colors.text }]}>Sign in</Text>
      </View>

      <View>
        <Text style={[styles.title, { color: colors.text }]}>Save your taste</Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          Sign in to keep your preferences, add friends, and get invited to their games. No
          password needed.
        </Text>
      </View>

      {!codeSent ? (
        <>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
          />
          <ChunkyButton label="Email me a code" primary onPress={sendCode} />
        </>
      ) : (
        <>
          <Field
            label={`Code sent to ${email.trim()}`}
            value={code}
            onChangeText={setCode}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={6}
          />
          <Message
            // TODO: remove once the server really sends email
            text="For now the code is printed in the server's terminal."
            problem={false}
          />
          <ChunkyButton label="Sign in" primary onPress={checkCode} />
          <ChunkyButton label="Use a different email" onPress={() => setCodeSent(false)} />
        </>
      )}

      {Platform.OS === 'web' && GOOGLE_WEB_CLIENT_ID ? (
        <ChunkyButton label="Continue with Google" onPress={() => askGoogle()} />
      ) : null}

      <Message text={problem} />
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
    fontSize: 20,
    fontWeight: '900',
  },
  title: {
    fontSize: 30,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    marginTop: 6,
  },
});
