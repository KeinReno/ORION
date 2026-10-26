package io.kaiden.orion.android;

import java.net.InetAddress;
import java.net.Inet4Address;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;

/** Preserve all usable IPv4 routes; a VPN address may precede the LAN address. */
final class LanAddresses {
    static List<String> ipv4(List<InetAddress> addresses) {
        LinkedHashSet<String> result = new LinkedHashSet<>();
        for (InetAddress address : addresses) {
            if (address instanceof Inet4Address && !address.isAnyLocalAddress()
                    && !address.isLoopbackAddress() && !address.isMulticastAddress()) result.add(address.getHostAddress());
        }
        return new ArrayList<>(result);
    }
}
