package cn.shrcs.wordmaster;

/** Run with plain javac/java; tests the same tracker packaged into the APK. */
public final class SpeechTrackerTest {
    private static int checks;
    private static void eq(String expected, String actual) {
        checks++;
        if (!expected.equals(actual)) throw new AssertionError(expected + " != " + actual);
    }
    public static void main(String[] args) {
        SpeechTracker t = new SpeechTracker();
        t.begin("a", 0);
        eq("queued", t.poll("a", false, 160));
        t.started("a");
        eq("speaking", t.poll("a", false, 320));
        eq("speaking", t.poll("a", true, 480));
        // No onDone: playback must remain idle for 320 ms before completing.
        eq("speaking", t.poll("a", false, 640));
        eq("speaking", t.poll("a", false, 800));
        eq("done", t.poll("a", false, 960));
        t.complete("a", "error");
        eq("done", t.poll("a", false, 1120));
        t.begin("b", 1200);
        t.complete("a", "done");
        eq("unknown", t.poll("a", false, 1360));
        eq("queued", t.poll("b", false, 1360));
        t.complete("b", "done");
        eq("done", t.poll("b", false, 1360)); // JS event lost, retained terminal state.
        t.begin("c", 1400);t.cancel();t.started("c");t.complete("c", "done");
        eq("canceled", t.poll("c", false, 2000));
        t.begin("d", 2000);
        eq("queued", t.poll("d", false, 3600));
        eq("unavailable", t.poll("d", false, 3800));
        t.begin("e", 4000);t.started("e");
        eq("done", t.poll("e", false, 5800)); // A short word between polls.
        t.begin("f", 6000);
        eq("speaking", t.poll("f", true, 6100));
        eq("speaking", t.poll("f", false, 6200));
        eq("speaking", t.poll("f", true, 6300)); // A brief idle gap is not completion.
        eq("speaking", t.poll("f", false, 6400));
        eq("speaking", t.poll("f", false, 6600));
        eq("done", t.poll("f", false, 6720));
        System.out.println("SpeechTracker: " + checks + " assertions passed");
    }
}
