package io.kaiden.orion.android;

import java.io.ByteArrayInputStream;
import java.net.InetSocketAddress;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.cert.CertificateException;
import java.security.cert.CertificateFactory;
import java.security.cert.X509Certificate;
import java.util.Locale;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLException;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.TrustManager;
import javax.net.ssl.TrustManagerFactory;
import javax.net.ssl.X509TrustManager;

/** Identity is the owner's certificate, not a changing DHCP address.
 * Observation always rejects the initial TLS handshake; it never trusts all peers. */
final class LanTls {
    private LanTls() {}
    static void requireAddress(String host, int port) {
        if (host == null || !host.matches("[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}") || host.contains("..") || port < 1 || port > 65535)
            throw new IllegalArgumentException("Invalid LAN address");
    }
    static X509Certificate observe(String host, int port) throws Exception {
        requireAddress(host, port);
        final X509Certificate[] observed = new X509Certificate[1];
        X509TrustManager observer = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[0]; }
            public void checkClientTrusted(X509Certificate[] chain, String auth) throws CertificateException { throw new CertificateException("Not a client trust manager"); }
            public void checkServerTrusted(X509Certificate[] chain, String auth) throws CertificateException {
                if (chain == null || chain.length == 0) throw new CertificateException("No certificate");
                chain[0].checkValidity();
                observed[0] = chain[0];
                throw new CertificateException("Observation only: user pairing is required");
            }
        };
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[]{observer}, null);
        try (SSLSocket socket = (SSLSocket) context.getSocketFactory().createSocket()) {
            socket.connect(new InetSocketAddress(host, port), 5000);
            socket.setSoTimeout(5000);
            try { socket.startHandshake(); } catch (SSLException expected) {
                if (observed[0] == null) throw expected;
            }
        }
        if (observed[0] == null) throw new CertificateException("No certificate");
        return observed[0];
    }
    static X509Certificate certificate(byte[] der) throws Exception {
        return (X509Certificate) CertificateFactory.getInstance("X.509").generateCertificate(new ByteArrayInputStream(der));
    }
    static SSLContext pinnedContext(X509Certificate pinned) throws Exception {
        KeyStore store = KeyStore.getInstance(KeyStore.getDefaultType());
        store.load(null); store.setCertificateEntry("orion-host", pinned);
        TrustManagerFactory factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
        factory.init(store);
        X509TrustManager delegate = null;
        for (TrustManager manager : factory.getTrustManagers()) if (manager instanceof X509TrustManager) delegate = (X509TrustManager) manager;
        if (delegate == null) throw new CertificateException("No X509 trust manager");
        final X509TrustManager anchor = delegate;
        final byte[] expected = pinned.getEncoded();
        X509TrustManager exact = new X509TrustManager() {
            public X509Certificate[] getAcceptedIssuers() { return new X509Certificate[]{pinned}; }
            public void checkClientTrusted(X509Certificate[] chain, String auth) throws CertificateException { throw new CertificateException("Not a client trust manager"); }
            public void checkServerTrusted(X509Certificate[] chain, String auth) throws CertificateException {
                if (chain == null || chain.length == 0 || !MessageDigest.isEqual(expected, chain[0].getEncoded()))
                    throw new CertificateException("ORION certificate changed");
                chain[0].checkValidity(); anchor.checkServerTrusted(chain, auth);
            }
        };
        SSLContext context = SSLContext.getInstance("TLS");
        context.init(null, new TrustManager[]{exact}, null);
        return context;
    }
    static boolean matches(SSLSession session, X509Certificate pinned) {
        try { return MessageDigest.isEqual(pinned.getEncoded(), session.getPeerCertificates()[0].getEncoded()); }
        catch (Exception error) { return false; }
    }
    static void pin(HttpsURLConnection connection, X509Certificate certificate) throws Exception {
        connection.setSSLSocketFactory(pinnedContext(certificate).getSocketFactory());
        connection.setHostnameVerifier((host, session) -> matches(session, certificate));
    }
    static String fingerprint(X509Certificate certificate) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(certificate.getEncoded());
        StringBuilder hex = new StringBuilder();
        for (byte value : digest) { if (hex.length() > 0) hex.append(':'); hex.append(String.format(Locale.ROOT, "%02X", value & 255)); }
        return hex.toString();
    }
    static String pairingCode(String clientNonce, String serverNonce, String fingerprint) throws Exception {
        String input = "orion-pair/v1|" + clientNonce + "|" + serverNonce + "|" + fingerprint.replace(":", "").toLowerCase(Locale.ROOT);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("orion-lan-pairing".getBytes(java.nio.charset.StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] digest = mac.doFinal(input.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        long number = ((digest[0] & 255L) << 24) | ((digest[1] & 255L) << 16) | ((digest[2] & 255L) << 8) | (digest[3] & 255L);
        return String.format(Locale.ROOT, "%06d", number % 1000000);
    }
    static boolean allowedApi(String method, String path) {
        if ("GET".equals(method) && path.equals("/workspaces/me")) return true;
        if ("POST".equals(method) && path.equals("/sync/devices")) return true;
        return ("GET".equals(method) && path.matches("/workspaces/[a-zA-Z0-9_-]+/sync/(mode|replica|replica/changes\\?cursor=[a-zA-Z0-9%._~-]*)"))
            || ("POST".equals(method) && path.matches("/workspaces/[a-zA-Z0-9_-]+/sync/ops"));
    }
}
