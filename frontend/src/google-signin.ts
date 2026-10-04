// "Continue with Google", shared by the sign-in pop-up and the sign-in screen.
//
// We ask Google for an "ID token": a signed note from Google saying who you are.
// The server checks Google's signature, so nobody can fake it.
// Google sign-in in a phone app needs a development build (see frontend/README.md),
// so for now it's only offered on the web.

import * as AuthSession from 'expo-auth-session';
import * as Crypto from 'expo-crypto';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

import { SignedIn, useAccount } from '@/account';

// On the web, Google opens a popup. This closes it once Google sends us back.
WebBrowser.maybeCompleteAuthSession();

// The "Web application" OAuth client id from Google Cloud Console.
const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
const GOOGLE = { authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth' };

export function useGoogleSignIn({ onSignedIn, onError }: {
  onSignedIn: (result: SignedIn) => void;
  onError: (message: string) => void;
}) {
  const account = useAccount();
  const [nonce] = useState(() => Crypto.randomUUID()); // one per screen, not per redraw

  const [, response, prompt] = AuthSession.useAuthRequest(
    {
      clientId: GOOGLE_WEB_CLIENT_ID ?? 'not-set',
      redirectUri: AuthSession.makeRedirectUri(),
      responseType: AuthSession.ResponseType.IdToken,
      scopes: ['openid', 'email', 'profile'],
      usePKCE: false,
      extraParams: { nonce },
    },
    GOOGLE,
  );

  // Google answered: hand its note to our server, which signs us in.
  useEffect(() => {
    if (response?.type !== 'success') return;
    account
      .googleSignIn(response.params.id_token)
      .then(onSignedIn)
      .catch((e: Error) => onError(e.message));
  }, [response]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    available: Platform.OS === 'web' && Boolean(GOOGLE_WEB_CLIENT_ID),
    start: () => prompt(), // must run straight from a tap, or browsers block the popup
  };
}

// New accounts (and any account without a handle yet) still need a name and handle.
export function needsRegistering(result: SignedIn) {
  return result.isNew || !result.user.handle;
}
