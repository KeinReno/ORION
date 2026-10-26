package io.kaiden.orion.android;

import android.content.ContentValues;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/** One durable transaction contains content, drafts, device sequence and outbox.
 * No arbitrary SQL, database paths or network capability is exposed to JS. */
@CapacitorPlugin(name = "OrionStorage")
public class OrionStoragePlugin extends Plugin {
    private SQLiteOpenHelper helper;

    @Override
    public void load() {
        helper = new SQLiteOpenHelper(getContext(), "orion-local.db", null, 2) {
            @Override
            public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE snapshot (id INTEGER PRIMARY KEY CHECK(id = 1), value TEXT NOT NULL)");
                db.execSQL("CREATE TABLE replicas (scope TEXT PRIMARY KEY, value TEXT NOT NULL)");
            }
            @Override
            public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
                if (oldVersion == 1 && newVersion == 2) {
                    db.execSQL("CREATE TABLE replicas (scope TEXT PRIMARY KEY, value TEXT NOT NULL)");
                } else throw new IllegalStateException("A verified migration is required");
            }
        };
    }

    @PluginMethod
    public void read(PluginCall call) {
        try {
            SQLiteDatabase db = helper.getReadableDatabase();
            JSObject result = new JSObject();
            // Read in chunks: a full snapshot can exceed Android's CursorWindow.
            db.beginTransaction();
            try {
                int length = -1;
                try (Cursor cursor = db.rawQuery("SELECT length(value) FROM snapshot WHERE id = 1", null)) {
                    if (cursor.moveToFirst()) length = cursor.getInt(0);
                }
                if (length < 0) {
                    result.put("value", JSONObject.NULL);
                } else {
                    StringBuilder value = new StringBuilder();
                    for (int start = 1; start <= length; start += 131072) {
                        try (Cursor cursor = db.rawQuery("SELECT substr(value, ?, 131072) FROM snapshot WHERE id = 1", new String[] { String.valueOf(start) })) {
                            if (!cursor.moveToFirst()) throw new IllegalStateException("Snapshot disappeared");
                            value.append(cursor.getString(0));
                        }
                    }
                    result.put("value", value.toString());
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Не удалось прочитать локальные данные", error);
        }
    }

    @PluginMethod
    public void write(PluginCall call) {
        String value = call.getString("value");
        if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 8 * 1024 * 1024) {
            call.reject("Превышен размер локального хранилища alpha");
            return;
        }
        try {
            JSONObject snapshot = new JSONObject(value);
            if (snapshot.getInt("version") != 1) {
                call.reject("Неизвестная версия локального хранилища");
                return;
            }
            SQLiteDatabase db = helper.getWritableDatabase();
            db.beginTransaction();
            try {
                ContentValues values = new ContentValues();
                values.put("id", 1);
                values.put("value", value);
                if (db.insertWithOnConflict("snapshot", null, values, SQLiteDatabase.CONFLICT_REPLACE) == -1) {
                    throw new IllegalStateException("Snapshot commit failed");
                }
                db.setTransactionSuccessful();
            } finally {
                db.endTransaction();
            }
            call.resolve();
        } catch (Exception error) {
            call.reject("Не удалось сохранить на телефоне. Освободите место и повторите.", error);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (helper != null) helper.close();
    }

    private String scope(PluginCall call) {
        String scope = call.getString("scope", "");
        if (!scope.matches("[a-f0-9]{64}")) throw new IllegalArgumentException("Invalid replica scope");
        return scope;
    }
    @PluginMethod
    public void readReplica(PluginCall call) {
        try {
            String key = scope(call);
            SQLiteDatabase db = helper.getReadableDatabase();
            JSObject result = new JSObject();
            db.beginTransaction();
            try {
                int length = -1;
                try (Cursor cursor = db.rawQuery("SELECT length(value) FROM replicas WHERE scope = ?", new String[]{key})) {
                    if (cursor.moveToFirst()) length = cursor.getInt(0);
                }
                if (length < 0) result.put("value", JSONObject.NULL);
                else {
                    StringBuilder value = new StringBuilder();
                    for (int start = 1; start <= length; start += 131072) {
                        try (Cursor cursor = db.rawQuery("SELECT substr(value, ?, 131072) FROM replicas WHERE scope = ?", new String[]{String.valueOf(start), key})) {
                            if (!cursor.moveToFirst()) throw new Exception();
                            value.append(cursor.getString(0));
                        }
                    }
                    result.put("value", value.toString());
                }
                db.setTransactionSuccessful();
            } finally { db.endTransaction(); }
            call.resolve(result);
        } catch (Exception error) { call.reject("Не удалось прочитать локальную копию пространства"); }
    }
    @PluginMethod
    public void writeReplica(PluginCall call) {
        try {
            String key = scope(call);
            String value = call.getString("value");
            if (value == null || value.getBytes(StandardCharsets.UTF_8).length > 16 * 1024 * 1024) throw new Exception();
            new JSONObject(value);
            ContentValues row = new ContentValues(); row.put("scope", key); row.put("value", value);
            if (helper.getWritableDatabase().insertWithOnConflict("replicas", null, row, SQLiteDatabase.CONFLICT_REPLACE) == -1) throw new Exception();
            call.resolve();
        } catch (Exception error) { call.reject("Не удалось сохранить локальную копию. Освободите место и повторите."); }
    }
    @PluginMethod
    public void clearReplica(PluginCall call) {
        try { helper.getWritableDatabase().delete("replicas", "scope = ?", new String[]{scope(call)}); call.resolve(); }
        catch (Exception error) { call.reject("Не удалось удалить локальную копию"); }
    }
    @PluginMethod
    public void clearAllReplicas(PluginCall call) {
        try { helper.getWritableDatabase().delete("replicas", null, null); call.resolve(); }
        catch (Exception error) { call.reject("Не удалось удалить копии компьютера"); }
    }
}
