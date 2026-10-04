// WHICH CITY ARE WE IN?
//
// Some cities get their own special logo ("munch Vancouver") and their own
// taxi for the loading animation. This file:
//   1. keeps the list of special cities,
//   2. asks the phone where it is (ONE time, when the app opens),
//   3. gives every screen ready-made pieces: <Logo />, <Taxi /> and <TaxiLoading />.
//
// The location never leaves the phone. We only use it to pick a logo.

import { Image } from 'expo-image';
import * as Location from 'expo-location';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme } from '@/theme';

// ---------- The special cities ----------
// lat / lng = where the middle of the city is on the map.
// logo      = the "munch <City>" picture for the home screen.
// darkLogo  = the same logo in dark-mode colors (cream word, see-through background).
// taxi      = the moving taxi picture (a GIF) for loading screens. Yellow background.
// cardTaxi  = the same taxi on a WHITE background, for the white card on the home screen.
// darkTaxi  = the taxi for loading screens in DARK mode. Its background is the
//             same dark color as the screen, so no box shows around it.
// darkCardTaxi = the taxi for the home-screen card in DARK mode. Its background
//             is the same brown as the card, so no box shows around it there either.
// To add a new city: add its pictures to assets/images/cities/ and
// add one more block here. Nothing else needs to change.
const CITIES = [
  {
    name: 'Vancouver',
    lat: 49.2827,
    lng: -123.1207,
    logo: require('@/assets/images/cities/logo-vancouver.png'),
    darkLogo: require('@/assets/images/cities/logo-dark-vancouver.png'),
    taxi: require('@/assets/images/cities/taxi-vancouver.gif'),
    darkTaxi: require('@/assets/images/cities/taxi-dark-vancouver.gif'),
    darkCardTaxi: require('@/assets/images/cities/taxi-dark-card-vancouver.gif'),
    cardTaxi: require('@/assets/images/cities/taxi-card-vancouver.gif'),
  },
  {
    name: 'Toronto',
    lat: 43.6532,
    lng: -79.3832,
    logo: require('@/assets/images/cities/logo-toronto.png'),
    darkLogo: require('@/assets/images/cities/logo-dark-toronto.png'),
    taxi: require('@/assets/images/cities/taxi-toronto.gif'),
    darkTaxi: require('@/assets/images/cities/taxi-dark-toronto.gif'),
    darkCardTaxi: require('@/assets/images/cities/taxi-dark-card-toronto.gif'),
    cardTaxi: require('@/assets/images/cities/taxi-card-toronto.gif'),
  },
  {
    name: 'Edmonton',
    lat: 53.5461,
    lng: -113.4938,
    logo: require('@/assets/images/cities/logo-edmonton.png'),
    darkLogo: require('@/assets/images/cities/logo-dark-edmonton.png'),
    taxi: require('@/assets/images/cities/taxi-edmonton.gif'),
    darkTaxi: require('@/assets/images/cities/taxi-dark-edmonton.gif'),
    darkCardTaxi: require('@/assets/images/cities/taxi-dark-card-edmonton.gif'),
    cardTaxi: require('@/assets/images/cities/taxi-card-edmonton.gif'),
  },
];

// One city from the list above.
type City = (typeof CITIES)[number];

// How close you must be to a city's middle to count as "in" that city.
// It's measured in map degrees: half a degree is roughly 40 to 55 km,
// which is big enough to include the suburbs.
const CLOSE_ENOUGH = 0.5;

// When we don't know the city, loading screens still need SOME taxi.
// We use the first city's (Vancouver), because that's where our restaurants are.
const DEFAULT_TAXI = CITIES[0].taxi;
const DEFAULT_DARK_TAXI = CITIES[0].darkTaxi;

// The yellow that the logo and taxi pictures are painted on. We paint the box
// behind them the same yellow, so in dark mode they look like tidy yellow stickers.
const PICTURE_YELLOW = '#FFE45C';
// The same idea for the dark-mode loading taxi: it is painted on the SAME dark
// color as the screen in dark mode (colors.background in theme.tsx), so it
// blends in with no visible edge.
const PICTURE_DARK = '#160F0D';

// Given a spot on the map, which special city is it in?
// Gives back null (= "none of them") if it isn't near any.
export function findCity(lat: number, lng: number) {
  for (const city of CITIES) {
    // How far away is this city's middle, up-down and left-right?
    const upDown = Math.abs(lat - city.lat);
    const leftRight = Math.abs(lng - city.lng);
    if (upDown < CLOSE_ENOUGH && leftRight < CLOSE_ENOUGH) {
      return city;
    }
  }
  return null;
}

// ---------- The backpack ----------
// Holds the city we found, so every screen can use it. null = no special city.
const CityContext = createContext<City | null>(null);

// This wraps the whole app (see app/_layout.tsx) and fills the backpack.
export function CityProvider({ children }: { children: ReactNode }) {
  const [city, setCity] = useState<City | null>(null);

  // Runs ONE time, when the app opens.
  useEffect(() => {
    async function whereAmI() {
      try {
        // 1. Ask "may I see where you are?". The phone shows a pop-up.
        const permission = await Location.requestForegroundPermissionsAsync();
        // They said no? That's fine. We keep the normal logo.
        if (!permission.granted) return;

        // 2. Ask the phone where it is. "Lowest" accuracy is plenty:
        //    we only need to know the city, not the street. It's also the fastest.
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Lowest,
        });

        // 3. Is that spot in one of our special cities?
        setCity(findCity(position.coords.latitude, position.coords.longitude));
      } catch {
        // The phone couldn't work out where it is (location switched off,
        // no signal, ...). No problem: we keep the normal logo.
      }
    }
    whereAmI();
  }, []);

  return <CityContext.Provider value={city}>{children}</CityContext.Provider>;
}

// Any screen can ask "which special city are we in?" with:  const city = useCity();
// The answer is null when we aren't in one (or don't know yet).
export function useCity() {
  return useContext(CityContext);
}

// ---------- <Logo /> ----------
// The app's name for the home screen.
//   In a special city: the "munch <City>" picture.
//   Anywhere else:     just the word "munch".
export function Logo() {
  const { colors, isDark } = useAppTheme();
  const city = useCity();

  if (!city) {
    return <Text style={[styles.plainLogo, { color: colors.text }]}>munch</Text>;
  }
  return (
    <Image
      // Dark mode gets the dark logo, light mode gets the yellow one.
      source={isDark ? city.darkLogo : city.logo}
      // The light logo is painted on yellow, so we paint its box yellow too.
      // The dark logo has a see-through background, so it needs no box at all:
      // it sits straight on the screen's own dark background.
      style={[styles.cityLogo, { backgroundColor: isDark ? 'transparent' : PICTURE_YELLOW }]}
      contentFit="contain" // show the whole picture, don't crop it
      accessibilityLabel={`munch ${city.name}`}
    />
  );
}

// ---------- <Taxi /> ----------
// The moving taxi picture for loading screens. Its colors match the city we
// are in, and its background matches the mode: yellow in light mode, dark
// brown in dark mode.
// "width" is how wide to draw it. The height is worked out from that,
// so the taxi always keeps its shape (the GIF is 600 wide and 334 tall).
export function Taxi({ width }: { width: number }) {
  const { isDark } = useAppTheme();
  const city = useCity();

  // Pick the picture: first by mode (dark or light), then by city.
  // No special city? Use the default taxi.
  let picture;
  if (isDark) {
    picture = city ? city.darkTaxi : DEFAULT_DARK_TAXI;
  } else {
    picture = city ? city.taxi : DEFAULT_TAXI;
  }

  return (
    <Image
      source={picture}
      style={[
        styles.taxi,
        {
          width: width,
          height: (width * 334) / 600,
          // Paint the box behind it the same color as the picture's own background.
          backgroundColor: isDark ? PICTURE_DARK : PICTURE_YELLOW,
        },
      ]}
      contentFit="contain"
      accessibilityLabel="A taxi driving along"
    />
  );
}

// ---------- <CardTaxi /> ----------
// The taxi for the card on the home screen. Its background matches the mode:
// white in light mode (the card is white), dark brown in dark mode (the card is dark).
// It only exists for the special cities, so if we aren't in one it draws
// nothing (the home screen shows the bullseye instead).
export function CardTaxi({ width }: { width: number }) {
  const { isDark } = useAppTheme();
  const city = useCity();
  if (!city) return null;
  return (
    <Image
      // Dark mode gets the dark taxi painted on card-brown, light mode gets the white one.
      source={isDark ? city.darkCardTaxi : city.cardTaxi}
      style={[styles.cardTaxi, { width: width, height: (width * 334) / 600 }]}
      contentFit="contain"
      accessibilityLabel="A taxi driving along"
    />
  );
}

// ---------- <TaxiLoading /> ----------
// The taxi with some words underneath, like "Getting the cards ready...".
// Use it anywhere the app is busy waiting.
export function TaxiLoading({ label }: { label: string }) {
  const { colors } = useAppTheme();

  return (
    <View style={styles.loading}>
      <Taxi width={180} />
      <Text style={[styles.loadingLabel, { color: colors.softText }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  plainLogo: {
    fontSize: 22,
    fontWeight: '900',
  },
  cityLogo: {
    width: 124,
    height: 46,
    borderRadius: 10,
  },

  loading: {
    alignItems: 'center',
    gap: 8,
  },
  cardTaxi: {
    borderRadius: 10, // soft corners, so it looks neat on a dark card too
  },
  taxi: {
    borderRadius: 14,
  },
  loadingLabel: {
    fontSize: 16,
    textAlign: 'center',
  },
});
