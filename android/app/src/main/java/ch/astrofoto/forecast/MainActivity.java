package ch.astrofoto.forecast;

import android.Manifest;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.webkit.GeolocationPermissions;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import androidx.webkit.WebViewAssetLoader;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Set;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Collections;

public final class MainActivity extends ComponentActivity {
    private static final String ORIGIN = "https://astro-foto.ch";
    private static final String APP_PATH = "/astro-forecast/";
    private static final int LOCATION_PERMISSION = 100;
    private static final Set<String> ASSETS = new HashSet<>(Arrays.asList(
        "index.html", "app.js", "styles.css", "manifest.webmanifest", "icon-192.png", "icon-512.png"
    ));
    private WebView webView;
    private GeolocationPermissions.Callback pendingLocation;
    private String pendingOrigin;
    private boolean permissionRequestPending;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(7, 11, 20));
        setContentView(root);
        // Protect controls from system bars, Pixel camera cutout and the keyboard.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets safe = insets.getInsets(
                    android.view.WindowInsets.Type.systemBars()
                    | android.view.WindowInsets.Type.displayCutout()
                    | android.view.WindowInsets.Type.ime()
                );
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            }
            return insets;
        });
        root.requestApplyInsets();
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(7, 11, 20));
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setGeolocationEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .setDomain("astro-foto.ch")
            .addPathHandler(APP_PATH, path -> {
                if (!ASSETS.contains(path)) return null; // API calls go to the server.
                String mime = path.endsWith(".html") ? "text/html" : path.endsWith(".css") ? "text/css"
                    : path.endsWith(".js") ? "application/javascript" : path.endsWith(".png") ? "image/png"
                    : "application/manifest+json";
                try {
                    return new WebResourceResponse(mime, path.endsWith(".png") ? null : "UTF-8", 200, "OK",
                        Collections.singletonMap("Cache-Control", "no-store"), getAssets().open(path));
                } catch (IOException error) {
                    return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", Collections.emptyMap(),
                        new ByteArrayInputStream(new byte[0]));
                }
            }).build();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                return !"https".equals(uri.getScheme()) || !"astro-foto.ch".equals(uri.getHost())
                    || uri.getPort() != -1 || uri.getUserInfo() != null
                    || !(APP_PATH + "index.html").equals(uri.getPath());
            }
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                finishLocation(false);
                root.removeView(view);
                view.destroy();
                webView = null;
                Toast.makeText(MainActivity.this, "Bitte Astro Forecast erneut öffnen.", Toast.LENGTH_LONG).show();
                finish();
                return true;
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (!(ORIGIN.equals(origin) || (ORIGIN + "/").equals(origin)) || permissionRequestPending) {
                    callback.invoke(origin, false, false);
                    return;
                }
                finishLocation(false);
                pendingLocation = callback;
                pendingOrigin = origin;
                if (hasLocationPermission()) {
                    finishLocation(true);
                } else {
                    permissionRequestPending = true;
                    requestPermissions(new String[]{Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION}, LOCATION_PERMISSION);
                }
            }
            @Override
            public void onGeolocationPermissionsHidePrompt() {
                finishLocation(false);
            }
        });
        webView.loadUrl(ORIGIN + APP_PATH + "index.html?android=1");
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() { navigateBack(); }
        });
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    private void finishLocation(boolean allow) {
        if (pendingLocation != null) {
            GeolocationPermissions.Callback callback = pendingLocation;
            String origin = pendingOrigin;
            pendingLocation = null;
            pendingOrigin = null;
            callback.invoke(origin, allow, false);
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == LOCATION_PERMISSION) {
            permissionRequestPending = false;
            finishLocation(hasLocationPermission());
        }
    }

    private void navigateBack() {
        if (webView != null && webView.canGoBack()) webView.goBack(); else finish();
    }

    @Override
    protected void onDestroy() {
        finishLocation(false);
        if (webView != null) {
            ((FrameLayout) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
