// THE BRIDGE between our app and the server.
//
// The server is a separate program (see /server). We talk to it in two ways:
//   1. A normal web request, ONE time, to make a room or join a room.
//   2. A "socket": a phone call that stays open, so the server can tell us
//      things the moment they happen ("Leo joined!", "The game started!").
//
// Every screen can reach into this file with:  const game = useGame();

import { Image } from 'expo-image';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { createContext, ReactNode, useContext, useRef, useState } from 'react';

import { useAccount } from '@/account';
import { MyLocation, useMyLocation } from '@/city';
import { SERVER_URL, SOCKET_URL } from '@/server';

// Where the WEBSITE version of our app lives on the internet, like
// https://munch.vercel.app (no "/" on the end). Set EXPO_PUBLIC_WEB_URL once we
// put the website online. Until then this is empty and joinLink() makes a
// link that only works while you are testing (see joinLink below).
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL ?? '';

// Where a new game searches for restaurants: around the host (see searchSpot below).
// We only have restaurants where the crawl has been (the boxes in
// server/munch/ingest/grid.py), so outside them, or if we don't know where the host is,
// the game searches downtown Vancouver instead of finding nothing.
// Crawled a new area? Add its box here too.
const DOWNTOWN_VANCOUVER = { lat: 49.2827, lng: -123.1207 };
const AREAS_WITH_RESTAURANTS = [
  { minLat: 49.18, maxLat: 49.317, minLng: -123.225, maxLng: -122.89 }, // Vancouver + Burnaby
  { minLat: 53.395, maxLat: 53.716, minLng: -113.714, maxLng: -113.271 }, // Edmonton
];

// The spot a new game searches around: the host's location, rounded to 3 decimal places
// (about 100 m, so friends in the room don't see your exact spot), or downtown Vancouver.
function searchSpot(here: MyLocation | null) {
  const inArea =
    here !== null &&
    AREAS_WITH_RESTAURANTS.some(
      (area) =>
        here.lat >= area.minLat &&
        here.lat <= area.maxLat &&
        here.lng >= area.minLng &&
        here.lng <= area.maxLng,
    );
  if (!here || !inArea) return DOWNTOWN_VANCOUVER;
  return { lat: Math.round(here.lat * 1000) / 1000, lng: Math.round(here.lng * 1000) / 1000 };
}

// ---------- The shapes of the things the server sends us ----------
// These copy server/munch/models.py. If that file changes, change these too.

// One friend in the room.
export type Member = {
  id: string;
  displayName: string;
  isHost: boolean;
  progress: number; // how many cards they have swiped
  userId: string | null; // their account, if they signed in (null = guest)
  avatarUrl: string | null; // their profile picture, if they have one
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
  photoUrl: string | null; // like "/api/photos/abc" on OUR server, or null if no photo
  mapsUri: string | null; // a link that opens the maps app
};

// The full web address of a card's photo, or null if it has none.
// It points at our server, which sends the phone on to the real picture on Google
// (so the Google key never has to be inside the app).
export function photoAddress(card: Card) {
  return card.photoUrl ? SERVER_URL + card.photoUrl : null;
}

// How many cards ahead we download photos for, so a photo is already there
// when its card shows up. 10 = one whole pile on the swipe screen.
export const PRELOAD_AHEAD = 10;

// Before the swipe screen opens, we wait for the first pile's photos to finish
// downloading. But never longer than this (in milliseconds), so slow internet
// (or a broken photo) can't keep everyone stuck in the lobby.
const LONGEST_PHOTO_WAIT = 3000; // 3 seconds

// Start downloading these cards' photos and keep them in the phone's memory.
// When the card shows up later, its photo is already there: no loading.
// It hands back a "promise": a note that says "I'll tell you when I'm done".
// You can wait for it (await) or just ignore it and carry on.
export function preloadPhotos(cards: Card[]) {
  const addresses = cards.map(photoAddress).filter((address) => address !== null);
  if (addresses.length === 0) return Promise.resolve(true); // nothing to download
  return Image.prefetch(addresses);
}

// A promise that finishes after this many milliseconds. A little alarm clock.
function wait(milliseconds: number) {
  return new Promise((done) => setTimeout(done, milliseconds));
}

// Everything about the room.
export type Room = {
  code: string;
  status: string; // "lobby", "swiping", "matched", "exhausted", or "closed"
  members: Member[];
  radiusM: number; // how far we search, in meters (the host can make it bigger)
  deckSize: number; // how many cards are in the game (0 until it starts)
  matchThreshold: number; // how many likes a restaurant needs to win (2/3 of us)
};

// Our ticket into the room. The server gives us this when we create or join.
export type Session = {
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
//   matched = true  -> enough of us liked the same restaurant: picks[0] is the winner.
//   matched = false -> everyone ran out of cards, so picks are the most-liked spots.
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
  searchFarther: () => void; // host only: add restaurants from farther away
  resumeSwiping: (atCard: number) => void; // back to swiping after new cards arrived
  playAgain: () => void; // game over: back to this room's lobby for another round
  loadingCards: boolean; // true while we download the first photos, right after Start
  connecting: boolean; // true from pressing Create/Join until the lobby opens
  createRoom: (name: string, radiusM: number, filters: Filters) => void;
  joinRoom: (code: string, name: string) => void;
  enterWithSession: (session: Session) => void; // e.g. after accepting a friend's invite
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
  const [loadingCards, setLoadingCards] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // True once the server has told us how the game ended.
  // (A "ref" is a box that remembers one thing without redrawing the screen.)
  const gameOver = useRef(false);

  // If we're signed in, rooms we make or join are linked to our account.
  const account = useAccount();
  // Where the phone is (null = unknown), so a new game searches around the host.
  const myLocation = useMyLocation();

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
    // We're on our way! Screens show the loading taxi while this is true.
    // (This can take a while if the server was asleep and has to wake up.)
    setConnecting(true);
    try {
      const response = await fetch(SERVER_URL + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(account.token ? { Authorization: `Bearer ${account.token}` } : {}),
        },
        body: JSON.stringify({ displayName: name, ...extras }),
      });
      const data = await response.json();

      // The server said no (wrong code, game already started, ...).
      if (!response.ok) {
        setError(data.error.message);
        setConnecting(false);
        return;
      }

      const session: Session = data;
      setMyId(session.memberId);
      openSocket(session);
    } catch {
      // We couldn't even reach the server.
      setError('Could not reach the server. Is it running?');
      setConnecting(false);
    }
  }

  function createRoom(name: string, radiusM: number, filters: Filters) {
    enterRoom('/api/rooms', name, {
      center: searchSpot(myLocation),
      radiusM: radiusM,
      filters: filters,
    });
  }

  function joinRoom(code: string, name: string) {
    enterRoom(`/api/rooms/${code}/join`, name, {});
  }

  function enterWithSession(session: Session) {
    setError('');
    setMyId(session.memberId);
    openSocket(session);
  }

  // ---------- Talking to the server: the SOCKET ----------

  function openSocket(session: Session) {
    // Start fresh: forget anything left over from an older game.
    setRoom(null);
    setDeck([]);
    setResult(null);
    setLoadingCards(false);
    gameOver.current = false;

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
          setConnecting(false); // we made it: stop the loading taxi
          router.push('/lobby');
        }
      }

      // The host searched farther. New restaurants go on the END of everyone's deck
      // (the server makes sure none of them were in the game already).
      if (message.type === 'room:deck_extended') {
        preloadPhotos(payload.cards.slice(0, PRELOAD_AHEAD));
        setDeck((oldDeck) => [...oldDeck, ...payload.cards]);
      }

      // The host pressed Start. Here are the cards! Everyone goes to the swipe screen.
      if (message.type === 'room:started') {
        setDeck(payload.deck);
        setStartAt(payload.resumeAt);
        setMyYes(0);
        setMyNope(0);
        // Download the first pile's photos, THEN open the swipe screen.
        getCardsReady(payload.deck.slice(payload.resumeAt, payload.resumeAt + PRELOAD_AHEAD));
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

      // Enough of us liked the same restaurant. We have a winner!
      if (message.type === 'room:matched') {
        setResult({
          matched: true,
          picks: [{ card: payload.card, likes: payload.likedBy.length }],
        });
        gameOver.current = true;
        router.replace('/winner');
      }

      // Everyone finished and nobody agreed. Show the most-liked spots instead.
      if (message.type === 'room:exhausted') {
        setResult({ matched: false, picks: payload.topPicks });
        gameOver.current = true;
        router.replace('/winner');
      }

      // The server didn't like something we sent.
      if (message.type === 'error') {
        setError(payload.message);
      }
    };

    // This runs if the phone call drops.
    // TODO: try to call back automatically instead of just showing a message
    socket.onclose = () => {
      setError('Lost the connection to the server.');
      setConnecting(false);
    };
  }

  // The game just started and we have the cards. Before showing the swipe
  // screen, download the photos for the first pile, so the cards don't show up
  // with empty pictures that pop in one by one.
  async function getCardsReady(firstCards: Card[]) {
    setLoadingCards(true); // the lobby shows "Getting the cards ready..."

    // A race between two things. We carry on as soon as EITHER one finishes:
    //   1. all the photos are downloaded, or
    //   2. the alarm clock rings (so we never wait too long).
    await Promise.race([preloadPhotos(firstCards), wait(LONGEST_PHOTO_WAIT)]);

    setLoadingCards(false);

    // While we were waiting, did the game end or did we leave the room?
    // Then we must NOT jump to the swipe screen.
    if (gameOver.current || !socketRef.current) return;
    router.replace('/swipe');
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

  // Host only: search 2 km farther. The server sends everyone the new cards
  // (room:deck_extended), or an error if there's nothing new out there.
  function searchFarther() {
    setError('');
    send('room:expand', {});
  }

  // We finished our cards, then new ones arrived: go back and swipe from card "atCard".
  function resumeSwiping(atCard: number) {
    setStartAt(atCard);
    router.replace('/swipe');
  }

  // Game over: put this room back in the lobby (the server does it for everyone, and
  // it's fine if a friend already did) and go there. Same code, same friends.
  function playAgain() {
    setError('');
    setResult(null);
    send('room:replay', {});
    router.replace('/lobby');
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
        searchFarther,
        resumeSwiping,
        playAgain,
        loadingCards,
        connecting,
        createRoom,
        joinRoom,
        enterWithSession,
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
