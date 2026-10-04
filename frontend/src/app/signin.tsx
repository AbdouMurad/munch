import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Me, SignedIn, tidyHandle, useAccount } from '@/account';
import { Field, Message } from '@/components/account-ui';
import { BackButton, ChunkyButton, Screen } from '@/components/ui';
import { needsRegistering } from '@/google-signin';
import { useTabs } from '@/tabs';
import { useAppTheme } from '@/theme';

// What the screen is for. The sign-in pop-up picks one:
//   signin   = "Sign in with email" (an account you already have)
//   create   = "Create account" with your email
//   register = you just signed in with Google and need a name and handle
type Mode = 'signin' | 'create' | 'register';

// SIGN IN SCREEN, in up to three steps:
//   1. type your email (Google lives in the sign-in pop-up, not here)
//   2. type the 6-digit code we sent
//   3. new here? register: pick the name and handle friends will see
// Either way the same email code works: an email we know signs you in, a new one
// makes a new account. The words just match what you picked in the pop-up.
export default function SignInScreen() {
  const { colors } = useAppTheme();
  const account = useAccount();
  const tabs = useTabs();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode =
    params.mode === 'create' || params.mode === 'register' ? params.mode : 'signin';

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false); // step 2: typing the code
  // Step 3: name and handle. Coming from Google in the pop-up? Start right here.
  const [registering, setRegistering] = useState(mode === 'register' && account.me !== null);
  const [name, setName] = useState(account.me?.displayName ?? '');
  const [handle, setHandle] = useState(account.me?.handle ?? '');
  const [problem, setProblem] = useState('');

  // Signed in! Anyone without a handle yet (new accounts) registers first.
  function signedIn(result: SignedIn) {
    if (needsRegistering(result)) {
      setName(result.user.displayName); // from Google, or the start of your email
      setHandle(result.user.handle ?? '');
      setRegistering(true);
      return;
    }
    router.back();
  }

  // Leaving the "pick a name and handle" step would leave a half-made account with no
  // handle. So "back" there means "not now": sign out and go home. (You can sign in
  // again any time and pick up here.)
  async function cancelRegistering() {
    await account.signOut();
    router.replace('/');
  }

  // Step 3: save the name and handle, then go to your new profile.
  async function register() {
    setProblem('');
    if (!name.trim()) return setProblem('Please type your name.');
    if (handle.length < 3) return setProblem('Handles need at least 3 letters, numbers or _.');
    try {
      account.setMe(
        await account.api<Me>('/api/me', 'PATCH', { displayName: name.trim(), handle }),
      );
      tabs.setTab('profile');
      router.back();
    } catch (e) {
      setProblem((e as Error).message); // e.g. "@sam is taken"
    }
  }


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
      signedIn(await account.emailVerify(email.trim(), code.trim()));
    } catch (e) {
      setProblem((e as Error).message);
    }
  }

  if (registering) {
    return (
      <Screen>
        <View style={styles.topBar}>
          <BackButton onPress={cancelRegistering} />
          <Text style={[styles.topTitle, { color: colors.text }]}>Create account</Text>
        </View>

        <View>
          <Text style={[styles.title, { color: colors.text }]}>Almost done!</Text>
          <Text style={[styles.subtitle, { color: colors.softText }]}>
            This is how friends will see you, and how they can find you. Your handle
            can&apos;t be changed later. Going back signs you out.
          </Text>
        </View>

        <Field
          label="Name"
          value={name}
          onChangeText={setName}
          placeholder="Sam Lee"
          maxLength={24}
          autoComplete="name"
        />
        <Field
          label="Handle"
          value={handle}
          onChangeText={(typed) => setHandle(tidyHandle(typed))}
          placeholder="sam_eats"
          autoCapitalize="none"
          maxLength={20}
        />
        <Message text="3 to 20 letters, numbers or _. Friends add you with @handle." problem={false} />

        <ChunkyButton label="Create account" primary onPress={register} />
        <Message text={problem} />
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.topBar}>
        <BackButton onPress={() => router.back()} />
        <Text style={[styles.topTitle, { color: colors.text }]}>
          {mode === 'create' ? 'Create account' : 'Sign in'}
        </Text>
      </View>

      <View>
        <Text style={[styles.title, { color: colors.text }]}>
          {mode === 'create' ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          {mode === 'create'
            ? "Save your taste, add friends, and get invited to their games. We'll email you a code, no password needed."
            : "Type your email and we'll send you a code. No password needed."}
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
          <ChunkyButton
            label={mode === 'create' ? 'Create account' : 'Email me a code'}
            primary
            onPress={sendCode}
          />
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
          <ChunkyButton
            label={mode === 'create' ? 'Verify' : 'Sign in'}
            primary
            onPress={checkCode}
          />
          <ChunkyButton label="Use a different email" onPress={() => setCodeSent(false)} />
        </>
      )}


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
