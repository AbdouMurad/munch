// Going back, safely.
//
// router.back() does nothing when there's no screen behind this one, for example after
// reloading the page on the web, or when a screen was opened with router.replace().
// Then the back button looked broken. This goes back when it can, and home otherwise.

import { router } from 'expo-router';

export function goBackOrHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/');
  }
}
