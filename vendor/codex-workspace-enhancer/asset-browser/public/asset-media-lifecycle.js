export function releaseMediaElement(media) {
  if (!media) return;
  media.pause();
  if (media.hasAttribute("src")) {
    media.removeAttribute("src");
    media.load();
  }
  media.preload = "none";
}

// A library can contain thousands of clips; only the media the user is
// interacting with owns a decoder/network source. Stale play promises cannot
// restart media after pointer leave, project switching or dialog closure.
export function createMediaPlaybackManager() {
  let active = null;
  function stop(media = null) {
    if (active && (!media || active.media === media)) {
      const previous = active;
      active = null;
      releaseMediaElement(previous.media);
      previous.onStop?.();
    } else if (media) releaseMediaElement(media);
  }
  return {
    async start(media, source, { onStart, onStop, onError } = {}) {
      if (!media || !source) return false;
      if (active?.media === media && !media.paused) return true;
      stop();
      const ticket = { media, onStop };
      active = ticket;
      media.preload = "none";
      media.setAttribute("src", source);
      try {
        await media.play();
        if (active !== ticket) {
          if (active?.media !== media) releaseMediaElement(media);
          return false;
        }
        onStart?.();
        return true;
      } catch (error) {
        if (active === ticket) { stop(media); onError?.(error); }
        return false;
      }
    },
    stop,
    isActive: (media) => active?.media === media,
  };
}
