package cn.shrcs.wordmaster;

import android.app.Activity;
import android.annotation.SuppressLint;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final int IMPORT = 1;
    private static final int EXPORT = 2;
    private static final int MAX_BACKUP_BYTES = 16 * 1024 * 1024;
    private WebView web;
    private FrameLayout root;
    private TextToSpeech speech;
    private volatile boolean speechReady;
    private final SpeechTracker speechTracker = new SpeechTracker();
    private boolean voiceWarningShown;
    private final ExecutorService files = Executors.newSingleThreadExecutor();
    private int pendingRequest;
    private String pendingBackup;

    // JavaScript powers the bundled offline UI. All other requests and navigations are blocked.
    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(18, 29, 26));
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);
        web.setBackgroundColor(Color.rgb(18, 29, 26));
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.getSettings().setMixedContentMode(android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        web.setWebChromeClient(new WebChromeClient());
        web.addJavascriptInterface(new Bridge(), "WordMasterAndroid");
        WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        web.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse local = loader.shouldInterceptRequest(request.getUrl());
                if (local != null) return local;
                return new WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", null,
                    new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return true;
            }
        });
        speech = new TextToSpeech(this, status -> {
            if (status != TextToSpeech.SUCCESS) return;
            int language = speech.setLanguage(Locale.US);
            speechReady = language != TextToSpeech.LANG_MISSING_DATA && language != TextToSpeech.LANG_NOT_SUPPORTED;
        });
        speech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override public void onStart(String id) { speechTracker.started(id); }
            @Override public void onDone(String id) { completeSpeech(id, "done"); }
            @Override public void onError(String id) { completeSpeech(id, "error"); }
            @Override public void onError(String id, int code) { completeSpeech(id, "error"); }
            @Override public void onStop(String id, boolean interrupted) { completeSpeech(id, "canceled"); }
        });
        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(0, this::handleBack);
        }
        web.loadUrl("https://appassets.androidplatform.net/assets/www/index.html");
    }

    private void handleBack() {
        web.evaluateJavascript("window.WMAndroidBack ? WMAndroidBack() : false", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    @Override public void onBackPressed() { handleBack(); }

    private void complete(int id, boolean ok, String field, String value) {
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed()) return;
            try {
                JSONObject result = new JSONObject().put("ok", ok);
                if (field != null) result.put(field, value);
                web.evaluateJavascript("window.WMAndroidComplete(" + id + "," + result + ")", null);
            } catch (org.json.JSONException ignored) { }
        });
    }

    private void completeSpeech(String id, String status) {
        if (!speechTracker.complete(id, status)) return;
        runOnUiThread(() -> {
            if (isFinishing() || isDestroyed() || web == null) return;
            web.evaluateJavascript("window.WMAndroidSpeechComplete && window.WMAndroidSpeechComplete(" +
                JSONObject.quote(id) + "," + JSONObject.quote(status) + ")", null);
        });
    }

    public final class Bridge {
        @JavascriptInterface public String getInfo() {
            return "{\"platform\":\"Android\",\"version\":\"2.0.2\"}";
        }
        @JavascriptInterface public void setTheme(String theme) {
            runOnUiThread(() -> {
                boolean light = "light".equals(theme);
                int color = light ? Color.rgb(244, 242, 234) : Color.rgb(18, 29, 26);
                root.setBackgroundColor(color);
                web.setBackgroundColor(color);
                getWindow().setStatusBarColor(color);
                getWindow().setNavigationBarColor(color);
                if (Build.VERSION.SDK_INT >= 30) {
                    WindowInsetsController controller = getWindow().getInsetsController();
                    if (controller != null) {
                        int flags = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS |
                            WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                        controller.setSystemBarsAppearance(light ? flags : 0, flags);
                    }
                } else {
                    root.setSystemUiVisibility(light ? android.view.View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR |
                        android.view.View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
                }
            });
        }
        @JavascriptInterface public boolean speak(String text, float rate, float pitch, String id) {
            if (!speechReady || text == null || text.length() > 4000 || id == null) {
                runOnUiThread(() -> {
                    if (voiceWarningShown) return;
                    voiceWarningShown = true;
                    Toast.makeText(MainActivity.this, "请在系统的文字转语音设置中安装英语语音包", Toast.LENGTH_LONG).show();
                });
                return false;
            }
            runOnUiThread(() -> {
                speechTracker.begin(id, SystemClock.elapsedRealtime());
                try {
                    speech.setSpeechRate(Math.max(0.1f, Math.min(2f, rate)));
                    speech.setPitch(Math.max(0.5f, Math.min(2f, pitch)));
                    if (speech.speak(text, TextToSpeech.QUEUE_FLUSH, null, id) == TextToSpeech.ERROR) {
                        completeSpeech(id, "error");
                    }
                } catch (RuntimeException ex) {
                    completeSpeech(id, "error");
                }
            });
            return true;
        }
        @JavascriptInterface public String getSpeechState(String id) {
            try {
                return speechTracker.poll(id, speech != null && speech.isSpeaking(), SystemClock.elapsedRealtime());
            } catch (RuntimeException ex) { return "error"; }
        }
        @JavascriptInterface public void stopSpeak() {
            runOnUiThread(() -> {
                speechTracker.cancel();
                if (speech != null) speech.stop();
            });
        }

        @JavascriptInterface public void request(int id, String action, String json) {
            runOnUiThread(() -> {
                if (pendingRequest != 0) {
                    complete(id, false, "reason", "busy");
                    return;
                }
                if (!"import".equals(action) && !"export".equals(action)) {
                    complete(id, false, "reason", "unsupported");
                    return;
                }
                pendingRequest = id;
                pendingBackup = json;
                Intent intent;
                int code;
                if ("import".equals(action)) {
                    intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("*/*")
                        .addCategory(Intent.CATEGORY_OPENABLE);
                    code = IMPORT;
                } else {
                    intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json")
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .putExtra(Intent.EXTRA_TITLE, "WordMaster-" +
                            new SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(new Date()) + ".json");
                    code = EXPORT;
                }
                try { startActivityForResult(intent, code); }
                catch (android.content.ActivityNotFoundException ex) {
                    pendingRequest = 0;
                    pendingBackup = null;
                    complete(id, false, "reason", "no-file-picker");
                }
            });
        }
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request != IMPORT && request != EXPORT) return;
        final int id = pendingRequest;
        final String backup = pendingBackup;
        pendingRequest = 0;
        pendingBackup = null;
        if (id == 0) return;
        if (result != RESULT_OK || data == null || data.getData() == null) {
            complete(id, false, "reason", "canceled");
            return;
        }
        final Uri uri = data.getData();
        files.execute(() -> {
            try {
                if (request == EXPORT) {
                    try (OutputStream stream = getContentResolver().openOutputStream(uri, "wt")) {
                        if (stream == null) throw new java.io.IOException("无法打开文件");
                        stream.write(backup.getBytes(StandardCharsets.UTF_8));
                    }
                    complete(id, true, "filePath", "所选文件位置");
                } else {
                    try (InputStream stream = getContentResolver().openInputStream(uri);
                         ByteArrayOutputStream buffer = new ByteArrayOutputStream()) {
                        if (stream == null) throw new java.io.IOException("无法打开文件");
                        byte[] chunk = new byte[8192];
                        int length;
                        while ((length = stream.read(chunk)) != -1) {
                            if (buffer.size() + length > MAX_BACKUP_BYTES) {
                                throw new java.io.IOException("备份超过 16 MB");
                            }
                            buffer.write(chunk, 0, length);
                        }
                        complete(id, true, "text", new String(buffer.toByteArray(), StandardCharsets.UTF_8));
                    }
                }
            } catch (Exception error) {
                complete(id, false, "reason", error.getMessage());
            }
        });
    }

    @Override protected void onPause() {
        web.evaluateJavascript("if (window.WM) { if (WM.study) WM.study.pauseAutoAdvance(); " +
            "if (WM.sound) WM.sound.stopSpeak(); if (WM.store) WM.store.flush(); }", null);
        speechTracker.cancel();
        if (speech != null) speech.stop();
        web.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (web != null) web.onResume();
    }
    @Override protected void onDestroy() {
        files.shutdown();
        if (speech != null) { speech.stop(); speech.shutdown(); }
        if (web != null) { root.removeView(web); web.destroy(); }
        super.onDestroy();
    }
}
