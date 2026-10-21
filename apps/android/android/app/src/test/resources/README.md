# Synthetic TLS fixtures

lan-host-test.p12 and lan-other-test.p12 contain throwaway RSA keys generated
only for JVM handshake tests, with password test-only and alias host.
They identify no real user, computer, service or release signing identity.
These src/test resources are not included in the application APK.
