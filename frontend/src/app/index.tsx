import { useEffect, useRef, useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAccount } from '@/account';
import { UserAvatar } from '@/components/account-ui';
import { Eye } from '@/components/ui';
import FriendsPage from '@/pages/friends-page';
import PlayPage from '@/pages/play-page';
import ProfilePage from '@/pages/profile-page';
import { Tab, TAB_ORDER, useTabs } from '@/tabs';
import { useAppTheme } from '@/theme';

// The page for each tab, in the same left-to-right order as TAB_ORDER.
const PAGES: Record<Tab, () => React.ReactNode> = {
  profile: ProfilePage,
  play: PlayPage,
  friends: FriendsPage,
};

// HOME SCREEN: three pages side by side, like Instagram.
//     Profile   <-   Play   ->   Friends
// Swipe right for your profile, swipe left for your friends, or tap the bar at the bottom.
export default function HomeScreen() {
  const { colors } = useAppTheme();
  // How wide one page is. It starts at 0 and gets its real value when we MEASURE
  // the space the pages live in (see onLayout below).
  // WHY measure instead of asking "how wide is the window?": the website is built
  // ahead of time on a computer with no window, so that answer was 0, and it got
  // stuck at 0. Every page ended up zero wide, squashed against the left edge.
  const [width, setWidth] = useState(0);
  const { tab, setTab } = useTabs();
  const [pageHeight, setPageHeight] = useState(0); // the space between the notch and the bar
  const scrollRef = useRef<ScrollView>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const index = TAB_ORDER.indexOf(tab);

  // False until we have jumped to the starting page once.
  const hasOpened = useRef(false);

  // When the tab changes (a tap on the bar, or another screen asked for it), slide there.
  useEffect(() => {
    if (width === 0) return; // not measured yet: there is nowhere to slide to
    // The very first time, JUMP straight to the right page (Play, unless another
    // screen picked one). After that, slide smoothly.
    scrollRef.current?.scrollTo({ x: index * width, animated: hasOpened.current });
    hasOpened.current = true;
  }, [index, width]);

  // While you swipe, wait until the pages stop moving, then light up that tab in the bar.
  // (Waiting matters: a tap from Profile to Friends slides PAST Play on the way.)
  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (width === 0) return; // not measured yet
    const x = event.nativeEvent.contentOffset.x;
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const landedOn = TAB_ORDER[Math.round(x / width)];
      if (landedOn) setTab(landedOn);
    }, 80);
  }

  return (
    <SafeAreaView
      edges={['top', 'bottom']}
      style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScrollView
        ref={scrollRef}
        horizontal
        pagingEnabled // stop exactly on a page, never halfway between two
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        // Measure the space the pages get. This runs when the screen first shows,
        // and again whenever its size changes (a phone turning sideways, a browser
        // window being resized). The effect above then jumps to the right page.
        onLayout={(event) => {
          setWidth(event.nativeEvent.layout.width);
          setPageHeight(event.nativeEvent.layout.height);
        }}
        // Keep the pages invisible until they have been measured, so you never
        // see them squashed for a moment while the page loads.
        style={[styles.pager, { opacity: width === 0 ? 0 : 1 }]}>
        {TAB_ORDER.map((name) => {
          const PageContent = PAGES[name];
          return (
            // Each page is exactly as wide and exactly as tall as the space it has,
            // so a long page scrolls instead of running off behind the bar.
            <View key={name} style={{ width, height: pageHeight || undefined }}>
              <PageContent />
            </View>
          );
        })}
      </ScrollView>

      <NavBar />
    </SafeAreaView>
  );
}

// ---------- The bar at the bottom ----------
// One button per page. The page you're on is filled in.
function NavBar() {
  const { colors } = useAppTheme();
  const { tab, setTab } = useTabs();
  const account = useAccount();

  const items: { name: Tab; label: string; icon: React.ReactNode }[] = [
    {
      name: 'profile',
      label: 'Profile',
      // Signed in: your picture (or initials), like Instagram's little profile picture.
      icon: account.me ? (
        <UserAvatar name={account.me.displayName} avatarUrl={account.me.avatarUrl} size={34} />
      ) : (
        <View style={[styles.personIcon, { borderColor: colors.text }]} />
      ),
    },
    { name: 'play', label: 'Play', icon: <Eye size={34} /> },
    {
      name: 'friends',
      label: 'Friends',
      // Two little overlapping circles = "people".
      icon: (
        <View style={styles.friendsIcon}>
          <View style={[styles.friendDot, { borderColor: colors.text }]} />
          <View
            style={[
              styles.friendDot,
              styles.secondFriend,
              { borderColor: colors.text, backgroundColor: colors.card },
            ]}
          />
        </View>
      ),
    },
  ];

  return (
    <View style={[styles.bar, { backgroundColor: colors.card, borderColor: colors.text }]}>
      {items.map((item) => {
        const on = item.name === tab;
        return (
          <Pressable
            key={item.name}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={item.label}
            onPress={() => setTab(item.name)}
            style={[styles.barItem, on && { backgroundColor: colors.soft }]}>
            <View style={styles.iconBox}>{item.icon}</View>
            <Text
              style={[
                styles.barLabel,
                { color: on ? colors.text : colors.softText, fontWeight: on ? '900' : '600' },
              ]}>
              {item.label}
            </Text>
            {/* A little bar under the page you're on. */}
            <View
              style={[styles.underline, { backgroundColor: on ? colors.accent : 'transparent' }]}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  pager: {
    flex: 1,
  },

  bar: {
    flexDirection: 'row',
    borderTopWidth: 2,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 10, // so the highlighted tab doesn't touch the bottom of the screen
  },
  barItem: {
    flex: 1, // three equal slots
    alignItems: 'center',
    gap: 2,
    paddingTop: 6,
    borderRadius: 12,
  },
  iconBox: {
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barLabel: {
    fontSize: 12,
  },
  underline: {
    width: 28,
    height: 4,
    borderRadius: 2,
    marginTop: 4,
    marginBottom: 4,
  },

  personIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
  },
  friendsIcon: {
    width: 40,
    height: 30,
  },
  friendDot: {
    position: 'absolute',
    left: 2,
    top: 2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
  },
  secondFriend: {
    left: 12,
  },
});
