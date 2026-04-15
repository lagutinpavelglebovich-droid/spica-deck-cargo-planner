/* ════════════════════════════════════════════════════════════
   FEATURE BADGE REGISTRY — centralized NEW badge declarations

   To badge a new feature in any future release:
   1. Bump app version per project convention
   2. Add one entry below with introducedInVersion = new version
   3. Call shouldShowBadge('yourKey') at the render site
   Badge appears automatically, expires automatically.
════════════════════════════════════════════════════════════ */

export const FEATURE_BADGE_REGISTRY = {
  operatorViewerMode: {
    introducedInVersion: '2.2.1',
    expiresAfterVersions: 3,
  },
  // future entries added here
};
