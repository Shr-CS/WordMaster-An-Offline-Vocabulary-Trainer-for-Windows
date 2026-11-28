# Answer flow regression checks

2.0.2 fixes two reproduced cases: a completed utterance with a dropped completion event, and an incidental touch on the answered card canceling progression without feedback. The previous smoke test always emitted the expected event and missed both cases.

Correct answers now show compact, stable feedback. Completion is scoped to the session, question and utterance. The primary signal is the completion event. A separate 160 ms poll reads the native retained state; `SpeechTracker` also observes playback and waits for 320 ms of idle time if an engine omits its completion callback. Web Speech has an equivalent playback-state check. Native speech uses [TextToSpeech.isSpeaking](https://developer.android.com/reference/android/speech/tts/TextToSpeech#isSpeaking()) and [UtteranceProgressListener](https://developer.android.com/reference/android/speech/tts/UtteranceProgressListener).

A queued utterance gets a 1.8 second startup grace period. A final text-length-based deadline of 5–20 seconds bounds engines that report no useful state. Normal completion advances after 180 ms; failures show a short explanation before advancing. The app distinguishes its own cancellation from engine interruption. Explicit pause, detail inspection, navigation and backgrounding stop automatic progression; incidental touches and scrolling do not. Replaying from the question restarts the current pronunciation without dropping automatic progression.

## Automated checks

```sh
npm test

# Playwright must be resolvable by Node, and Chrome installed.
node tools/test-answer-flow.cjs

# Test the same native state tracker that is compiled into the APK, with JDK 17.
javac -d /tmp/wordmaster-speech-tests \
  android/app/src/main/java/cn/shrcs/wordmaster/SpeechTracker.java \
  tools/SpeechTrackerTest.java
java -cp /tmp/wordmaster-speech-tests cn.shrcs.wordmaster.SpeechTrackerTest

cd android
./gradlew assembleRelease lintRelease
```

The browser suite exercises touch input and desktop input; English/Chinese choices and spelling; actual completion and missing completion events; duplicate taps and late callbacks; pause/resume, details and bookmarks; replay; navigation and backgrounding; missing voices and interrupted speech; prompt pronunciation; IME composition; and an entire group with a wrong-answer retry. Native tracker tests cover missing callbacks, delayed starts, cancellation, stale IDs, terminal-state retention and transient idle gaps.

Browser audio and bridge behavior are controlled in these tests. They do not claim physical Android TTS or keyboard verification. Before a device release, install over the existing app, confirm retained progress, answer a five-word group using the installed English TTS engine, test replay/pause, and leave/return to the app during pronunciation.
