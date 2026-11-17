// The experiment belongs to this tab, including navigation from the home page.
function readSwipeMode() {
  const requested =
    new URLSearchParams(location.search).get("throw") === "swipe";
  try {
    if (requested) sessionStorage.setItem("kubb.throw", "swipe");
    return requested || sessionStorage.getItem("kubb.throw") === "swipe";
  } catch {
    return requested;
  }
}
export const swipeEnabled = readSwipeMode();
