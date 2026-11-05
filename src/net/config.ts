/**
 * Where online games are hosted: the GameHub relay at games.futuremagic.de.
 *
 * The app key comes from VITE_GAMEHUB_KEY at build time (for local work, put it in `.env.local`,
 * which git ignores). Without a key the Online menu explains that online play is not set up.
 */
export const GAMEHUB = {
  url: import.meta.env.VITE_GAMEHUB_URL || "https://games.futuremagic.de",
  app: "conquests",
  appKey: import.meta.env.VITE_GAMEHUB_KEY ?? "",
};

export const onlineAvailable = (): boolean => GAMEHUB.appKey !== "";
