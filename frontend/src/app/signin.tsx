import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Me, SignedIn, tidyHandle, useAccount } from '@/account';
import { Field, Message } from '@/components/account-ui';
import { BackButton, ChunkyButton, Screen } from '@/components/ui';
import { needsRegistering } from '@/google-signin';
import { goBackOrHome } from '@/navigation';
import { useTabs } from '@/tabs';
import { useAppTheme } from '@/theme';

// What the screen is for. The sign-in pop-up picks one:
//   signin   = "Sign in with email": email + password for an account you already have
//   create   = "Create account": name, handle, email and password, all on one page
//   register = you just signed in with Google and still need a name and handle
// (Google itself lives in the sign-in pop-up, not here.)
type Mode = 'signin' | 'create' | 'register';

// SIGN IN SCREEN
export default function SignInScreen() {
  const { colors } = useAppTheme();
  const account = useAccount();
  const tabs = useTabs();
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode =
    params.mode === 'create' || params.mode === 'register' ? params.mode : 'signin';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Google's name-and-handle step. Coming from Google in the pop-up? Start right here.
  const [registering, setRegistering] = useState(mode === 'register' && account.me !== null);
  const [name, setName] = useState(account.me?.displayName ?? '');
  const [handle, setHandle] = useState(account.me?.handle ?? '');
  const [problem, setProblem] = useState('');

  // Signed in! Anyone without a handle yet (new accounts) registers first.
  function signedIn(result: SignedIn) {
    if (needsRegistering(result)) {
      setName(result.user.displayName); // from Google
      setHandle(result.user.handle ?? '');
      setRegistering(true);
      return;
    }
    goBackOrHome();
  }

  // Leaving the "pick a name and handle" step would leave a half-made account with no
  // handle. So "back" there means "not now": sign out and go home. (You can sign in
  // again any time and pick up here.)
  async function cancelRegistering() {
    await account.signOut();
    router.replace('/');
  }

  // Google step: save the name and handle, then go to your new profile.
  async function register() {
    setProblem('');
    if (!name.trim()) return setProblem('Please type your name.');
    if (handle.length < 3) return setProblem('Handles need at least 3 letters, numbers or _.');
    try {
      account.setMe(
        await account.api<Me>('/api/me', 'PATCH', { displayName: name.trim(), handle }),
      );
      tabs.setTab('profile');
      goBackOrHome();
    } catch (e) {
      setProblem((e as Error).message); // e.g. "@sam is taken"
    }
  }


  // Sign in: email + password.
  async function logIn() {
    setProblem('');
    if (!email.trim() || !password) return setProblem('Type your email and password.');
    try {
      signedIn(await account.logIn(email.trim(), password));
    } catch (e) {
      setProblem((e as Error).message); // e.g. "Wrong email or password"
    }
  }

  // Create account: everything on one page, then straight to your new profile.
  async function createAccount() {
    setProblem('');
    if (!name.trim()) return setProblem('Please type your name.');
    if (handle.length < 3) return setProblem('Handles need at least 3 letters, numbers or _.');
    if (!email.includes('@')) return setProblem('Please type a real email address.');
    if (password.length < 8) return setProblem('Passwords need at least 8 characters.');
    try {
      await account.register({ email: email.trim(), password, displayName: name.trim(), handle });
      tabs.setTab('profile');
      goBackOrHome();
    } catch (e) {
      setProblem((e as Error).message); // e.g. "@sam is taken"
    }
  }

  // Switch between "Sign in" and "Create account" without leaving the screen.
  function switchTo(next: 'signin' | 'create') {
    setProblem('');
    router.setParams({ mode: next });
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

  const creating = mode === 'create';

  return (
    <Screen>
      <View style={styles.topBar}>
        <BackButton onPress={goBackOrHome} />
        <Text style={[styles.topTitle, { color: colors.text }]}>
          {creating ? 'Create account' : 'Sign in'}
        </Text>
      </View>

      <View>
        <Text style={[styles.title, { color: colors.text }]}>
          {creating ? 'Create your account' : 'Welcome back'}
        </Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          {creating
            ? 'Save your taste, add friends, and get invited to their games.'
            : 'Sign in with your email and password.'}
        </Text>
      </View>

      {/* Creating an account? Name and handle first: how friends see and find you. */}
      {creating && (
        <>
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
          <Message
            text="3 to 20 letters, numbers or _. Friends add you with @handle. It can't be changed later."
            problem={false}
          />
        </>
      )}

      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoComplete="email"
        textContentType="emailAddress"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder={creating ? 'At least 8 characters' : 'Your password'}
        secureTextEntry={!showPassword} // dots instead of letters
        autoCapitalize="none"
        // Lets the phone's password manager fill it in (or suggest a strong one).
        autoComplete={creating ? 'new-password' : 'current-password'}
        textContentType={creating ? 'newPassword' : 'password'}
        onSubmitEditing={creating ? createAccount : logIn}
      />
      <Pressable accessibilityRole="button" onPress={() => setShowPassword(!showPassword)}>
        <Text style={[styles.link, { color: colors.softText }]}>
          {showPassword ? 'Hide password' : 'Show password'}
        </Text>
      </Pressable>

      <ChunkyButton
        label={creating ? 'Create account' : 'Sign in'}
        primary
        onPress={creating ? createAccount : logIn}
      />
      <Message text={problem} />

      <Pressable accessibilityRole="button" onPress={() => switchTo(creating ? 'signin' : 'create')}>
        <Text style={[styles.link, styles.switch, { color: colors.text }]}>
          {creating ? 'Already have an account? Sign in' : 'New here? Create an account'}
        </Text>
      </Pressable>
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
  link: {
    fontSize: 14,
    fontWeight: '700',
  },
  switch: {
    textAlign: 'center',
    textDecorationLine: 'underline',
  },
});
