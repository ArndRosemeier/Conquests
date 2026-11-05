/**
 * Where online games are hosted: the GameHub relay at games.futuremagic.de.
 *
 * The app key is not a secret: the hub stores no data and limits traffic, and the key only says
 * "this is Conquests". It ships in every bundle, as with the other GameHub games. A build can
 * override it with VITE_GAMEHUB_KEY (and the server with VITE_GAMEHUB_URL).
 */
const COMMITTED_KEY = "ghk_conquests_U6Bk83uZ0uoLxCndCq7KbLExbOSRb25C";

export const GAMEHUB = {
  url: import.meta.env.VITE_GAMEHUB_URL || "https://games.futuremagic.de",
  app: "conquests",
  appKey: import.meta.env.VITE_GAMEHUB_KEY || COMMITTED_KEY,
};

export const onlineAvailable = (): boolean => GAMEHUB.appKey !== "";
