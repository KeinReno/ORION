package io.kaiden.orion.android;

import org.junit.Test;
import java.net.InetAddress;
import java.util.Arrays;
import static org.junit.Assert.assertEquals;

public class LanAddressesTest {
    @Test public void retainsLanAfterVpnAndDeduplicatesWithoutUnsafeRoutes() throws Exception {
        assertEquals(Arrays.asList("10.10.0.2", "192.168.1.9"), LanAddresses.ipv4(Arrays.asList(
            InetAddress.getByName("10.10.0.2"), InetAddress.getByName("192.168.1.9"),
            InetAddress.getByName("192.168.1.9"), InetAddress.getByName("127.0.0.1"),
            InetAddress.getByName("0.0.0.0"), InetAddress.getByName("224.0.0.1"),
            InetAddress.getByName("::1"), null)));
    }
}
