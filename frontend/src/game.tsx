// THE BRIDGE between our app and the server.
//
// The server is a separate program (see /server). We talk to it in two ways:
//   1. A normal web request, ONE time, to make a room or join a room.
//   2. A "socket": a phone call that stays open, so the server can tell us
//      things the moment they happen ("Leo joined!", "The game started!").
//
// Every screen can reach into this file with:  const game = useGame();

import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { createContext, ReactNode, useContext, useRef, useState } from 'react';

// Where the server lives. On a real phone "localhost" means the PHONE, so set
// EXPO_PUBLIC_SERVER_URL to your computer's address, like http://192.168.1.5:8000
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:8000';

// Sockets use "ws" instead of "http" (and "wss" instead of "https").
const SOCKET_URL = SERVER_URL.replace('http', 'ws');

// Where the WEBSITE version of our app lives on the internet, like
// https://munch.vercel.app (no "/" on the end). Set EXPO_PUBLIC_WEB_URL once we
// put the website online. Until then this is empty and joinLink() makes a
// link that only works while you are testing (see joinLink below).
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? '';

// We don't ask for the phone's location yet, so every room is in downtown Vancouver.
// TODO: use the phone's real location
const DOWNTOWN_VANCOUVER = { lat: 49.2827, lng: -123.1207 };

// ---------- The shapes of the things the server sends us ----------
// These copy server/munch/models.py. If that file changes, change these too.

// One friend in the room.
export type Member = {
  id: string;
  displayName: string;
  isHost: boolean;
  progress: number; // how many cards they have swiped
};

// One restaurant card.
export type Card = {
  id: string;
  name: string;
  distanceM: number; // how far away, in meters
  rating: number | null;
  ratingCount: number;
  priceLevel: number | null; // 1 = $, 2 = $$, ...
  primaryType: string | null; // like "ramen_restaurant"
  address: string | null;
  mapsUri: string | null; // a link that opens the maps app
};

// Everything about the room.
export type Room = {
  code: string;
  status: string; // "lobby", "swiping", "matched", "exhausted", or "closed"
  members: Member[];
  radiusM: number;
  deckSize: number; // how many cards are in the game (0 until it starts)
};

// Our ticket into the room. The server gives us this when we create or join.
type Session = {
  code: string;
  memberId: string; // who we are
  memberToken: string; // a secret that proves it's really us
};

// The host's rules for which restaurants go in the deck.
// The server uses these to pick restaurants from its database, sorts them
// (best and closest first), and shuffles them a little so every game is different.
export type Filters = {
  priceLevels: number[]; // 1 = $, 2 = $$, ... (empty = any price)
  minRating: number | null; // like 4 for "4 stars or better" (null = any rating)
  openNow: boolean; // true = only places that are open right now
};

// How the game ended.
//   matched = true  -> EVERYONE liked the first pick. We have a winner!
//   matched = false -> nobody agreed, so picks are just the most-liked spots.
export type Result = {
  matched: boolean;
  picks: { card: Card; likes: number }[];
};

// ---------- The backpack ----------
// Everything in here can be used by any screen.
type Game = {
  room: Room | null; // null = we are not in a room
  myId: string; // which member is "me"
  deck: Card[]; // the cards to swipe, in order
  startAt: number; // which card to start on (0 = the first one)
  myYes: number; // how many times I said yes
  myNope: number; // how many times I said nope
  result: Result | null; // null = the game isn't over yet
  error: string; // a problem to show the person ('' = no problem)
  createRoom: (name: string, radiusM: number, filters: Filters) => void;
  joinRoom: (code: string, name: string) => void;
  startGame: () => void;
  swipe: (card: Card, liked: boolean) => void;
  leaveRoom: () => void;
};

const GameContext = createContext<Game | null>(null);

// Any screen calls this to reach into the backpack.
export function useGame() {
  const game = useContext(GameContext);
  if (!game) throw new Error('useGame must be used inside <GameProvider>');
  return game;
}

// This wraps the whole app (see app/_layout.tsx) and fills the backpack.
export function GameProvider({ children }: { children: ReactNode }) {
  const [room, setRoom] = useState<Room | null>(null);
  const [myId, setMyId] = useState('');
  const [deck, setDeck] = useState<Card[]>([]);
  const [startAt, setStartAt] = useState(0);
  const [myYes, setMyYes] = useState(0);
  const [myNope, setMyNope] = useState(0);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');

  // The open socket. A "ref" is a box that remembers one thing
  // without redrawing the screen when it changes.
  const socketRef = useRef<WebSocket | null>(null);

  // ---------- Talking to the server: the ONE-TIME web request ----------

  // Ask the server to create or join a room. If it says yes, we get a
  // ticket (session) and use it to open the socket.
  async function enterRoom(path: string, name: string, extras: object) {
    // No need to bother the server if the name is empty.
    if (name.trim() === '') {
      setError('Please type your name first.');
      return;
    }

    setError('');
    try {
      const response = await fetch(SERVER_URL + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: name, ...extras }),
      });
      const data = await response.json();

      // The server said no (wrong code, game already started, ...).
      if (!response.ok) {
        setError(data.error.message);
        return;
      }

      const session: Session = data;
      setMyId(session.memberId);
      openSocket(session);
    } catch {
      // We couldn't even reach the server.
      setError('Could not reach the server. Is it running?');
    }
  }

  function createRoom(name: string, radiusM: number, filters: Filters) {
    enterRoom('/api/rooms', name, {
      center: DOWNTOWN_VANCOUVER,
      radiusM: radiusM,
      filters: filters,
    });
  }

  function joinRoom(code: string, name: string) {
    enterRoom(`/api/rooms/${code}/join`, name, {});
  }

  // ---------- Talking to the server: the SOCKET ----------

  function openSocket(session: Session) {
    // Start fresh: forget anything left over from an older game.
    setRoom(null);
    setDeck([]);
    setResult(null);

    const socket = new WebSocket(
      `${SOCKET_URL}/ws/${session.code}?memberId=${session.memberId}&token=${session.memberToken}`,
    );
    socketRef.current = socket;

    // The very first thing the server sends is the room. We wait for it
    // before going to the lobby, so the lobby has something to show.
    let waitingForFirstMessage = true;

    // This runs every time the server tells us something.
    // Every message looks like: { type: "what happened", payload: { the details } }
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const payload = message.payload;

      // The room changed (someone joined or left, the game started, ...).
      if (message.type === 'room:state') {
        setRoom(payload);
        if (waitingForFirstMessage) {
          waitingForFirstMessage = false;
          router.push('/lobby');
        }
      }

      // The host pressed Start. Here are the cards! Everyone goes to the swipe screen.
      if (message.type === 'room:started') {
        setDeck(payload.deck);
        setStartAt(payload.resumeAt);
        setMyYes(0);
        setMyNope(0);
        router.replace('/swipe');
      }

      // One friend swiped a card. Update just that friend's progress.
      if (message.type === 'member:progress') {
        setRoom((oldRoom) => {
          if (!oldRoom) return oldRoom;
          const members = oldRoom.members.map((member) =>
            member.id === payload.memberId ? { ...member, progress: payload.progress } : member,
          );
          return { ...oldRoom, members: members };
        });
      }

      // Everyone liked the same restaurant. We have a winner!
      if (message.type === 'room:matched') {
        setResult({
          matched: true,
          picks: [{ card: payload.card, likes: payload.likedBy.length }],
        });
        router.replace('/winner');
      }

      // Everyone finished and nobody agreed. Show the most-liked spots instead.
      if (message.type === 'room:exhausted') {
        setResult({ matched: false, picks: payload.topPicks });
        router.replace('/winner');
      }

      // The server didn't like something we sent.
      if (message.type === 'error') {
        setError(payload.message);
      }
    };

    // This runs if the phone call drops.
    // TODO: try to call back automatically instead of just showing a message
    socket.onclose = () => setError('Lost the connection to the server.');
  }

  // Say something to the server through the socket.
  function send(type: string, payload: object) {
    socketRef.current?.send(JSON.stringify({ type: type, payload: payload }));
  }

  // Only the host can do this. The server answers everyone with "room:started".
  function startGame() {
    setError('');
    send('room:start', {});
  }

  // Tell the server what we thought of a card, and keep our own score.
  function swipe(card: Card, liked: boolean) {
    send('swipe', { restaurantId: card.id, liked: liked });
    if (liked) {
      setMyYes(myYes + 1);
    } else {
      setMyNope(myNope + 1);
    }
  }

  // Say goodbye, hang up, and go back to the home screen.
  function leaveRoom() {
    const socket = socketRef.current;
    if (socket) {
      socket.onclose = null; // we are hanging up on purpose, so it's not a problem
      send('room:leave', {});
      socket.close();
    }
    socketRef.current = null;
    setRoom(null);
    setError('');
    router.dismissTo('/');
  }

  return (
    <GameContext.Provider
      value={{
        room,
        myId,
        deck,
        startAt,
        myYes,
        myNope,
        result,
        error,
        createRoom,
        joinRoom,
        startGame,
        swipe,
        leaveRoom,
      }}>
      {children}
    </GameContext.Provider>
  );
}

// ---------- Little helpers that turn server data into nice words ----------

// The invite link for a room: tap it, and you land on the Join screen with the
// code already typed in for you. "ABC234" -> ".../join?code=ABC234"
//
// The "?code=ABC234" part is like a sticky note on the link. The Join screen
// reads that note to fill in the code boxes.
export function joinLink(code: string) {
  // 1. Our website is online? Then use a normal web link. It opens on ANY
  //    phone or computer, even if your friend doesn't have our app.
  if (WEB_URL) {
    return `${WEB_URL}/join?code=${code}`;
  }
  // 2. Not online yet? Ask Expo to build the right link for wherever we are
  //    running right now:
  //      - in Expo Go:      exp://192.168.1.5:8081/--/join?code=ABC234
  //      - in a browser:    http://localhost:8081/join?code=ABC234
  //      - in the real app: frontend://join?code=ABC234
  //    (Expo Go links only work for friends on the same Wi-Fi who have Expo Go.)
  return Linking.createURL('/join', { queryParams: { code } });
}

// "Maya" -> "MA"
export function initials(name: string) {
  return name.slice(0, 2).toUpperCase();
}

// "ramen_restaurant" -> "Ramen", plus price and distance: "Ramen · $$ · 1.2 km"
export function describe(card: Card) {
  const words = [];
  if (card.primaryType) {
    const kind = card.primaryType.replace('_restaurant', '').replaceAll('_', ' ');
    words.push(kind[0].toUpperCase() + kind.slice(1));
  }
  if (card.priceLevel) {
    words.push('$'.repeat(card.priceLevel));
  }
  words.push((card.distanceM / 1000).toFixed(1) + ' km');
  return words.join(' · ');
}
