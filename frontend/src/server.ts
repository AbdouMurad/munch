// Where the server lives. On a real phone "localhost" means the PHONE, so set
// EXPO_PUBLIC_SERVER_URL to your computer's address, like http://192.168.1.5:8000
export const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:8000';

// Sockets use "ws" instead of "http" (and "wss" instead of "https").
export const SOCKET_URL = SERVER_URL.replace('http', 'ws');
