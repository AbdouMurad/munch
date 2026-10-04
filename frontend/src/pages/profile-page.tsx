import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Me, Preferences, useAccount } from '@/account';
import { Chip, Field, Message, SmallButton, UserAvatar } from '@/components/account-ui';
import { ChunkyButton } from '@/components/ui';
import { Page, SignInFirst } from '@/pages/page';
import { useAppTheme } from '@/theme';

// The dietary needs you can pick. The words on the right are what the server stores.
const DIETARY: [string, string][] = [
  ['Vegetarian', 'vegetarian'],
  ['Vegan', 'vegan'],
  ['Halal', 'halal'],
  ['Gluten free', 'gluten_free'],
];
// Profile pictures are shrunk to this many pixels wide (and tall) before uploading.
const PICTURE_SIZE = 256;

// Handles are 3 to 20 letters, numbers or _. As you type we quietly tidy it up:
// "@Sam Eats!" becomes "Sam_Eats".
function tidyHandle(typed: string) {
  return typed
    .replace(/^@+/, '') // people often type the @ they see in the app
    .replace(/\s+/g, '_')
    .replace(/[^A-Za-z0-9_]/g, '')
    .slice(0, 20);
}

// Add the thing to the list if it's missing, take it out if it's there.
function flip<T>(list: T[], item: T) {
  return list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
}

// PROFILE PAGE (swipe right from Play): your picture, name, handle, price range and diet.
export default function ProfilePage() {
  const account = useAccount();

  if (!account.ready) return <Page title="Profile">{null}</Page>;
  if (!account.me) {
    return (
      <Page title="Profile">
        <SignInFirst why="Sign in to save what you like to eat, so every game deals you better spots." />
      </Page>
    );
  }
  // "key" makes a fresh form for each account, so the boxes always start with
  // that person's saved name and handle (and never someone else's).
  return <ProfileForm key={account.me.id} me={account.me} />;
}

function ProfileForm({ me }: { me: Me }) {
  const { colors } = useAppTheme();
  const account = useAccount();

  // The boxes start filled in with what's saved, and keep what you type until you save.
  const [name, setName] = useState(me.displayName);
  const [handle, setHandle] = useState(me.handle ?? '');
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [message, setMessage] = useState({ text: '', problem: false });
  const [uploading, setUploading] = useState(false);

  // Load my saved preferences once.
  useEffect(() => {
    account
      .api<Preferences>('/api/me/preferences')
      .then(setPrefs)
      .catch((e: Error) => setMessage({ text: e.message, problem: true }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save() {
    setMessage({ text: '', problem: false });
    // Check the easy things here, so we can say exactly what's wrong.
    if (!name.trim()) {
      setMessage({ text: 'Your name can’t be empty.', problem: true });
      return;
    }
    if (handle && handle.length < 3) {
      setMessage({ text: 'Handles need at least 3 letters, numbers or _.', problem: true });
      return;
    }
    try {
      // Name and handle are saved the same way: only what you changed is sent.
      const changes: Record<string, string> = {};
      if (name.trim() !== me.displayName) changes.displayName = name.trim();
      if (handle && handle !== me.handle) changes.handle = handle;
      if (Object.keys(changes).length > 0) {
        const saved = await account.api<Me>('/api/me', 'PATCH', changes);
        account.setMe(saved);
        // Show exactly what was saved (the server tidies up spaces).
        setName(saved.displayName);
        setHandle(saved.handle ?? '');
      }
      if (prefs) {
        setPrefs(await account.api<Preferences>('/api/me/preferences', 'PUT', prefs));
      }
      setMessage({ text: 'Saved!', problem: false });
    } catch (e) {
      setMessage({ text: (e as Error).message, problem: true });
    }
  }

  // Pick a photo, cut it to a square from the middle, shrink it, and upload it.
  async function changePicture() {
    setMessage({ text: '', problem: false });
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true, // lets you crop it on the phone
      aspect: [1, 1],
      quality: 1,
    });
    if (picked.canceled || !picked.assets?.length) return;
    const photo = picked.assets[0];

    setUploading(true);
    try {
      const side = Math.min(photo.width, photo.height);
      const editor = ImageManipulator.manipulate(photo.uri);
      editor.crop({
        originX: (photo.width - side) / 2,
        originY: (photo.height - side) / 2,
        width: side,
        height: side,
      });
      editor.resize({ width: PICTURE_SIZE, height: PICTURE_SIZE });
      const small = await (await editor.renderAsync()).saveAsync({
        format: SaveFormat.JPEG,
        compress: 0.8,
      });
      await account.uploadAvatar(small.uri);
      setMessage({ text: 'New picture saved!', problem: false });
    } catch (e) {
      setMessage({ text: (e as Error).message, problem: true });
    } finally {
      setUploading(false);
    }
  }

  async function removePicture() {
    try {
      await account.removeAvatar();
    } catch (e) {
      setMessage({ text: (e as Error).message, problem: true });
    }
  }

  return (
    <Page
      title="Profile"
      action={<SmallButton label="Sign out" onPress={() => account.signOut()} />}
      // Save sits under the scrolling part, so it's always on screen.
      footer={
        <>
          <Message text={message.text} problem={message.problem} />
          <ChunkyButton label="Save" primary onPress={save} />
        </>
      }>
      {/* ---------- Picture ---------- */}
      <View style={styles.pictureRow}>
        <UserAvatar name={me.displayName} avatarUrl={me.avatarUrl} size={64} />
        <View style={styles.pictureButtons}>
          <SmallButton
            label={uploading ? 'Uploading...' : me.avatarUrl ? 'Change photo' : 'Add a photo'}
            loud
            disabled={uploading}
            onPress={changePicture}
          />
          {me.avatarUrl && <SmallButton label="Remove photo" onPress={removePicture} />}
        </View>
      </View>

      {/* ---------- Name and handle ---------- */}
      {!me.handle && <Message text="Pick a handle so friends can find you." problem={false} />}
      <Field label="Name" value={name} onChangeText={setName} maxLength={24} />
      <Field
        label="Handle (letters, numbers, _)"
        value={handle}
        onChangeText={(typed) => setHandle(tidyHandle(typed))}
        placeholder="sam_eats"
        autoCapitalize="none"
        maxLength={20}
      />
      {me.email && <Text style={{ color: colors.softText }}>Signed in as {me.email}</Text>}

      {/* ---------- What I like ---------- */}
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

        </>
      )}

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
  pictureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  pictureButtons: {
    gap: 8,
    alignItems: 'flex-start',
  },
  section: {
    gap: 6,
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
