package io.kaiden.orion.android;

import android.animation.ValueAnimator;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Reads the platform animation preference; no permission or settings mutation. */
@CapacitorPlugin(name = "OrionMotion")
public class OrionMotionPlugin extends Plugin {
    @PluginMethod
    public void getState(PluginCall call) {
        boolean reduced = true;
        try {
            reduced = Build.VERSION.SDK_INT >= 26 ? !ValueAnimator.areAnimatorsEnabled()
                : Settings.Global.getFloat(getContext().getContentResolver(), Settings.Global.ANIMATOR_DURATION_SCALE, 1f) <= 0;
            reduced = reduced || Settings.Global.getFloat(getContext().getContentResolver(), Settings.Global.TRANSITION_ANIMATION_SCALE, 1f) <= 0;
        } catch (Exception ignored) { reduced = true; }
        JSObject result = new JSObject(); result.put("reduced", reduced); call.resolve(result);
    }
}
