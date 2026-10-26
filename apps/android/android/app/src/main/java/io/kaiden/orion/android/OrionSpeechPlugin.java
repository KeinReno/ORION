package io.kaiden.orion.android;

import android.app.Activity;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.SharedPreferences;
import android.speech.RecognizerIntent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.UUID;

/** Delegates microphone ownership and UI to the installed Android speech activity. */
@CapacitorPlugin(name = "OrionSpeech")
public class OrionSpeechPlugin extends Plugin {
    private boolean running;
    private SharedPreferences pending() { return getContext().getSharedPreferences("orion-speech-pending", 0); }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSObject result = new JSObject();
        result.put("id", pending().getString("id", ""));
        result.put("text", pending().getString("text", ""));
        result.put("durable", true);
        call.resolve(result);
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        if (pending().getString("id", "").equals(call.getString("id", "")) && !pending().edit().clear().commit()) {
            call.reject("Не удалось завершить обработку диктовки. Повторите действие."); return;
        }
        call.resolve();
    }

    @PluginMethod
    public void recognize(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (running) { call.reject("Диктовка уже открыта."); return; }
            if (!pending().getString("id", "").isEmpty()) { call.reject("Сначала добавьте или отмените предыдущую диктовку."); return; }
            Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
            intent.putExtra(RecognizerIntent.EXTRA_LANGUAGE, "ru-RU");
            intent.putExtra(RecognizerIntent.EXTRA_PROMPT, "Надиктуйте текст для Orion");
            intent.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
            intent.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false);
            // Best effort only; the chosen system provider may ignore this hint.
            intent.putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true);
            try { running = true; startActivityForResult(call, intent, "recognized"); }
            catch (ActivityNotFoundException error) { running = false; call.reject("На телефоне нет сервиса диктовки. Установите или включите системное распознавание речи; текстовый ввод доступен."); }
            catch (Exception error) { running = false; call.reject("Не удалось открыть системную диктовку. Повторите попытку или введите текст."); }
        });
    }

    @ActivityCallback
    private void recognized(PluginCall call, ActivityResult result) {
        running = false;
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK) { response.put("cancelled", true); if (call != null) call.resolve(response); return; }
        Intent data = result.getData();
        ArrayList<String> alternatives = data == null ? null : data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
        String text = alternatives == null || alternatives.isEmpty() ? "" : alternatives.get(0);
        if (text == null || text.trim().isEmpty()) { if (call != null) call.reject("Речь не распознана. Повторите диктовку или введите текст."); return; }
        if (text.length() > 50000) { if (call != null) call.reject("Результат слишком длинный. Надиктуйте более короткую фразу."); return; }
        String id = UUID.randomUUID().toString();
        boolean durable = pending().edit().putString("id", id).putString("text", text.trim()).commit();
        response.put("id", id); response.put("text", text.trim()); response.put("durable", durable);
        if (call != null) call.resolve(response);
    }
}
