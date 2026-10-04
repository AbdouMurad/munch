# Munch app

The Expo / React Native app. Screens are in `src/app/` (Expo Router: each file is a screen), and
`src/game.tsx` talks to the server over REST and a WebSocket.

## Setup

1. Install dependencies: `npm install`
2. Create `frontend/.env` (Expo only reads this folder's `.env`; never commit it):
   ```
   EXPO_PUBLIC_SERVER_URL=http://localhost:8000
   ```
   Optional, for "Continue with Google" on the web:
   ```
   EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=<web client id>.apps.googleusercontent.com
   ```
3. Start the server (see [`server/README.md`](../server/README.md)).

## Run

```bash
npx expo start          # then press w (web), i (iOS simulator) or a (Android)
```

### On a real phone

`localhost` on a phone means the phone itself, so:

1. Start the server listening on your network:
   `uv run uvicorn munch.main:app --reload --port 8000 --host 0.0.0.0` (from `server/`)
2. Find your computer's LAN address (macOS: `ipconfig getifaddr en0`).
3. Set `EXPO_PUBLIC_SERVER_URL=http://<that address>:8000` in `frontend/.env`.
4. Restart `npx expo start` (env changes need a restart) and scan the QR code with Expo Go.

Phone and computer must be on the same Wi-Fi.

### Expo web

The server only accepts browser requests from `WEB_ORIGIN` in the repo-root `.env`. For
`npx expo start --web` that's `http://localhost:8081`. Native apps aren't affected.

## Accounts, friends and invites

Signing in is optional; guests can still create and join games.

- **Email + password** works everywhere. "Create account" asks for name, handle, email and
  password (8+ characters) on one page; "Sign in" asks for email and password.
- **Google sign-in** only shows on the web for now. In Google Cloud Console create an OAuth
  client of type *Web application*, add your web address (e.g. `http://localhost:8081`) as an
  authorised JavaScript origin and redirect URI, put its id in `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`
  here and in `GOOGLE_CLIENT_IDS` in the repo-root `.env`. On phones Google sign-in needs a
  [development build](https://docs.expo.dev/guides/google-authentication/) and
  `@react-native-google-signin/google-signin`; Expo Go can't do it.
- **Invites** arrive instantly while the app is open, and wait on the home screen otherwise.
  There are no phone notifications.

Code: `src/account.tsx` (session, API calls, live invites), screens `signin`, `profile`,
`friends`, and `src/components/account-ui.tsx` (invites inbox, lobby friend buttons).

## Before you push

```bash
npx expo lint
npx tsc --noEmit
```

## Notes

- Add packages with `npx expo install <package>`, not `npm install`, so versions match the SDK.
- The server's message shapes are defined in `server/munch/models.py`. The types in
  `src/game.tsx` copy them by hand, so update both when that file changes.
- Agent-specific guidance: [`AGENTS.md`](AGENTS.md).
