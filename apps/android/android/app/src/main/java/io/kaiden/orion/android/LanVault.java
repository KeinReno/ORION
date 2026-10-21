package io.kaiden.orion.android;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONObject;

final class LanVault {
    private static final String ALIAS = "orion-lan-v1";
    private final Context context;
    LanVault(Context context) { this.context = context; }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return ((KeyStore.SecretKeyEntry) store.getEntry(ALIAS, null)).getSecretKey();
    }
    JSONObject read() throws Exception {
        String raw = context.getSharedPreferences("orion-lan-vault", 0).getString("binding", null);
        if (raw == null) return null;
        JSONObject saved = new JSONObject(raw);
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Base64.decode(saved.getString("iv"), Base64.NO_WRAP)));
        return new JSONObject(new String(cipher.doFinal(Base64.decode(saved.getString("value"), Base64.NO_WRAP)), StandardCharsets.UTF_8));
    }
    void save(JSONObject value) throws Exception {
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        JSONObject encrypted = new JSONObject();
        encrypted.put("iv", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP));
        encrypted.put("value", Base64.encodeToString(cipher.doFinal(value.toString().getBytes(StandardCharsets.UTF_8)), Base64.NO_WRAP));
        if (!context.getSharedPreferences("orion-lan-vault", 0).edit().putString("binding", encrypted.toString()).commit())
            throw new Exception("Vault commit failed");
    }
    void clear() throws Exception {
        if (!context.getSharedPreferences("orion-lan-vault", 0).edit().clear().commit()) throw new Exception("Vault clear failed");
    }
}
