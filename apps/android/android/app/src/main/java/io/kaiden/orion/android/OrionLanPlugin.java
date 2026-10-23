package io.kaiden.orion.android;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

/** Device trust, credentials and TLS remain native. JS cannot request arbitrary URLs. */
@CapacitorPlugin(name = "OrionLan")
public class OrionLanPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LanVault vault;
    private JSONObject pairing;
    @Override public void load() { vault = new LanVault(getContext()); }
    private interface Task { void run() throws Exception; }
    private void run(PluginCall call, Task task) {
        worker.execute(() -> { try { task.run(); } catch (Exception error) {
            call.reject("Компьютер недоступен или его сертификат изменился. Проверьте адрес, режим «Хост LAN» и подключение к одной сети.");
        } });
    }
    private JSONObject binding() throws Exception {
        JSONObject value = vault.read();
        if (value == null) throw new IllegalStateException("Not paired");
        return value;
    }
    private JSObject state(JSONObject binding) throws Exception {
        JSObject view = new JSObject();
        view.put("paired", binding != null);
        view.put("node", binding == null ? JSONObject.NULL : binding.getJSONObject("node"));
        view.put("user", binding == null ? JSONObject.NULL : binding.opt("user") == null ? JSONObject.NULL : binding.opt("user"));
        view.put("address", binding == null ? "" : binding.getString("address"));
        view.put("port", binding == null ? 4443 : binding.getInt("port"));
        return view;
    }
    @PluginMethod public void discover(PluginCall call) { new LanDiscovery(getContext(), call).start(); }
    @PluginMethod public void reconnect(PluginCall call) {
        run(call, () -> {
            JSONObject saved = binding();
            String address = call.getString("address", ""); int port = call.getInt("port",4443);
            JSONObject probe = new JSONObject().put("address",address).put("port",port).put("certificate",saved.getString("certificate"));
            // No device token/JWT is sent until the pinned TLS identity has been checked.
            Response info = request(probe,"GET","/lan/info",null,false,null);
            if (info.status != 200 || !LanIdentity.sameNode(saved.getJSONObject("node").getString("nodeId"),info.object().getString("nodeId"),info.object().getInt("protocol")))
                throw new Exception("Different node identity");
            JSONObject candidate = new JSONObject(saved.toString()).put("address",address).put("port",port);
            Response trust = request(candidate,"GET","/auth/accounts",null,false,null);
            String trustCode = trust.body instanceof JSONObject ? ((JSONObject) trust.body).optString("code","") : "";
            if ("device_revoked".equals(trustCode) || "device_untrusted".equals(trustCode)) {
                call.reject("Доступ телефона отозван или не подтверждён на ПК. Запросите новое разрешение."); return;
            }
            if (trust.status != 200 && trust.status != 403) throw new Exception("Host unavailable");
            // Strict login policy may forbid account enumeration (403) even for trusted devices.
            saved.put("address",address).put("port",port); vault.save(saved);
            call.resolve(state(saved));
        });
    }

    @PluginMethod public void getState(PluginCall call) { run(call, () -> call.resolve(state(vault.read()))); }

    private static final class Response {
        final int status; final Object body;
        Response(int status, Object body) { this.status = status; this.body = body; }
        JSONObject object() throws Exception { if (!(body instanceof JSONObject)) throw new Exception("Expected object"); return (JSONObject) body; }
        JSObject view() throws Exception { JSObject view = new JSObject(); view.put("status", status); view.put("body", body == null ? JSONObject.NULL : body); return view; }
    }
    private Response request(JSONObject target, String method, String path, JSONObject body, boolean auth, String pairSecret) throws Exception {
        String address = target.getString("address"); int port = target.getInt("port");
        LanTls.requireAddress(address, port);
        X509Certificate certificate = LanTls.certificate(Base64.decode(target.getString("certificate"), Base64.NO_WRAP));
        HttpsURLConnection connection = (HttpsURLConnection) new URL("https://" + address + ":" + port + path).openConnection();
        LanTls.pin(connection, certificate);
        connection.setInstanceFollowRedirects(false);
        connection.setConnectTimeout(5000); connection.setReadTimeout(15000);
        connection.setRequestMethod(method); connection.setUseCaches(false);
        connection.setRequestProperty("Accept", "application/json");
        connection.setRequestProperty("User-Agent", "KAIDEN-Orion-Android");
        if (target.has("deviceToken")) connection.setRequestProperty("x-orion-device", target.getString("deviceToken"));
        if (auth && target.has("accessToken")) connection.setRequestProperty("Authorization", "Bearer " + target.getString("accessToken"));
        if (pairSecret != null) connection.setRequestProperty("x-orion-pair-secret", pairSecret);
        try {
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                if (bytes.length > 8 * 1024 * 1024) throw new Exception("Request too large");
                connection.setRequestProperty("Content-Type", "application/json");
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream output = connection.getOutputStream()) { output.write(bytes); }
            }
            int status = connection.getResponseCode();
            InputStream stream = status < 400 ? connection.getInputStream() : connection.getErrorStream();
            if (stream == null) return new Response(status, null);
            try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[65536]; int count; long start = System.currentTimeMillis();
                while ((count = input.read(buffer)) != -1) {
                    if (output.size() + count > 16 * 1024 * 1024 || System.currentTimeMillis() - start > 30000) throw new Exception("Response limit");
                    output.write(buffer, 0, count);
                }
                String raw = output.toString(StandardCharsets.UTF_8.name());
                Object parsed = raw.isEmpty() ? null : new JSONTokener(raw).nextValue();
                if (parsed != null && !(parsed instanceof JSONObject) && !(parsed instanceof JSONArray)) throw new Exception("Invalid JSON");
                if (target.has("deviceToken") && parsed instanceof JSONObject && status == 401
                    && "device_revoked".equals(((JSONObject) parsed).optString("code"))) vault.clear();
                return new Response(status, parsed);
            }
        } finally { connection.disconnect(); }
    }
    private JSONObject credentials(JSONObject target, JSONObject response) throws Exception {
        target.put("accessToken", response.getString("accessToken")); target.put("refreshToken", response.getString("refreshToken"));
        target.put("user", response.getJSONObject("user")); vault.save(target);
        return target;
    }
    private Response authenticated(JSONObject target, String method, String path, JSONObject body) throws Exception {
        if (!target.has("accessToken")) return new Response(401, new JSONObject().put("code", "login_required"));
        Response response = request(target, method, path, body, true, null);
        String code = response.body instanceof JSONObject ? ((JSONObject) response.body).optString("code") : "";
        if (response.status == 401 && !code.equals("device_revoked")) {
            Response refresh = request(target, "POST", "/auth/refresh", new JSONObject().put("refreshToken", target.getString("refreshToken")), false, null);
            if (refresh.status == 200 || refresh.status == 201) {
                credentials(target, refresh.object());
                return request(target, method, path, body, true, null);
            }
            if (refresh.status >= 500 || refresh.status == 408 || refresh.status == 429) return refresh;
            target.remove("accessToken"); target.remove("refreshToken"); target.remove("user"); vault.save(target);
        }
        return response;
    }

    @PluginMethod public void beginPairing(PluginCall call) {
        run(call, () -> {
            if (vault.read() != null) { call.reject("Сначала отключите прежний компьютер"); return; }
            String address = call.getString("address", "");
            int port = call.getInt("port", 4443);
            X509Certificate certificate = LanTls.observe(address, port);
            JSONObject target = new JSONObject().put("address", address).put("port", port)
                .put("certificate", Base64.encodeToString(certificate.getEncoded(), Base64.NO_WRAP));
            Response info = request(target, "GET", "/lan/info", null, false, null);
            if (info.status != 200 || info.object().getInt("protocol") != 1) throw new Exception("Unsupported LAN protocol");
            JSONObject node = info.object(); node.put("fingerprint", LanTls.fingerprint(certificate));
            byte[] nonce = new byte[24]; new SecureRandom().nextBytes(nonce);
            String clientNonce = Base64.encodeToString(nonce, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            Response response = request(target, "POST", "/lan/pair/request",
                new JSONObject().put("deviceName", (android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL).substring(0, Math.min(80, (android.os.Build.MANUFACTURER + " " + android.os.Build.MODEL).length()))).put("clientNonce", clientNonce), false, null);
            if (response.status != 200 && response.status != 201) { call.reject("Компьютер отклонил заявку. Повторите позже."); return; }
            JSONObject created = response.object();
            target.put("node", node).put("requestId", created.getString("requestId")).put("clientNonce", clientNonce)
                .put("expiresAt", created.getString("expiresAt"))
                .put("code", LanTls.pairingCode(clientNonce, created.getString("serverNonce"), node.getString("fingerprint")));
            pairing = target;
            JSObject result = new JSObject(); result.put("code", target.getString("code")); result.put("node", node);
            result.put("expiresAt", created.getString("expiresAt")); result.put("status", "pending");
            call.resolve(result);
        });
    }
    @PluginMethod public void pollPairing(PluginCall call) {
        run(call, () -> {
            if (pairing == null) { call.reject("Заявка потеряна или истекла. Начните подключение снова."); return; }
            Response response = request(pairing, "GET", "/lan/pair/status/" + pairing.getString("requestId"), null, false, pairing.getString("clientNonce"));
            if (response.status != 200) { call.reject("Не удалось проверить подтверждение. Повторите."); return; }
            String status = response.object().getString("status");
            if (status.equals("approved")) {
                JSONObject stored = new JSONObject().put("address", pairing.getString("address")).put("port", pairing.getInt("port"))
                    .put("certificate", pairing.getString("certificate")).put("node", pairing.getJSONObject("node"))
                    .put("deviceToken", response.object().getString("deviceToken"));
                vault.save(stored); pairing = null;
                JSObject result = state(stored); result.put("status", "approved"); call.resolve(result);
            } else {
                JSObject result = new JSObject(); result.put("status", status); call.resolve(result);
                if (!status.equals("pending")) pairing = null;
            }
        });
    }
    @PluginMethod public void accounts(PluginCall call) {
        run(call, () -> call.resolve(request(binding(), "GET", "/auth/accounts", null, false, null).view()));
    }
    @PluginMethod public void login(PluginCall call) {
        // Credentials are never returned to JS and never included in an error message.
        JSONObject input = call.getObject("credentials");
        call.getData().remove("credentials");
        run(call, () -> {
            if (input == null) throw new Exception("Missing login");
            JSONObject target = binding();
            Response response = request(target, "POST", "/auth/login", input, false, null);
            if (response.status != 200 && response.status != 201) {
                call.reject(response.status == 429 ? "Слишком много попыток. Подождите перед повтором." : "Не удалось войти. Проверьте учётную запись и пароль/PIN."); return;
            }
            credentials(target, response.object()); call.resolve(state(target));
        });
    }
    @PluginMethod public void api(PluginCall call) {
        String method = call.getString("method", "GET"); String path = call.getString("path", "");
        if (!LanTls.allowedApi(method, path)) { call.reject("Этот запрос не разрешён Android-клиенту"); return; }
        JSONObject body = call.getObject("body");
        run(call, () -> call.resolve(authenticated(binding(), method, path, body).view()));
    }
    @PluginMethod public void forget(PluginCall call) {
        run(call, () -> { vault.clear(); pairing = null; call.resolve(state(null)); });
    }
    @PluginMethod public void logout(PluginCall call) {
        run(call, () -> {
            JSONObject old = binding();
            JSONObject target = new JSONObject(old.toString());
            target.remove("accessToken"); target.remove("refreshToken"); target.remove("user");
            vault.save(target);
            try {
                if (old.has("refreshToken")) request(old, "POST", "/auth/logout", new JSONObject().put("refreshToken", old.getString("refreshToken")), false, null);
            } catch (Exception ignored) { /* Local access is removed even while the computer is offline. */ }
            call.resolve(state(target));
        });
    }
    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
}
