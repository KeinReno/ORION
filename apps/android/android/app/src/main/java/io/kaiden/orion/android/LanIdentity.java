package io.kaiden.orion.android;
final class LanIdentity {
    private LanIdentity() {}
    static boolean sameNode(String savedId, String observedId, int protocol) {
        return protocol == 1 && savedId != null && !savedId.isEmpty() && savedId.equals(observedId);
    }
}
