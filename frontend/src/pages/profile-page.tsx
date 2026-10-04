import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Me, Preferences, useAccount } from '@/account';
import { Chip, Field, Message } from '@/components/account-ui';
import { ChunkyButton } from '@/components/ui';
import { Page, SignInFirst } from '@/pages/page';
import { useTabs } from '@/tabs';
import { useAppTheme } from '@/theme';

// The choices we offer. The words on the right are what Google calls each kind of place.
const CUISINES: [string, string][] = [
  ['Ramen', 'ramen_restaurant'],
  ['Sushi', 'sushi_restaurant'],
  ['Pizza', 'pizza_restaurant'],
  ['Burgers', 'hamburger_restaurant'],
  ['Thai', 'thai_restaurant'],
  ['Indian', 'indian_restaurant'],
  ['Mexican', 'mexican_restaurant'],
  ['Korean', 'korean_restaurant'],
  ['Italian', 'italian_restaurant'],
  ['Vietnamese', 'vietnamese_restaurant'],
  ['Chinese', 'chinese_restaurant'],
  ['Fast food', 'fast_food_restaurant'],
];
const DIETARY: [string, string][] = [
  ['Vegetarian', 'vegetarian'],
  ['Vegan', 'vegan'],
  ['Halal', 'halal'],
  ['Gluten free', 'gluten_free'],
];
const DISTANCES = [1000, 3000, 5000, 10000];

// Add the thing to the list if it's missing, take it out if it's there.
function flip<T>(list: T[], item: T) {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

// PROFILE PAGE (swipe right from Play): your name and handle, and what you like to eat.
export default function ProfilePage() {
  const { colors } = useAppTheme();
  const account = useAccount();
  const tabs = useTabs();
  const me = account.me;

  const [name, setName] = useState(me?.displayName ?? '');
  const [handle, setHandle] = useState(me?.handle ?? '');
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [message, setMessage] = useState({ text: '', problem: false });

  // Load my saved preferences once.
  useEffect(() => {
    if (!me) return;
    account
      .api<Preferences>('/api/me/preferences')
      .then(setPrefs)
      .catch((e: Error) => setMessage({ text: e.message, problem: true }));
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!account.ready) return <Page title="Profile">{null}</Page>;
  if (!me) {
    return (
      <Page title="Profile">
        <SignInFirst why="Sign in to save what you like to eat, so every game deals you better spots." />
      </Page>
    );
  }

  async function save() {
    if (!prefs) return;
    setMessage({ text: '', problem: false });
    try {
      const changes: Record<string, string> = {};
      if (name.trim() !== me!.displayName) changes.displayName = name.trim();
      if (handle.trim() && handle.trim() !== me!.handle) changes.handle = handle.trim();
      if (Object.keys(changes).length > 0) {
        account.setMe(await account.api<Me>('/api/me', 'PATCH', changes));
      }
      setPrefs(await account.api<Preferences>('/api/me/preferences', 'PUT', prefs));
      setMessage({ text: 'Saved!', problem: false });
    } catch (e) {
      setMessage({ text: (e as Error).message, problem: true });
    }
  }

  async function signOut() {
    await account.signOut(); // this page then shows "Sign in" again
  }

  return (
    <Page title="Profile">
      {!me.handle && (
        <Message text="Pick a handle so friends can find you." problem={false} />
      )}

      <Field label="Name" value={name} onChangeText={setName} maxLength={24} />
      <Field
        label="Handle (letters, numbers, _)"
        value={handle}
        onChangeText={setHandle}
        placeholder="sam_eats"
        autoCapitalize="none"
        maxLength={20}
      />
      {me.email && (
        <Text style={{ color: colors.softText }}>Signed in as {me.email}</Text>
      )}

      {prefs && (
        <>
          <Section title="Price">
            {[1, 2, 3, 4].map((level) => (
              <Chip
                key={level}
                label={'$'.repeat(level)}
                on={(prefs.priceLevels ?? []).includes(level)}
                onPress={() => {
                  const levels = flip(prefs.priceLevels ?? [], level);
                  setPrefs({ ...prefs, priceLevels: levels.length ? levels : null });
                }}
              />
            ))}
          </Section>

          <Section title="Dietary">
            {DIETARY.map(([label, value]) => (
              <Chip
                key={value}
                label={label}
                on={prefs.dietary.includes(value)}
                onPress={() => setPrefs({ ...prefs, dietary: flip(prefs.dietary, value) })}
              />
            ))}
          </Section>

          <Section title="Favourites">
            {CUISINES.map(([label, value]) => (
              <Chip
                key={value}
                label={label}
                on={prefs.favoriteTypes.includes(value)}
                onPress={() =>
                  setPrefs({ ...prefs, favoriteTypes: flip(prefs.favoriteTypes, value) })
                }
              />
            ))}
          </Section>

          <Section title="Never show me">
            {CUISINES.map(([label, value]) => (
              <Chip
                key={value}
                label={label}
                on={prefs.excludeTypes.includes(value)}
                onPress={() =>
                  setPrefs({ ...prefs, excludeTypes: flip(prefs.excludeTypes, value) })
                }
              />
            ))}
          </Section>

          <Section title="How far I'll go">
            {DISTANCES.map((m) => (
              <Chip
                key={m}
                label={`${m / 1000} km`}
                on={prefs.maxRadiusM === m}
                onPress={() =>
                  setPrefs({ ...prefs, maxRadiusM: prefs.maxRadiusM === m ? null : m })
                }
              />
            ))}
          </Section>
        </>
      )}

      <Message text={message.text} problem={message.problem} />
      <ChunkyButton label="Save" primary onPress={save} />
      <ChunkyButton label="Friends" onPress={() => tabs.setTab('friends')} />
      <ChunkyButton label="Sign out" onPress={signOut} />
    </Page>
  );
}

// A heading with a wrap-around row of chips under it.
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      <View style={styles.chips}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap', // chips go onto the next line when they run out of room
    gap: 8,
  },
});
