import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { BackButton, ChunkyBox, ChunkyButton, ErrorLine, Screen } from '@/components/ui';
import { TaxiLoading } from '@/city';
import { useAccount } from '@/account';
import { PlayingAs } from '@/components/account-ui';
import { useGame } from '@/game';
import { goBackOrHome } from '@/navigation';
import { useAppTheme } from '@/theme';

// The choices the host can pick from.
// "label" is what we show. "value" is what the server wants.
const DISTANCES = [
  { label: '1 km', value: 1000 }, // the server counts in meters
  { label: '3 km', value: 3000 },
  { label: '5 km', value: 5000 },
];
const PRICES = [
  { label: '$', value: 1 },
  { label: '$$', value: 2 },
  { label: '$$$', value: 3 },
];
const RATINGS = [
  { label: 'Any', value: null }, // null means "I don't mind"
  { label: '4+', value: 4 },
  { label: '4.5+', value: 4.5 },
];

// A "chip" is a small round button you can turn on or off (like "3 km").
// It's only used on this screen, so it lives here.
function Chip({ label, selected, onPress }: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[
        styles.chip,
        // Turned on = filled in. Turned off = just an outline.
        { backgroundColor: selected ? colors.primary : colors.card, borderColor: colors.text },
      ]}>
      <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// CREATE SCREEN: the host types a name (unless signed in), picks the settings,
// and makes a room.
// The settings are picked HERE (not in the lobby) because the server
// needs them at the moment the room is created.
export default function CreateScreen() {
  const { colors } = useAppTheme();
  const game = useGame();
  const account = useAccount();

  const [name, setName] = useState('');
  const [distance, setDistance] = useState(3000);
  const [prices, setPrices] = useState([1, 2]); // you can pick MORE than one price
  const [minRating, setMinRating] = useState<number | null>(null);
  const [openNow, setOpenNow] = useState(false);

  // Tapping a price adds it if it's missing, or removes it if it's already there.
  function togglePrice(price: number) {
    if (prices.includes(price)) {
      setPrices(prices.filter((p) => p !== price));
    } else {
      setPrices([...prices, price]);
    }
  }

  return (
    <Screen>
      {/* ---------- TOP: back button and screen name ---------- */}
      <View style={styles.topBar}>
        <BackButton onPress={goBackOrHome} />
        <Text style={[styles.topTitle, { color: colors.text }]}>Start a game</Text>
      </View>

      <View>
        <Text style={[styles.title, { color: colors.text }]}>You&apos;re the host!</Text>
        <Text style={[styles.subtitle, { color: colors.softText }]}>
          Pick the rules, then invite your friends.
        </Text>
      </View>

      {/* ---------- Your name (signed in? we already know it) ---------- */}
      {account.me ? (
        <PlayingAs />
      ) : (
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.text }]}>Your name</Text>
          <TextInput
            style={[
              styles.nameInput,
              { backgroundColor: colors.card, borderColor: colors.text, color: colors.text },
            ]}
            value={name}
            onChangeText={setName}
            placeholder="James"
            placeholderTextColor={colors.softText}
            maxLength={24} // the server's limit for names
          />
        </View>
      )}

      {/* ---------- Game settings ---------- */}
      <ChunkyBox background={colors.card} style={styles.settings}>
        <Text style={[styles.settingsTitle, { color: colors.text }]}>Game settings</Text>

        <View style={styles.row}>
          <Text style={[styles.settingName, { color: colors.text }]}>Distance</Text>
          <View style={styles.chips}>
            {DISTANCES.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                selected={distance === option.value}
                onPress={() => setDistance(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={[styles.settingName, { color: colors.text }]}>Price</Text>
          <View style={styles.chips}>
            {PRICES.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                selected={prices.includes(option.value)}
                onPress={() => togglePrice(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={[styles.settingName, { color: colors.text }]}>Stars</Text>
          <View style={styles.chips}>
            {RATINGS.map((option) => (
              <Chip
                key={option.label}
                label={option.label}
                selected={minRating === option.value}
                onPress={() => setMinRating(option.value)}
              />
            ))}
          </View>
        </View>

        <View style={styles.row}>
          <Text style={[styles.settingName, { color: colors.text }]}>Only open now</Text>
          {/* One chip that flips between on and off each time you tap it. */}
          <Chip
            label={openNow ? 'Yes' : 'No'}
            selected={openNow}
            onPress={() => setOpenNow(!openNow)}
          />
        </View>
      </ChunkyBox>

      {/* This empty box grows to push the button to the bottom of the screen. */}
      <View style={styles.spacer} />

      <ErrorLine />

      {/* Ask the server to make the room. If it works, we land in the lobby.
          The server remembers these rules and uses them to build the deck
          of restaurants when the game starts. */}
      {game.connecting ? (
        // We asked the server and are waiting for it to answer.
        // Show the taxi so people know something is happening.
        <TaxiLoading label="Opening your lobby..." />
      ) : (
        <ChunkyButton
          label="Create lobby"
          primary
          onPress={() =>
            // Signed in? Play under your account name. Otherwise, the name typed above.
            game.createRoom(account.me?.displayName ?? name, distance, {
              priceLevels: prices,
              minRating: minRating,
              openNow: openNow,
            })
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  topTitle: {
    fontSize: 17,
    fontWeight: '800',
  },
  title: {
    fontSize: 34,
    fontWeight: '900',
  },
  subtitle: {
    fontSize: 16,
    marginTop: 4,
  },

  field: {
    gap: 8,
  },
  label: {
    fontSize: 14,
    fontWeight: '800',
  },
  nameInput: {
    height: 56,
    borderWidth: 2,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontSize: 18,
    fontWeight: '700',
  },

  settings: {
    padding: 16,
    gap: 12,
  },
  settingsTitle: {
    fontSize: 17,
    fontWeight: '900',
  },
  // A row with one thing on the left and one thing on the right.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8, // so a label never touches its chips on a narrow phone
  },
  settingName: {
    fontSize: 15,
  },
  chips: {
    flexDirection: 'row',
    gap: 6,
  },
  chip: {
    borderWidth: 2,
    borderRadius: 999, // a huge number = fully round ends
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '800',
  },
  spacer: {
    flex: 1,
  },
});
