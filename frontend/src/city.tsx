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
// taxi      = the moving taxi picture (a GIF) for loading screens.
// To add a new city: add its two pictures to assets/images/cities/ and
// add one more block here. Nothing else needs to change.
const CITIES = [
  {
    name: 'Vancouver',
    lat: 49.2827,
    lng: -123.1207,
    logo: require('@/assets/images/cities/logo-vancouver.png'),
    taxi: require('@/assets/images/cities/taxi-vancouver.gif'),
  },
  {
    name: 'Toronto',
    lat: 43.6532,
    lng: -79.3832,
    logo: require('@/assets/images/cities/logo-toronto.png'),
    taxi: require('@/assets/images/cities/taxi-toronto.gif'),
  },
  {
    name: 'Edmonton',
    lat: 53.5461,
    lng: -113.4938,
    logo: require('@/assets/images/cities/logo-edmonton.png'),
    taxi: require('@/assets/images/cities/taxi-edmonton.gif'),
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

// The yellow that the logo and taxi pictures are painted on. We paint the box
// behind them the same yellow, so in dark mode they look like tidy yellow stickers.
const PICTURE_YELLOW = '#FFE45C';

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
  const { colors } = useAppTheme();
  const city = useCity();

  if (!city) {
    return <Text style={[styles.plainLogo, { color: colors.text }]}>munch</Text>;
  }
  return (
    <Image
      source={city.logo}
      style={styles.cityLogo}
      contentFit="contain" // show the whole picture, don't crop it
      accessibilityLabel={`munch ${city.name}`}
    />
  );
}

// ---------- <Taxi /> ----------
// The moving taxi picture. Its colors match the city we are in.
// "width" is how wide to draw it. The height is worked out from that,
// so the taxi always keeps its shape (the GIF is 600 wide and 334 tall).
export function Taxi({ width }: { width: number }) {
  const city = useCity();
  return (
    <Image
      source={city ? city.taxi : DEFAULT_TAXI}
      style={[styles.taxi, { width: width, height: (width * 334) / 600 }]}
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
    backgroundColor: PICTURE_YELLOW,
  },

  loading: {
    alignItems: 'center',
    gap: 8,
  },
  taxi: {
    borderRadius: 14,
    backgroundColor: PICTURE_YELLOW,
  },
  loadingLabel: {
    fontSize: 16,
    textAlign: 'center',
  },
});
