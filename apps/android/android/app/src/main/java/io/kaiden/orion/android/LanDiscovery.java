package io.kaiden.orion.android;

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Handler;
import android.os.Build;
import android.os.Looper;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;

/** Discovery advertisements are untrusted hints. They never grant device trust. */
final class LanDiscovery implements NsdManager.DiscoveryListener {
    private final NsdManager manager;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final PluginCall call;
    private final JSONArray nodes = new JSONArray();
    private final ArrayDeque<NsdServiceInfo> queue = new ArrayDeque<>();
    private WifiManager.MulticastLock lock;
    private boolean finished, resolving;
    private int seen;
    private final Set<String> emitted = new HashSet<>();
    LanDiscovery(Context context, PluginCall call) {
        this.call = call;
        manager = (NsdManager) context.getSystemService(Context.NSD_SERVICE);
        try {
            WifiManager wifi = (WifiManager) context.getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi != null) { lock = wifi.createMulticastLock("orion-discovery"); lock.setReferenceCounted(false); lock.acquire(); }
        } catch (RuntimeException ignored) { /* NSD may still work through platform multicast management. */ }
    }
    void start() {
        handler.post(() -> {
            try { manager.discoverServices("_orion._tcp.", NsdManager.PROTOCOL_DNS_SD, this); }
            catch (RuntimeException error) { finish("Поиск недоступен. Проверьте Wi-Fi и разрешение локальной сети."); }
            handler.postDelayed(() -> finish(null), 6000);
        });
    }
    private void finish(String error) {
        if (finished) return;
        finished = true; queue.clear(); handler.removeCallbacksAndMessages(null);
        try { manager.stopServiceDiscovery(this); } catch (RuntimeException ignored) {}
        if (lock != null && lock.isHeld()) lock.release();
        if (error != null) call.reject(error);
        else { JSObject result = new JSObject(); result.put("nodes", nodes); call.resolve(result); }
    }
    public void onDiscoveryStarted(String type) {}
    public void onDiscoveryStopped(String type) {}
    public void onStopDiscoveryFailed(String type, int code) {}
    public void onStartDiscoveryFailed(String type, int code) { handler.post(() -> finish("Не удалось начать поиск. Проверьте Wi-Fi, VPN и доступ к локальной сети.")); }
    public void onServiceLost(NsdServiceInfo service) {}
    public void onServiceFound(NsdServiceInfo service) { handler.post(() -> { if (!finished && seen++ < 32) { queue.add(service); next(); } }); }
    private void next() {
        if (finished || resolving || queue.isEmpty()) return;
        resolving = true;
        try { manager.resolveService(queue.remove(), new NsdManager.ResolveListener() {
            public void onResolveFailed(NsdServiceInfo service, int code) { handler.post(() -> { resolving = false; next(); }); }
            public void onServiceResolved(NsdServiceInfo service) { handler.post(() -> {
                if (finished) return;
                try {
                    Map<String, byte[]> txt = service.getAttributes();
                    String id = text(txt, "id"), fp = text(txt, "fp"), name = text(txt, "name");
                    if ("1".equals(text(txt,"v")) && !id.isEmpty() && id.length() <= 128 && fp.matches("[a-fA-F0-9]{64}")) {
                        int port = service.getPort();
                        // Android 34+ resolves all routes. getHost() alone can select a VPN-only address.
                        for (String address : LanAddresses.ipv4(Build.VERSION.SDK_INT >= 34 ? service.getHostAddresses() : Collections.singletonList(service.getHost()))) {
                          if (port > 0 && port <= 65535 && nodes.length() < 32 && emitted.add(id + ":" + fp + ":" + address + ":" + port)) {
                            JSObject node = new JSObject(); node.put("protocol",1); node.put("nodeId",id); node.put("name",name.length() > 80 ? name.substring(0,80) : name);
                            node.put("fingerprint",fp.toUpperCase().replaceAll("(..)(?!$)","$1:")); node.put("address",address); node.put("port",port); nodes.put(node);
                          }
                        }
                    }
                } catch (RuntimeException ignored) { /* Malformed advertisements are ignored. */ }
                resolving = false; next();
            }); }
        }); } catch (RuntimeException error) { resolving = false; next(); }
    }
    private static String text(Map<String, byte[]> txt, String key) { byte[] value = txt.get(key); return value == null ? "" : new String(value,StandardCharsets.UTF_8); }
}
