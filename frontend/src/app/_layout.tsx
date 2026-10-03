import { Stack } from 'expo-router';

// A Stack shows one screen at a time, with no tab bar and no header.
export default function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
