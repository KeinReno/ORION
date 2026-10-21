package io.kaiden.orion.android;

import static org.junit.Assert.*;
import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.URL;
import java.security.KeyStore;
import java.security.cert.X509Certificate;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.*;
import org.junit.Test;

public class LanTlsTest {
    private KeyStore store(String resource) throws Exception {
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) { store.load(input, "test-only".toCharArray()); }
        return store;
    }
    private X509Certificate cert(String resource) throws Exception { return (X509Certificate) store(resource).getCertificate("host"); }
    private final class Host implements AutoCloseable {
        final SSLServerSocket server;
        final ExecutorService executor = Executors.newSingleThreadExecutor();
        final AtomicBoolean applicationData = new AtomicBoolean(false);
        final Future<?> task;
        Host(String resource) throws Exception {
            KeyManagerFactory manager = KeyManagerFactory.getInstance(KeyManagerFactory.getDefaultAlgorithm());
            manager.init(store(resource), "test-only".toCharArray());
            SSLContext context = SSLContext.getInstance("TLS"); context.init(manager.getKeyManagers(), null, null);
            server = (SSLServerSocket) context.getServerSocketFactory().createServerSocket(0);
            server.setSoTimeout(5000);
            task = executor.submit(() -> {
                try (SSLSocket socket = (SSLSocket) server.accept()) {
                    socket.setSoTimeout(5000); socket.startHandshake();
                    BufferedReader reader = new BufferedReader(new InputStreamReader(socket.getInputStream(), java.nio.charset.StandardCharsets.UTF_8));
                    String line;
                    while ((line = reader.readLine()) != null && !line.isEmpty()) applicationData.set(true);
                    socket.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                } catch (Exception expectedForRejectedHandshake) { /* Peer may deliberately reject the certificate. */ }
            });
        }
        int port() { return server.getLocalPort(); }
        void done() throws Exception { task.get(6, TimeUnit.SECONDS); }
        public void close() throws Exception { server.close(); executor.shutdownNow(); }
    }
    @Test public void observationCapturesCertificateButSendsNoApplicationData() throws Exception {
        try (Host host = new Host("lan-host-test.p12")) {
            X509Certificate observed = LanTls.observe("127.0.0.1", host.port());
            host.done();
            assertArrayEquals(cert("lan-host-test.p12").getEncoded(), observed.getEncoded());
            assertFalse(host.applicationData.get());
        }
    }
    @Test public void pinnedCertificateAllowsRealTlsHttp() throws Exception {
        try (Host host = new Host("lan-host-test.p12")) {
            HttpsURLConnection connection = (HttpsURLConnection) new URL("https://127.0.0.1:" + host.port() + "/lan/info").openConnection();
            LanTls.pin(connection, cert("lan-host-test.p12")); connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
            assertEquals(200, connection.getResponseCode());
            connection.disconnect(); host.done(); assertTrue(host.applicationData.get());
        }
    }
    @Test public void changedLeafIsRejectedBeforeAnyAuthHeadersReachHost() throws Exception {
        try (Host host = new Host("lan-other-test.p12")) {
            HttpsURLConnection connection = (HttpsURLConnection) new URL("https://127.0.0.1:" + host.port() + "/workspaces/me").openConnection();
            LanTls.pin(connection, cert("lan-host-test.p12")); connection.setConnectTimeout(3000); connection.setReadTimeout(3000);
            connection.setRequestProperty("Authorization", "Bearer synthetic-fixture");
            assertThrows(java.io.IOException.class, connection::getResponseCode);
            connection.disconnect(); host.done(); assertFalse(host.applicationData.get());
        }
    }
    @Test public void pairingCodeMatchesExistingNodeProtocol() throws Exception {
        assertEquals("405700", LanTls.pairingCode("client-fixture", "server-fixture", "AA:BB:CC"));
        assertEquals(LanTls.pairingCode("client-fixture", "server-fixture", "AA:BB:CC"), LanTls.pairingCode("client-fixture", "server-fixture", "aabbcc"));
    }
    @Test public void bridgeRejectsArbitraryPathsAndUrls() {
        assertTrue(LanTls.allowedApi("GET", "/workspaces/me"));
        assertTrue(LanTls.allowedApi("POST", "/workspaces/workspace_1/sync/ops"));
        assertTrue(LanTls.allowedApi("GET", "/workspaces/ws/sync/replica/changes?cursor=123%3Aabc"));
        for (String path : new String[]{"https://evil.test", "/auth/login", "/auth/refresh", "/lan/host/enable", "/workspaces/ws/tasks", "/workspaces/../sync/ops"})
            assertFalse(LanTls.allowedApi("POST", path));
        assertFalse(LanTls.allowedApi("DELETE", "/sync/devices"));
        assertThrows(Exception.class, () -> LanTls.requireAddress("host/path", 4443));
        assertThrows(Exception.class, () -> LanTls.requireAddress("host", 65536));
    }
}
