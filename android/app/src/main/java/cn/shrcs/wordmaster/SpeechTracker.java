package cn.shrcs.wordmaster;

/** Retains each utterance's state across lost JS callbacks and engine callbacks.
 * All access is synchronized: Android TTS and WebView use different threads. */
final class SpeechTracker {
    private String id = "";
    private String state = "unknown";
    private long queuedAt;
    private long idleSince = -1;
    private boolean observedPlayback;

    synchronized void begin(String utteranceId, long now) {
        id = utteranceId;
        state = "queued";
        queuedAt = now;
        idleSince = -1;
        observedPlayback = false;
    }

    private boolean active() { return "queued".equals(state) || "speaking".equals(state); }

    synchronized void started(String utteranceId) {
        if (!id.equals(utteranceId) || !active()) return;
        state = "speaking";
        // onStart can precede audible playback; isSpeaking confirms it independently.
    }

    synchronized boolean complete(String utteranceId, String result) {
        if (!id.equals(utteranceId) || !active()) return false;
        state = result;
        return true;
    }

    synchronized void cancel() { if (active()) state = "canceled"; }

    synchronized String poll(String utteranceId, boolean speaking, long now) {
        if (!id.equals(utteranceId)) return "unknown";
        if (!active()) return state;
        if (speaking) {
            observedPlayback = true;
            idleSince = -1;
            state = "speaking";
        } else {
            if (idleSince < 0) idleSince = now;
            if (observedPlayback && now - idleSince >= 320) state = "done";
            else if (!observedPlayback && now - queuedAt >= 1800) {
                // A very short utterance may fall between polls; onStart proves it ran.
                state = "speaking".equals(state) ? "done" : "unavailable";
            }
        }
        return state;
    }
}
