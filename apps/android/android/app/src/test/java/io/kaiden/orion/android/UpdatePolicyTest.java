package io.kaiden.orion.android;

import static org.junit.Assert.assertThrows;
import org.junit.Test;

public class UpdatePolicyTest {
    private static final String REPO = "KeinReno/ORION-Android-Releases";
    private static final String TAG = "v0.1.1-android-alpha.2";
    private static final String URL = "https://github.com/" + REPO + "/releases/download/" + TAG + "/KAIDEN-Orion-0.1.1-android-alpha.2.apk";
    @Test public void fixedReleaseSourceIsAccepted() throws Exception { UpdatePolicy.requireSource(REPO, TAG, URL); }
    @Test public void arbitrarySourcesAreRejected() {
        for (String source : new String[] {
            URL.replace("https:", "http:"), URL.replace("github.com", "github.com.evil.test"),
            URL.replace(REPO, "other/repository"), URL + "?token=secret", URL + "#fragment",
            URL.replace("https://", "https://user:pass@"), URL.replace(".apk", "-unsigned.apk"),
            URL.replace("/KAIDEN", "/../KAIDEN"), URL.replace("/KAIDEN", "/%2e%2e/KAIDEN"),
            URL.replace("github.com", "github.com:443")
        }) assertThrows(Exception.class, () -> UpdatePolicy.requireSource(REPO, TAG, source));
    }
    @Test public void updateRequiresNewerBuildAndMatchingIdentity() {
        UpdatePolicy.requireCompatible("app", 1, "app", 2, 2, "0.1.1", "0.1.1", new String[]{"key"}, new String[]{"key"});
        assertThrows(Exception.class, () -> UpdatePolicy.requireCompatible("app", 2, "app", 2, 2, "v", "v", new String[]{"key"}, new String[]{"key"}));
        assertThrows(Exception.class, () -> UpdatePolicy.requireCompatible("app", 3, "app", 2, 2, "v", "v", new String[]{"key"}, new String[]{"key"}));
        assertThrows(Exception.class, () -> UpdatePolicy.requireCompatible("app", 1, "other", 2, 2, "v", "v", new String[]{"key"}, new String[]{"key"}));
        assertThrows(Exception.class, () -> UpdatePolicy.requireCompatible("app", 1, "app", 3, 2, "v", "v", new String[]{"key"}, new String[]{"key"}));
    }
    @Test public void foreignEmptyOrExtraSignersAndWrongVersionNameAreRejected() {
        for (String[] signers : new String[][] { {}, {"foreign"}, {"key", "extra"} }) {
            assertThrows(Exception.class, () -> UpdatePolicy.requireCompatible("app", 1, "app", 2, 2, "v", "v", new String[]{"key"}, signers));
        }
        assertThrows(Exception.class, () -> UpdatePolicy.requireCompatible("app", 1, "app", 2, 2, "wrong", "v", new String[]{"key"}, new String[]{"key"}));
    }
}
