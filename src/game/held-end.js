// Reduced motion holds the end camera (engine 1.4.1, its docs/CLIENTS.md "1.4.1 on top").
// When the other side throws, the player watches from their own end (engine 1.4's view
// from one side, the camera kind "end"); from 1.4.1 that camera is a person's eyes on the
// player's baseline that turn part of the way toward the projectile as it flies
// (`camera.endFollow`). With prefers-reduced-motion the playback holds the camera of the
// recording's first frame for the whole of it instead: `showAt { t = 0 }`'s, which the
// engine fits to the whole throw (where it was thrown from, its flight, where it landed
// and came to rest), so the calm view still shows all of it. The iPhone app does the same
// (`Playback.heldEnd`). Drawing only: the recording, the knocks and the match are the same.
// Any other camera (the player's own throw, the wide view, a watcher's) is drawn as given.

// shown: a showAt result. held: the camera held so far for this playback (or null).
// first: () => the recording's first frame's camera (showAt t = 0), asked once.
// Returns { shown, held }: the result to draw (its camera the held one when it is held)
// and the camera to keep for the next frame.
export function holdEnd(shown, held, { reduced, first }) {
  const cam = shown?.camera;
  if (!reduced || cam?.kind !== "end") return { shown, held: null };
  if (!held) {
    let f = null;
    try {
      f = first?.() ?? null;
    } catch {
      f = null;
    }
    held = f?.kind === "end" ? f : cam;
  }
  return { shown: held === cam ? shown : { ...shown, camera: held }, held };
}
