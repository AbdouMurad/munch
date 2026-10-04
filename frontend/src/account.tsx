// YOUR ACCOUNT: signing in, your profile, and invites from friends.
//
// Signing in is optional. Without it you can still make and join games.
// With it you get a profile, friends, and friends can invite you to their game.
//
// After you sign in, the server gives us a "session token": a secret that proves
// it's you. We keep it in the phone's locked storage, and send it with every request:
//   Authorization: Bearer <token>
//
// Every screen can reach into this file with:  const account = useAccount();

import * as SecureStore from 'expo-secure-store';
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { SERVER_URL, SOCKET_URL } from '@/server';

// ---------- The shapes of the things the server sends us ----------
// These copy server/munch/models.py (section "Accounts"). If that file changes, change these too.

// Me, as only I can see myself.
export type Me = {
  id: string;
  handle: string | null; // like "sam_eats". null until you pick one
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  shareLikes: boolean;
};

// Someone else, as everyone sees them (no email!).
export type PublicUser = {
  id: string;
  handle: string | null;
  displayName: string;
  avatarUrl: string | null;
};

// What kinds of places I like. All of it is optional.
export type Preferences = {
  priceLevels: number[] | null; // 1 = $, 2 = $$, ... (null = any price)
  excludeTypes: string[]; // never show these, like "fast_food_restaurant"
  favoriteTypes: string[]; // show these more, like "ramen_restaurant"
  dietary: string[]; // "vegetarian", "vegan", "halal", "gluten_free"
  maxRadiusM: number | null;
};

// One person on my friends list, or a friend request.
export type Friendship = {
  user: PublicUser;
  status: 'none' | 'outgoing' | 'incoming' | 'friends';
  since: string | null;
};

export type FriendsList = {
  friends: Friendship[];
  incoming: Friendship[]; // they asked me
  outgoing: Friendship[]; // I asked them
};

// A friend asked me to join their game.
export type Invite = {
  id: string;
  roomCode: string;
  fromUser: PublicUser;
  createdAt: string;
  expiresAt: string;
};

// What the server gives us when we sign in.
type SignedIn = {
  sessionToken: string;
  user: Me;
  isNew: boolean; // first time: we ask them to pick a handle
};

// ---------- Keeping the token safe ----------
// Phones have locked storage (SecureStore). The web doesn't, so there we use localStorage.
const TOKEN_KEY = 'munch.session';

async function loadToken(): Promise<string | null> {
  if (Platform.OS === 'web') return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  return SecureStore.getItemAsync(TOKEN_KEY);
}

async function saveToken(token: string | null) {
  if (Platform.OS === 'web') {
    if (token) globalThis.localStorage?.setItem(TOKEN_KEY, token);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

// ---------- The backpack ----------
type Account = {
  me: Me | null; // null = not signed in
  ready: boolean; // false while we check the saved token at startup
  token: string | null;
  invites: Invite[]; // friends asking me to join their game
  // Send a request to the server, signed in as me. Throws an Error with the server's message.
  api: <T>(path: string, method?: string, body?: object) => Promise<T>;
  emailStart: (email: string) => Promise<void>;
  emailVerify: (email: string, code: string) => Promise<boolean>; // true = new account
  googleSignIn: (idToken: string) => Promise<boolean>; // true = new account
  signOut: () => Promise<void>;
  setMe: (me: Me) => void;
  refreshInvites: () => Promise<void>;
  dropInvite: (inviteId: string) => void;
};

const AccountContext = createContext<Account | null>(null);

export function useAccount() {
  const account = useContext(AccountContext);
  if (!account) throw new Error('useAccount must be used inside <AccountProvider>');
  return account;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [invites, setInvites] = useState<Invite[]>([]);

  // ---------- Talking to the server ----------

  async function request<T>(
    path: string,
    method: string,
    body: object | undefined,
    withToken: string | null,
  ): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (withToken) headers.Authorization = `Bearer ${withToken}`;
    let response: Response;
    try {
      response = await fetch(SERVER_URL + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error('Could not reach the server. Is it running?');
    }
    if (response.status === 204) return undefined as T;
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? 'Something went wrong');
    return data as T;
  }

  function api<T>(path: string, method = 'GET', body?: object) {
    return request<T>(path, method, body, token);
  }

  // ---------- Signing in and out ----------

  async function finishSignIn(result: SignedIn) {
    await saveToken(result.sessionToken);
    setToken(result.sessionToken);
    setMe(result.user);
    return result.isNew;
  }

  async function emailStart(email: string) {
    await request('/api/auth/email/start', 'POST', { email }, null);
  }

  async function emailVerify(email: string, code: string) {
    const result = await request<SignedIn>('/api/auth/email/verify', 'POST', { email, code }, null);
    return finishSignIn(result);
  }

  async function googleSignIn(idToken: string) {
    const result = await request<SignedIn>('/api/auth/google', 'POST', { idToken }, null);
    return finishSignIn(result);
  }

  async function signOut() {
    try {
      await api('/api/auth/logout', 'POST');
    } catch {
      // Already signed out on the server, or offline. Forget it here anyway.
    }
    await saveToken(null);
    setToken(null);
    setMe(null);
    setInvites([]);
  }

  // ---------- Invites ----------

  async function refreshInvites() {
    if (!token) return;
    try {
      const data = await api<{ invites: Invite[] }>('/api/me/invites');
      setInvites(data.invites);
    } catch {
      // Not a big deal: we'll try again next time.
    }
  }

  function dropInvite(inviteId: string) {
    setInvites((old) => old.filter((invite) => invite.id !== inviteId));
  }

  // When the app opens: if we saved a token last time, check it still works.
  useEffect(() => {
    (async () => {
      const saved = await loadToken();
      if (saved) {
        try {
          setMe(await request<Me>('/api/me', 'GET', undefined, saved));
          setToken(saved);
        } catch {
          await saveToken(null); // expired or the account is gone
        }
      }
      setReady(true);
    })();
  }, []);

  // While signed in: load my invites, and keep a socket open so new ones arrive instantly.
  const socketRef = useRef<WebSocket | null>(null);
  useEffect(() => {
    if (!token) return;

    let stopped = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let ping: ReturnType<typeof setInterval> | undefined;

    function connect() {
      const socket = new WebSocket(`${SOCKET_URL}/ws/me?token=${token}`);
      socketRef.current = socket;
      // (Re)connected: load any invites we missed while offline.
      socket.onopen = () => refreshInvites();
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'invite:received') {
          setInvites((old) => [message.payload, ...old.filter((i) => i.id !== message.payload.id)]);
        }
      };
      // Keep the line alive, and call back a few seconds after it drops.
      ping = setInterval(() => socket.send(JSON.stringify({ type: 'ping', payload: {} })), 20000);
      socket.onclose = () => {
        clearInterval(ping);
        if (!stopped) retry = setTimeout(connect, 3000);
      };
    }
    connect();

    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(ping);
      socketRef.current?.close();
    };
  }, [token]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <AccountContext.Provider
      value={{
        me,
        ready,
        token,
        invites,
        api,
        emailStart,
        emailVerify,
        googleSignIn,
        signOut,
        setMe,
        refreshInvites,
        dropInvite,
      }}>
      {children}
    </AccountContext.Provider>
  );
}

// How to show someone in a list: "@sam_eats", or their name if they have no handle yet.
export function displayHandle(user: { handle: string | null; displayName: string }) {
  return user.handle ? `@${user.handle}` : user.displayName;
}
