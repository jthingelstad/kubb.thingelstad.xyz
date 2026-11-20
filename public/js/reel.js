// The /playdate/ page's reel: plays muted on a loop while it is in view, but
// only for people whose device has not asked for less motion. Without this
// script (or with reduced motion) the video waits for its play button. A
// pause the viewer chose stays a pause.
const motionOk = matchMedia("(prefers-reduced-motion: no-preference)");
for (const video of document.querySelectorAll("video[data-reel]")) {
  let ours = false; // the next pause is this script's, not the viewer's
  let held = false; // the viewer paused it
  video.addEventListener("pause", () => {
    if (!ours) held = true;
    ours = false;
  });
  video.addEventListener("play", () => {
    held = false;
  });
  const stop = () => {
    if (video.paused) return;
    ours = true;
    video.pause();
  };
  new IntersectionObserver(
    ([entry]) => {
      if (!entry.isIntersecting) stop();
      else if (motionOk.matches && !held) {
        video.muted = true;
        video.loop = true;
        video.play().catch(() => {});
      }
    },
    { threshold: 0.5 },
  ).observe(video);
  motionOk.addEventListener("change", () => {
    if (!motionOk.matches) stop();
  });
}
