// Shared pieces for the three home pages (Profile, Play, Friends).

import { router } from 'expo-router';
import { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ChunkyButton } from '@/components/ui';
import { useAppTheme } from '@/theme';

// ---------- Page ----------
// Like <Screen>, but without its own notch padding: the home screen around the
// pages already keeps everything clear of the notch and the bottom bar.
export function Page({ title, children }: { title: string; children: ReactNode }) {
  const { colors } = useAppTheme();
  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled">
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {children}
    </ScrollView>
  );
}

// ---------- SignInFirst ----------
// What Profile and Friends show before you sign in.
export function SignInFirst({ why }: { why: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.signIn}>
      <Text style={[styles.why, { color: colors.softText }]}>{why}</Text>
      <ChunkyButton label="Sign in" primary onPress={() => router.push('/signin')} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '900',
  },
  signIn: {
    gap: 16,
    marginTop: 8,
  },
  why: {
    fontSize: 16,
    lineHeight: 23,
  },
});
