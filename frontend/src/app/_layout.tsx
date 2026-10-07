import { router, Stack, usePathname } from 'expo-router';
import { ReactNode, useEffect } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';

import { AccountProvider, useAccount } from '@/account';
import { CityProvider } from '@/city';
import { GameProvider } from '@/game';
import { TabsProvider } from '@/tabs';
import { ThemeProvider, useAppTheme } from '@/theme';

// ThemeProvider gives every screen our colors (light or dark).
// CityProvider gives every screen which city we're in (for the logo and the taxi).
// AccountProvider gives every screen who is signed in (and their invites).
// GameProvider gives every screen the connection to the server.
// TabsProvider remembers which home page is showing (Profile, Play, Friends).
// A Stack shows one screen at a time, with no tab bar and no header.
// AppFrame keeps it phone-sized on a big screen (see below).
export default function RootLayout() {
  return (
    <ThemeProvider>
      <CityProvider>
        <AccountProvider>
          <GameProvider>
            <TabsProvider>
              <AppFrame>
                <Stack screenOptions={{ headerShown: false }} />
              </AppFrame>
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

// The app is made for phones. On a laptop or a big tablet, stretching every card across the
// whole screen looks wrong, so the app sits in a phone-width column in the middle, with
// thin lines down its sides. On a phone (or any screen narrower than the column) this
// changes nothing.
const COLUMN_WIDTH = 480;

function AppFrame({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  const { width } = useWindowDimensions();
  const wide = width > COLUMN_WIDTH + 40;
  return (
    <View style={[styles.desk, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.column,
          wide && [styles.framed, { borderColor: colors.text, backgroundColor: colors.background }],
        ]}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Everything around the app (only visible on a wide screen).
  desk: {
    flex: 1,
    alignItems: 'center',
  },
  // The app itself: full width on a phone, at most COLUMN_WIDTH on anything bigger.
  column: {
    flex: 1,
    width: '100%',
    maxWidth: COLUMN_WIDTH,
  },
  framed: {
    borderLeftWidth: 2,
    borderRightWidth: 2,
  },
});
