// WHICH PAGE IS SHOWING on the home screen: Profile, Play, or Friends.
//
// The home screen is three pages side by side (like Instagram):
//     Profile   <-   Play   ->   Friends
// Swipe right to see your profile, swipe left to see your friends.
// Any screen can jump to a page with:  useTabs().setTab('friends')

import { createContext, ReactNode, useContext, useState } from 'react';

export type Tab = 'profile' | 'play' | 'friends';

// Left to right, the order the pages sit in.
export const TAB_ORDER: Tab[] = ['profile', 'play', 'friends'];

const TabsContext = createContext<{ tab: Tab; setTab: (tab: Tab) => void } | null>(null);

export function TabsProvider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>('play'); // the app opens on Play
  return <TabsContext.Provider value={{ tab, setTab }}>{children}</TabsContext.Provider>;
}

export function useTabs() {
  const tabs = useContext(TabsContext);
  if (!tabs) throw new Error('useTabs must be used inside <TabsProvider>');
  return tabs;
}
