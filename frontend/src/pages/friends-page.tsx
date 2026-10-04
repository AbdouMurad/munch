import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { displayHandle, Friendship, FriendsList, useAccount } from '@/account';
import { Field, Message, SmallButton } from '@/components/account-ui';
import { Avatar, ChunkyButton } from '@/components/ui';
import { initials } from '@/game';
import { Page, SignInFirst } from '@/pages/page';
import { useAppTheme } from '@/theme';

// FRIENDS PAGE (swipe left from Play): add people by their handle, answer requests,
// see your friends. You can also add someone from a game lobby ("Add friend").
export default function FriendsPage() {
  const { colors } = useAppTheme();
  const account = useAccount();

  const [list, setList] = useState<FriendsList | null>(null);
  const [handle, setHandle] = useState('');
  const [message, setMessage] = useState({ text: '', problem: false });

  async function reload() {
    try {
      setList(await account.api<FriendsList>('/api/friends'));
    } catch (e) {
      setMessage({ text: (e as Error).message, problem: true });
    }
  }

  useEffect(() => {
    if (!account.me) return;
    account
      .api<FriendsList>('/api/friends')
      .then(setList)
      .catch((e: Error) => setMessage({ text: e.message, problem: true }));
  }, [account.me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!account.ready) return <Page title="Friends">{null}</Page>;
  if (!account.me) {
    return (
      <Page title="Friends">
        <SignInFirst why="Sign in to add friends and invite them straight into your games." />
      </Page>
    );
  }

  // Run one change on the server, then load the list again.
  async function change(path: string, method: string, body?: object, done = '') {
    setMessage({ text: '', problem: false });
    try {
      await account.api(path, method, body);
      if (done) setMessage({ text: done, problem: false });
      await reload();
    } catch (e) {
      setMessage({ text: (e as Error).message, problem: true });
    }
  }

  function add() {
    const typed = handle.trim().replace(/^@/, '');
    if (!typed) return;
    setHandle('');
    change('/api/friends', 'POST', { handle: typed }, `Sent a request to @${typed}`);
  }

  return (
    <Page title="Friends">
      <Field
        label="Add by handle"
        value={handle}
        onChangeText={setHandle}
        placeholder="@sam_eats"
        autoCapitalize="none"
        onSubmitEditing={add}
      />
      <ChunkyButton label="Send request" primary onPress={add} />
      <Message text={message.text} problem={message.problem} />

      {list && (
        <>
          <People title="Asked to be your friend" people={list.incoming}>
            {(f) => (
              <>
                <SmallButton
                  label="Accept"
                  loud
                  onPress={() => change(`/api/friends/${f.user.id}/accept`, 'POST')}
                />
                <SmallButton
                  label="No"
                  onPress={() => change(`/api/friends/${f.user.id}`, 'DELETE')}
                />
              </>
            )}
          </People>

          <People title="Waiting for them" people={list.outgoing}>
            {(f) => (
              <SmallButton
                label="Cancel"
                onPress={() => change(`/api/friends/${f.user.id}`, 'DELETE')}
              />
            )}
          </People>

          <People title={`Your friends (${list.friends.length})`} people={list.friends}>
            {(f) => (
              <SmallButton
                label="Remove"
                onPress={() => change(`/api/friends/${f.user.id}`, 'DELETE')}
              />
            )}
          </People>

          {list.friends.length === 0 && list.incoming.length === 0 && (
            <Text style={{ color: colors.softText }}>
              No friends yet. Add someone by their handle, or tap &quot;Add friend&quot; next to
              them in a game lobby.
            </Text>
          )}
        </>
      )}
    </Page>
  );
}

// A titled list of people, each with some buttons on the right.
// Shows nothing if the list is empty.
function People({ title, people, children }: {
  title: string;
  people: Friendship[];
  children: (f: Friendship) => React.ReactNode;
}) {
  const { colors } = useAppTheme();
  if (people.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>{title}</Text>
      {people.map((f) => (
        <View key={f.user.id} style={[styles.row, { borderColor: colors.text }]}>
          <Avatar initials={initials(f.user.displayName)} />
          <View style={styles.who}>
            <Text style={[styles.name, { color: colors.text }]}>{f.user.displayName}</Text>
            <Text style={{ color: colors.softText }}>{displayHandle(f.user)}</Text>
          </View>
          {children(f)}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 2,
  },
  who: {
    flex: 1,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
  },
});
