import { Stack } from 'expo-router';

import { GameProvider } from '@/game';
import { ThemeProvider } from '@/theme';

// ThemeProvider gives every screen our colors (light or dark).
// GameProvider gives every screen the connection to the server.
// A Stack shows one screen at a time, with no tab bar and no header.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <GameProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </GameProvider>
    </ThemeProvider>
  );
}
