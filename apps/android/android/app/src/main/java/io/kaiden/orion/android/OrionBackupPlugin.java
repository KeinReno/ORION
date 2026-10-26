package io.kaiden.orion.android;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
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

    private static final int MAX_BACKUP_BYTES = 24 * 1024 * 1024;

    @PluginMethod
    public void importBackup(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[] { "application/json", "text/plain", "application/octet-stream" });
            startActivityForResult(call, intent, "backupSelected");
        } catch (Exception error) {
            call.reject("Не удалось открыть выбор файла. Повторите.");
        }
    }

    @ActivityCallback
    private void backupSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject status = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            status.put("cancelled", true);
            call.resolve(status);
            return;
        }
        try (InputStream input = getContext().getContentResolver().openInputStream(result.getData().getData())) {
            if (input == null) throw new Exception();
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[65536];
            int count; int total = 0;
            while ((count = input.read(buffer)) != -1) {
                total += count;
                if (total > MAX_BACKUP_BYTES) throw new Exception();
                bytes.write(buffer, 0, count);
            }
            String value = new String(bytes.toByteArray(), StandardCharsets.UTF_8);
            JSONObject backup = new JSONObject(value);
            if (!"kaiden-orion-android-backup".equals(backup.optString("format")) || backup.optInt("version") != 1) throw new Exception();
            String name = null;
            // The display name is cosmetic: a provider that refuses the query must not reject a valid backup.
            try (Cursor cursor = getContext().getContentResolver().query(result.getData().getData(), new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) name = cursor.getString(0);
            } catch (Exception ignored) { name = null; }
            status.put("cancelled", false);
            status.put("value", value);
            status.put("name", name == null ? JSONObject.NULL : name);
            call.resolve(status);
        } catch (Exception error) {
            call.reject("Файл не похож на резервную копию Orion или больше 24 МБ.");
        }
    }
}
