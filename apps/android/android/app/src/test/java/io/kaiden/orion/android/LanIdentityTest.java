package io.kaiden.orion.android;
import org.junit.Test;
import static org.junit.Assert.*;
public class LanIdentityTest {
    @Test public void requiresSavedIdentityAndSupportedProtocol() {
        assertTrue(LanIdentity.sameNode("known", "known", 1));
        assertFalse(LanIdentity.sameNode("known", "attacker", 1));
        assertFalse(LanIdentity.sameNode("known", "known", 2));
        assertFalse(LanIdentity.sameNode("", "", 1));
        assertFalse(LanIdentity.sameNode(null, "known", 1));
    }
}
