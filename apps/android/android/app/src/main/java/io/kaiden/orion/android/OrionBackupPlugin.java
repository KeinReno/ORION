package io.kaiden.orion.android;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import org.json.JSONObject;

@CapacitorPlugin(name = "OrionBackup")
public class OrionBackupPlugin extends Plugin {
    @PluginMethod
    public void exportBackup(PluginCall call) {
        File temporary = null;
        try {
            String value = call.getString("value");
            if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 24 * 1024 * 1024) throw new Exception();
            JSONObject backup = new JSONObject(value);
            if (!"kaiden-orion-android-backup".equals(backup.getString("format")) || backup.getInt("version") != 1) throw new Exception();
            String id = UUID.randomUUID().toString();
            temporary = new File(getContext().getCacheDir(), "backup-" + id + ".json");
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(value.getBytes(StandardCharsets.UTF_8));
                output.getFD().sync();
            }
            // Do not persist megabytes inside an Android activity saved-state Bundle.
            call.getData().remove("value");
            call.getData().put("exportId", id);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("application/json");
            intent.putExtra(Intent.EXTRA_TITLE, "KAIDEN-Orion-backup-" + new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.ROOT).format(new java.util.Date()) + ".json");
            startActivityForResult(call, intent, "backupCreated");
        } catch (Exception error) {
            if (temporary != null) temporary.delete();
            call.reject("Не удалось подготовить резервную копию. Освободите место и повторите.");
        }
    }
    @ActivityCallback
    private void backupCreated(PluginCall call, ActivityResult result) {
        if (call == null) return;
        String id = call.getString("exportId", "");
        if (!id.matches("[a-f0-9-]{36}")) { call.reject("Копия недоступна. Повторите экспорт."); return; }
        File temporary = new File(getContext().getCacheDir(), "backup-" + id + ".json");
        try {
            JSObject status = new JSObject();
            if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
                status.put("saved", false); call.resolve(status); return;
            }
            try (FileInputStream input = new FileInputStream(temporary);
                 OutputStream output = getContext().getContentResolver().openOutputStream(result.getData().getData(), "wt")) {
                if (output == null) throw new Exception();
                byte[] buffer = new byte[65536]; int count;
                while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                output.flush();
            }
            status.put("saved", true); call.resolve(status);
        } catch (Exception error) { call.reject("Резервная копия не записана полностью. Повторите экспорт."); }
        finally { temporary.delete(); }
    }
}
