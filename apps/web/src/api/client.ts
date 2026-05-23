import axios from "axios";
import { apiUrl } from "./../env";

const STORAGE_KEY = "session_token";

// In Next.js dev, proxy isn't configured, so always use the full apiUrl
const baseURL = apiUrl;

export const client = axios.create({
  baseURL,
  headers: { "Content-Type": "application/json" },
});

client.interceptors.request.use((config) => {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
      const session = JSON.parse(atob(token));
      config.headers["x-user-id"] = session.userId;
      config.headers["x-event-id"] = session.eventId;
      config.headers["x-role"] = session.role;
    }
  } catch (e) {
    // ignore
  }
  return config;
});

export function setSessionToken(token: string | null) {
  if (token) {
    localStorage.setItem(STORAGE_KEY, token);
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export default client;
