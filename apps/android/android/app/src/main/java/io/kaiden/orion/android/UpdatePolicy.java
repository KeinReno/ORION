package io.kaiden.orion.android;

import java.net.URI;
import java.util.Arrays;

/** Pure policy kept independent of Android so rejection paths run on the JVM. */
final class UpdatePolicy {
    private UpdatePolicy() {}
    static void requireSource(String repository, String tag, String source) throws Exception {
        URI uri = new URI(source);
        String prefix = "/" + repository + "/releases/download/" + tag + "/";
        String path = uri.getPath();
        String file = path != null && path.startsWith(prefix) ? path.substring(prefix.length()) : "";
        if (!tag.matches("v[0-9]+\\.[0-9]+\\.[0-9]+-android-alpha\\.[0-9]+")
            || !"https".equals(uri.getScheme()) || !"github.com".equals(uri.getHost()) || uri.getPort() != -1
            || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
            || !file.matches("KAIDEN-Orion-[a-zA-Z0-9_.-]+\\.apk") || file.endsWith("-unsigned.apk")
            || uri.getRawPath().contains("%")) throw new IllegalArgumentException("Invalid APK source");
    }
    static void requireCompatible(String installedId, long installedCode, String archiveId, long archiveCode,
        long expectedCode, String archiveName, String expectedName, String[] installedSigners, String[] archiveSigners) {
        if (!installedId.equals(archiveId) || archiveCode <= installedCode || archiveCode != expectedCode
            || !expectedName.equals(archiveName) || installedSigners.length == 0
            || !Arrays.equals(installedSigners, archiveSigners)) throw new IllegalArgumentException("Incompatible APK");
    }
}
