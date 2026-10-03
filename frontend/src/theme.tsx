import { createContext, ReactNode, useContext, useState } from 'react';

// Our colors, in two boxes: one for light mode, one for dark mode.
// Both boxes have the SAME names, so every screen can use either one.
export const LIGHT = {
  background: '#FFE55C', // sunny yellow
  card: '#FFFFFF',
  soft: '#FFF2AC', // pale yellow, for photo areas and quiet boxes
  text: '#161616', // words and outlines
  shadow: '#161616', // the hard shadow behind chunky boxes
  softText: '#4A4220', // quieter words
  accent: '#D93A21', // the red ring and the stickers
  yes: '#2E9E5B', // green glow when you swipe a card to the right
  nope: '#D93A21', // red glow when you swipe a card to the left
  dot: '#161616', // the dot in the middle of the ring
  onAccent: '#FFFFFF', // words that sit on the accent color
  primary: '#161616', // the big main buttons
  onPrimary: '#FFE55C', // words on those buttons
};

// Dark mode ("chili crisp"): dark brown, cream words, hot orange and gold.
export const DARK = {
  background: '#160F0D',
  card: '#2A1A16',
  soft: '#3B231D',
  text: '#F8EBDB',
  shadow: '#000000',
  softText: '#B9A898',
  accent: '#FF5A3C',
  yes: '#6FCF8E',
  nope: '#FF5A3C',
  dot: '#E8B04B',
  onAccent: '#160F0D',
  primary: '#FF5A3C',
  onPrimary: '#160F0D',
};

// A "context" is like a backpack that every screen can reach into.
// Ours holds: the colors, whether it's dark mode, and a way to flip it.
const ThemeContext = createContext({
  colors: LIGHT,
  isDark: false,
  toggleDark: () => {},
});

// This wraps the whole app (see app/_layout.tsx) and fills the backpack.
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Always start in light mode. The button on the home screen can flip it.
  const [isDark, setIsDark] = useState(false);

  return (
    <ThemeContext.Provider
      value={{
        colors: isDark ? DARK : LIGHT,
        isDark: isDark,
        toggleDark: () => setIsDark(!isDark),
      }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Any screen calls this to reach into the backpack:
//   const { colors } = useAppTheme();
export function useAppTheme() {
  return useContext(ThemeContext);
}
