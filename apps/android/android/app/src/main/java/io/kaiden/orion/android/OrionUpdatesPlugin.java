package io.kaiden.orion.android;

import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONObject;

/** Only the fixed Android release source is reachable through this bridge.
 * Downloaded bytes must match both the manifest AND the installed signing key. */
@CapacitorPlugin(name = "OrionUpdates")
public class OrionUpdatesPlugin extends Plugin {
    private static final String REPOSITORY = "KeinReno/ORION-Android-Releases";
    private static final String FEED = "https://raw.githubusercontent.com/" + REPOSITORY + "/main/android-update.json";
    private static final long MAX_APK_SIZE = 100L * 1024 * 1024;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);
    private SharedPreferences preferences;
    private JSONObject candidate;

    @Override
    public void load() {
        preferences = getContext().getSharedPreferences("orion-updates", 0);
        try {
            String saved = preferences.getString("candidate", null);
            if (saved != null) candidate = validateManifest(new JSONObject(saved));
        } catch (Exception ignored) { candidate = null; }
    }

    private File apkFile() { return new File(new File(getContext().getCacheDir(), "updates"), "orion-update.apk"); }
    private long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }
    @SuppressWarnings("deprecation")
    private PackageInfo installed() throws Exception {
        return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),
            Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
    }
    private boolean canInstall() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }
    private boolean wifi() {
        ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(android.content.Context.CONNECTIVITY_SERVICE);
        NetworkCapabilities caps = manager.getNetworkCapabilities(manager.getActiveNetwork());
        return caps != null && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
            && caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED) && !manager.isActiveNetworkMetered();
    }

    private synchronized JSObject state() throws Exception {
        PackageInfo current = installed();
        boolean available = candidate != null && candidate.getLong("versionCode") > versionCode(current);
        JSObject out = new JSObject();
        out.put("installedVersion", current.versionName);
        out.put("installedCode", versionCode(current));
        out.put("lastChecked", preferences.getLong("lastChecked", 0));
        out.put("lastAttempt", preferences.getLong("lastAttempt", 0));
        out.put("available", available);
        out.put("ready", available && apkFile().isFile()
            && candidate.getJSONObject("apk").getString("sha256").equals(preferences.getString("readySha256", "")));
        out.put("downloading", downloading.get());
        out.put("canInstall", canInstall());
        out.put("wifi", wifi());
        out.put("manifest", available ? candidate : JSONObject.NULL);
        return out;
    }

    @PluginMethod
    public void getState(PluginCall call) {
        worker.execute(() -> { try { call.resolve(state()); } catch (Exception error) { call.reject("Не удалось прочитать сведения об обновлении"); } });
    }

    @PluginMethod
    public void check(PluginCall call) {
        worker.execute(() -> {
            try {
                preferences.edit().putLong("lastAttempt", System.currentTimeMillis()).commit();
                JSONObject manifest;
                HttpURLConnection connection = connect(new URL(FEED), false);
                long started = System.currentTimeMillis();
                try (InputStream input = connection.getInputStream(); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                    byte[] buffer = new byte[4096];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (System.currentTimeMillis() - started > 30000) throw new IllegalStateException("Manifest timeout");
                        if (output.size() + count > 65536) throw new IllegalStateException("Слишком большой manifest");
                        output.write(buffer, 0, count);
                    }
                    manifest = validateManifest(new JSONObject(output.toString(StandardCharsets.UTF_8.name())));
                } finally { connection.disconnect(); }
                synchronized (this) { candidate = manifest; }
                preferences.edit().putString("candidate", manifest.toString())
                    .putLong("lastChecked", System.currentTimeMillis()).commit();
                call.resolve(state());
            } catch (Exception error) {
                call.reject("Не удалось проверить обновления. Проверьте интернет и повторите.");
            }
        });
    }

    private JSONObject validateManifest(JSONObject manifest) throws Exception {
        if (manifest.getInt("schemaVersion") != 1 || !getContext().getPackageName().equals(manifest.getString("applicationId"))
            || manifest.getLong("versionCode") < 1 || manifest.getLong("versionCode") > Integer.MAX_VALUE
            || manifest.getString("versionName").isEmpty() || manifest.getString("versionName").length() > 60
            || manifest.getString("notes").length() > 30000) throw new IllegalArgumentException("Invalid manifest");
        String tag = manifest.getString("tag");
        JSONObject apk = manifest.getJSONObject("apk");
        UpdatePolicy.requireSource(REPOSITORY, tag, apk.getString("url"));
        if (!apk.getString("sha256").matches("[a-f0-9]{64}") || apk.getLong("size") < 1
            || apk.getLong("size") > MAX_APK_SIZE) throw new IllegalArgumentException("Invalid APK source");
        return manifest;
    }

    private HttpURLConnection connect(URL original, boolean download) throws Exception {
        URL url = original;
        for (int redirect = 0; redirect < 6; redirect++) {
            if (!"https".equals(url.getProtocol()) || url.getUserInfo() != null || url.getPort() != -1) throw new IllegalArgumentException("HTTPS required");
            String host = url.getHost();
            if (!(download ? host.equals("github.com") || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com")
                : host.equals("raw.githubusercontent.com"))) throw new IllegalArgumentException("Unexpected update host");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(15000);
            connection.setReadTimeout(20000);
            connection.setUseCaches(false);
            connection.setRequestProperty("User-Agent", "KAIDEN-Orion-Android");
            int status = connection.getResponseCode();
            if (status == 200) return connection;
            String location = connection.getHeaderField("Location");
            connection.disconnect();
            if ((status == 301 || status == 302 || status == 303 || status == 307 || status == 308) && location != null) {
                url = new URL(url, location);
            } else throw new IllegalStateException("HTTP " + status);
        }
        throw new IllegalStateException("Too many redirects");
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (!downloading.compareAndSet(false, true)) { call.reject("Загрузка уже идёт"); return; }
        final boolean wifiOnly = Boolean.TRUE.equals(call.getBoolean("wifiOnly", false));
        worker.execute(() -> {
            File partial = new File(apkFile().getParentFile(), "orion-update.part.apk");
            try {
                JSONObject manifest;
                synchronized (this) {
                    if (candidate == null) throw new IllegalStateException("Сначала проверьте обновления");
                    manifest = new JSONObject(candidate.toString());
                }
                if (manifest.getLong("versionCode") <= versionCode(installed())) throw new IllegalStateException("Обновление уже установлено");
                if (wifiOnly && !wifi()) throw new IllegalStateException("Для автоматической загрузки нужен Wi-Fi без лимита трафика");
                File directory = partial.getParentFile();
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IllegalStateException("Не удалось открыть папку обновлений");
                long expected = manifest.getJSONObject("apk").getLong("size");
                HttpURLConnection connection = connect(new URL(manifest.getJSONObject("apk").getString("url")), true);
                long received = 0;
                long started = System.currentTimeMillis();
                long lastEvent = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(partial)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (Thread.currentThread().isInterrupted() || System.currentTimeMillis() - started > 10 * 60 * 1000)
                            throw new IllegalStateException("Загрузка прервана. Повторите.");
                        if (wifiOnly && !wifi()) throw new IllegalStateException("Wi-Fi недоступен. Повторите загрузку позже.");
                        received += count;
                        if (received > expected) throw new IllegalStateException("Неверный размер APK");
                        output.write(buffer, 0, count);
                        long now = System.currentTimeMillis();
                        if (now - lastEvent > 250) {
                            JSObject progress = new JSObject();
                            progress.put("received", received); progress.put("total", expected);
                            notifyListeners("downloadProgress", progress);
                            lastEvent = now;
                        }
                    }
                    output.getFD().sync();
                } finally { connection.disconnect(); }
                verifyApk(partial, manifest);
                if (apkFile().exists() && !apkFile().delete()) throw new IllegalStateException("Не удалось заменить предыдущую загрузку");
                if (!partial.renameTo(apkFile())) throw new IllegalStateException("Не удалось завершить загрузку");
                preferences.edit().putString("readySha256", manifest.getJSONObject("apk").getString("sha256")).commit();
                downloading.set(false);
                call.resolve(state());
            } catch (Exception error) {
                partial.delete();
                downloading.set(false);
                call.reject("Не удалось загрузить проверенный APK. Проверьте сеть и свободное место, затем повторите.");
            }
        });
    }

    private String hex(byte[] value) {
        StringBuilder result = new StringBuilder();
        for (byte b : value) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    @SuppressWarnings("deprecation")
    private String[] signers(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28 && info.signingInfo != null
            ? info.signingInfo.getApkContentsSigners() : info.signatures;
        if (signatures == null || signatures.length == 0) throw new IllegalStateException("Нет сертификата APK");
        String[] result = new String[signatures.length];
        for (int i = 0; i < signatures.length; i++) result[i] = hex(MessageDigest.getInstance("SHA-256").digest(signatures[i].toByteArray()));
        Arrays.sort(result);
        return result;
    }
    @SuppressWarnings("deprecation")
    private void verifyApk(File file, JSONObject manifest) throws Exception {
        JSONObject apk = manifest.getJSONObject("apk");
        if (file.length() != apk.getLong("size")) throw new IllegalStateException("Неверный размер APK");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = input.read(buffer)) != -1) digest.update(buffer, 0, count);
        }
        if (!hex(digest.digest()).equals(apk.getString("sha256"))) throw new IllegalStateException("Неверная контрольная сумма APK");
        PackageManager manager = getContext().getPackageManager();
        PackageInfo archive = manager.getPackageArchiveInfo(file.getAbsolutePath(),
            Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES);
        PackageInfo current = installed();
        if (archive == null) throw new IllegalStateException("Некорректный APK");
        UpdatePolicy.requireCompatible(current.packageName, versionCode(current), archive.packageName, versionCode(archive),
            manifest.getLong("versionCode"), archive.versionName, manifest.getString("versionName"), signers(current), signers(archive));
    }

    @PluginMethod
    public void install(PluginCall call) {
        worker.execute(() -> {
            try {
                JSONObject manifest;
                synchronized (this) {
                    if (candidate == null) throw new IllegalStateException("Сначала загрузите обновление");
                    manifest = new JSONObject(candidate.toString());
                }
                verifyApk(apkFile(), manifest);
                getActivity().runOnUiThread(() -> {
                    try {
                        if (!canInstall() && Build.VERSION.SDK_INT >= 26) {
                            Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                            getActivity().startActivity(settings);
                            JSObject result = new JSObject(); result.put("status", "permission"); call.resolve(result);
                        } else {
                            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apkFile());
                            Intent intent = new Intent(Intent.ACTION_VIEW);
                            intent.setDataAndType(uri, "application/vnd.android.package-archive");
                            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                            getActivity().startActivity(intent);
                            JSObject result = new JSObject(); result.put("status", "installer"); call.resolve(result);
                        }
                    } catch (Exception error) { call.reject("Не удалось открыть установщик Android"); }
                });
            } catch (Exception error) { call.reject("APK больше не готов к установке. Проверьте обновления и загрузите его снова."); }
        });
    }

    @Override
    protected void handleOnDestroy() { worker.shutdownNow(); }
}
