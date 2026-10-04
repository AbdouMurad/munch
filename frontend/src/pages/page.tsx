// Shared pieces for the three home pages (Profile, Play, Friends).

import { ReactNode, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { SignInSheet } from '@/components/sign-in-sheet';
import { ChunkyButton } from '@/components/ui';
import { useAppTheme } from '@/theme';

// ---------- Page ----------
// Like <Screen>, but without its own notch padding: the home screen around the
// pages already keeps everything clear of the notch and the bottom bar.
export function Page({ title, action, footer, children }: {
  title: string;
  action?: ReactNode; // a button on the right of the title, like "Sign out"
  footer?: ReactNode; // stays at the bottom, always visible, like a "Save" button
  children: ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.page, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          {action}
        </View>
        {children}
      </ScrollView>
      {footer && <View style={[styles.footer, { borderColor: colors.text }]}>{footer}</View>}
    </View>
  );
}

// ---------- SignInFirst ----------
// What Profile and Friends show before you sign in.
// Tapping "Sign in" opens the pop-up: sign in with email, create an account, or Google.
export function SignInFirst({ why }: { why: string }) {
  const { colors } = useAppTheme();
  const [choosing, setChoosing] = useState(false);
  return (
    <View style={styles.signIn}>
      <Text style={[styles.why, { color: colors.softText }]}>{why}</Text>
      <ChunkyButton label="Sign in" primary onPress={() => setChoosing(true)} />
      <SignInSheet visible={choosing} onClose={() => setChoosing(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 12,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 6,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    fontWeight: '900',
  },
  signIn: {
    flex: 1, // fill the page under the title...
    justifyContent: 'center', // ...and sit in the middle of it, not stuck at the top
    gap: 16,
    paddingBottom: 60, // a little above the true middle looks more centered
  },
  why: {
    fontSize: 16,
    lineHeight: 23,
  },
});
