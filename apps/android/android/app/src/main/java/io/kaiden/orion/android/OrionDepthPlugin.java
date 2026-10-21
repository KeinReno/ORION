package io.kaiden.orion.android;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.SystemClock;
import android.view.Surface;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "OrionDepth")
public class OrionDepthPlugin extends Plugin implements SensorEventListener {
    private SensorManager manager;
    private boolean active, calibrated;
    private double basePitch, baseRoll, x, y;
    private long last;
    private int lastRotation = -1;
    @PluginMethod public void start(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            stopSensor();
            manager = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
            Sensor sensor = manager == null ? null : manager.getDefaultSensor(Sensor.TYPE_GRAVITY);
            if (sensor == null && manager != null) sensor = manager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            try { if (sensor != null) active = manager.registerListener(this, sensor, 50000); } catch (Exception ignored) { active = false; }
            JSObject result = new JSObject(); result.put("available", active); call.resolve(result);
        });
    }
    @PluginMethod public void stop(PluginCall call) { getActivity().runOnUiThread(() -> { stopSensor(); call.resolve(); }); }
    private void stopSensor() {
        if (manager != null) manager.unregisterListener(this);
        active = false; calibrated = false; last = 0; lastRotation = -1; x = 0; y = 0;
    }
    @Override protected void handleOnPause() { stopSensor(); }
    @Override protected void handleOnDestroy() { stopSensor(); }
    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    @Override public void onSensorChanged(SensorEvent event) {
        long now = SystemClock.elapsedRealtime();
        if (!active || now - last < 50) return;
        last = now;
        double gx = event.values[0], gy = event.values[1], gz = event.values[2];
        if (!Double.isFinite(gx + gy + gz) || gx * gx + gy * gy + gz * gz < 1) return;
        int rotation = getActivity().getWindowManager().getDefaultDisplay().getRotation();
        if (rotation != lastRotation) { calibrated = false; lastRotation = rotation; }
        double originalX = gx;
        if (rotation == Surface.ROTATION_90) { gx = -gy; gy = originalX; }
        else if (rotation == Surface.ROTATION_180) { gx = -gx; gy = -gy; }
        else if (rotation == Surface.ROTATION_270) { gx = gy; gy = -originalX; }
        double pitch = Math.toDegrees(Math.atan2(gy, gz));
        double roll = Math.toDegrees(Math.atan2(gx, Math.sqrt(gy * gy + gz * gz)));
        if (!calibrated) { basePitch = pitch; baseRoll = roll; calibrated = true; }
        double nextX = x + (clamp(wrap(roll - baseRoll) / 22) - x) * .18;
        double nextY = y + (clamp(wrap(pitch - basePitch) / 22) - y) * .18;
        // Emit stationary samples too: the UI can distinguish a live sensor from silence.
        x = nextX; y = nextY;
        JSObject result = new JSObject(); result.put("x", x); result.put("y", y); notifyListeners("tilt", result);
    }
    private static double clamp(double value) { return Math.max(-1, Math.min(1, value)); }
    private static double wrap(double value) { return ((value + 540) % 360) - 180; }
}
