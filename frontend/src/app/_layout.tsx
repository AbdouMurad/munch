import { router, Stack, usePathname } from 'expo-router';
import { useEffect } from 'react';

import { AccountProvider, useAccount } from '@/account';
import { CityProvider } from '@/city';
import { GameProvider } from '@/game';
import { TabsProvider } from '@/tabs';
import { ThemeProvider } from '@/theme';

// ThemeProvider gives every screen our colors (light or dark).
// CityProvider gives every screen which city we're in (for the logo and the taxi).
// AccountProvider gives every screen who is signed in (and their invites).
// GameProvider gives every screen the connection to the server.
// TabsProvider remembers which home page is showing (Profile, Play, Friends).
// A Stack shows one screen at a time, with no tab bar and no header.
export default function RootLayout() {
  return (
    <ThemeProvider>
      <CityProvider>
        <AccountProvider>
          <GameProvider>
            <TabsProvider>
              <Stack screenOptions={{ headerShown: false }} />
              <FinishSigningUp />
            </TabsProvider>
          </GameProvider>
        </AccountProvider>
      </CityProvider>
    </ThemeProvider>
  );
}

// Signed in (with Google, or a new email account) but no handle yet? Then you're not done:
// friends find you by your handle. Wherever you are (even after pressing back), this
// sends you to the "pick a name and handle" step until you finish, or cancel by signing out.
function FinishSigningUp() {
  const account = useAccount();
  const pathname = usePathname();
  const unfinished = account.ready && account.me !== null && !account.me.handle;

  useEffect(() => {
    if (unfinished && pathname !== '/signin') {
      router.replace({ pathname: '/signin', params: { mode: 'register' } });
    }
  }, [unfinished, pathname]);

  return null;
}
