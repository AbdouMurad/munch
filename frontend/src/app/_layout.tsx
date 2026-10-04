import { Stack } from 'expo-router';

import { AccountProvider } from '@/account';
import { GameProvider } from '@/game';
import { ThemeProvider } from '@/theme';

// ThemeProvider gives every screen our colors (light or dark).
// AccountProvider gives every screen who is signed in (and their invites).
// GameProvider gives every screen the connection to the server.
// A Stack shows one screen at a time, with no tab bar and no header.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <AccountProvider>
        <GameProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </GameProvider>
      </AccountProvider>
    </ThemeProvider>
  );
}
