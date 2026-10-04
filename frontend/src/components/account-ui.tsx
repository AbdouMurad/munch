// Building blocks for the account features: text boxes, little buttons, chips,
// the invites inbox on the home screen, and the friend buttons in the lobby.

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, TextInputProps, View } from 'react-native';

import { ChunkyBox } from '@/components/ui';
import { displayHandle, FriendsList, Invite, useAccount } from '@/account';
import { Member, Room, Session, useGame } from '@/game';
import { useAppTheme } from '@/theme';

// ---------- Field ----------
// A label with a text box under it.
export function Field({ label, ...input }: { label: string } & TextInputProps) {
  const { colors } = useAppTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
      <ChunkyBox background={colors.card} radius={12}>
        <TextInput
          accessibilityLabel={label}
          placeholderTextColor={colors.softText}
          style={[styles.input, { color: colors.text }]}
          autoCorrect={false}
          {...input}
        />
      </ChunkyBox>
    </View>
  );
}

// ---------- SmallButton ----------
// A small outlined button, for things like "Accept" in a list.
export function SmallButton({ label, onPress, loud = false, disabled = false }: {
  label: string;
  onPress: () => void;
  loud?: boolean; // filled in, for the main choice
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.smallButton,
        {
          backgroundColor: loud ? colors.primary : colors.card,
          borderColor: colors.text,
          opacity: disabled ? 0.5 : 1,
        },
      ]}>
      <Text style={[styles.smallButtonText, { color: loud ? colors.onPrimary : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ---------- Chip ----------
// A pill you tap to turn on and off (like "Vegan").
export function Chip({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: on ? colors.primary : colors.card, borderColor: colors.text },
      ]}>
      <Text style={[styles.chipText, { color: on ? colors.onPrimary : colors.text }]}>{label}</Text>
    </Pressable>
  );
}

// ---------- Message ----------
// One line of red (problem) or quiet (info) text. Shows nothing when empty.
export function Message({ text, problem = true }: { text: string; problem?: boolean }) {
  const { colors } = useAppTheme();
  if (!text) return null;
  return (
    <Text style={[styles.message, { color: problem ? colors.accent : colors.softText }]}>
      {text}
    </Text>
  );
}

// ---------- InvitesInbox ----------
// On the home screen: "Sam invited you to their game" with Join / No thanks.
export function InvitesInbox() {
  const { colors } = useAppTheme();
  const account = useAccount();
  const game = useGame();
  const [problem, setProblem] = useState('');

  if (account.invites.length === 0) return null;

  async function join(invite: Invite) {
    setProblem('');
    try {
      const session = await account.api<Session>(`/api/invites/${invite.id}/accept`, 'POST');
      account.dropInvite(invite.id);
      game.enterWithSession(session); // goes to the lobby once the room arrives
    } catch (e) {
      account.dropInvite(invite.id); // most likely the game already started
      setProblem((e as Error).message);
    }
  }

  async function decline(invite: Invite) {
    account.dropInvite(invite.id);
    try {
      await account.api(`/api/invites/${invite.id}/decline`, 'POST');
    } catch {
      // It was probably already gone. Nothing to do.
    }
  }

  return (
    <View style={styles.inbox}>
      {account.invites.map((invite) => (
        <ChunkyBox key={invite.id} background={colors.card} style={styles.inviteCard}>
          <Text style={[styles.inviteText, { color: colors.text }]}>
            {invite.fromUser.displayName} invited you to their game
          </Text>
          <View style={styles.row}>
            <SmallButton label="Join" loud onPress={() => join(invite)} />
            <SmallButton label="No thanks" onPress={() => decline(invite)} />
          </View>
        </ChunkyBox>
      ))}
      <Message text={problem} />
    </View>
  );
}

// ---------- Friends in the lobby ----------
// Loads my friends list once, so the lobby knows who is already a friend.
function useFriends() {
  const account = useAccount();
  const [friends, setFriends] = useState<FriendsList | null>(null);
  useEffect(() => {
    if (!account.me) return;
    account
      .api<FriendsList>('/api/friends')
      .then(setFriends)
      .catch(() => setFriends(null));
  }, [account.me?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return friends;
}

// The little button next to a player in the lobby: "Add friend".
// Only shows for signed-in players who aren't me and aren't already my friend.
export function AddFriendButton({ member }: { member: Member }) {
  const account = useAccount();
  const friends = useFriends();
  const [sent, setSent] = useState('');

  if (!account.me || !member.userId || member.userId === account.me.id) return null;
  const known = [...(friends?.friends ?? []), ...(friends?.outgoing ?? [])].some(
    (f) => f.user.id === member.userId,
  );
  if (known) return null;
  if (sent) return <Message text={sent} problem={false} />;

  async function add() {
    try {
      const result = await account.api<{ status: string }>('/api/friends', 'POST', {
        userId: member.userId,
      });
      setSent(result.status === 'friends' ? 'Friends!' : 'Request sent');
    } catch (e) {
      setSent((e as Error).message);
    }
  }

  return <SmallButton label="Add friend" onPress={add} />;
}

// The "Invite friends" list under the players in the lobby.
// Each friend who isn't in the room yet gets an Invite button. If they have the app
// open they see it straight away; otherwise it's waiting on their home screen.
export function InviteFriends({ room }: { room: Room }) {
  const { colors } = useAppTheme();
  const account = useAccount();
  const friends = useFriends();
  const [invited, setInvited] = useState<string[]>([]);
  const [problem, setProblem] = useState('');

  if (!account.me || !friends) return null;
  const inRoom = new Set(room.members.map((m) => m.userId));
  const notHere = friends.friends.filter((f) => !inRoom.has(f.user.id));
  if (notHere.length === 0) return null;

  async function invite(userId: string) {
    setProblem('');
    try {
      await account.api(`/api/rooms/${room.code}/invites`, 'POST', { userIds: [userId] });
      setInvited((old) => [...old, userId]);
    } catch (e) {
      setProblem((e as Error).message);
    }
  }

  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.text }]}>Invite friends</Text>
      {notHere.map((f) => (
        <View key={f.user.id} style={[styles.listRow, { borderColor: colors.text }]}>
          <Text style={[styles.listName, { color: colors.text }]}>{displayHandle(f.user)}</Text>
          {invited.includes(f.user.id) ? (
            <Message text="Invited" problem={false} />
          ) : (
            <SmallButton label="Invite" onPress={() => invite(f.user.id)} />
          )}
        </View>
      ))}
      <Message text={problem} />
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    fontSize: 17,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  smallButton: {
    borderWidth: 2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  smallButtonText: {
    fontSize: 14,
    fontWeight: '800',
  },
  chip: {
    borderWidth: 2,
    borderRadius: 999, // as round as it gets: a pill
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '700',
  },
  message: {
    fontSize: 14,
    fontWeight: '700',
  },
  inbox: {
    gap: 10,
    marginTop: 12,
  },
  inviteCard: {
    padding: 14,
    gap: 10,
  },
  inviteText: {
    fontSize: 16,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 2,
  },
  listName: {
    fontSize: 16,
    fontWeight: '600',
  },
});
