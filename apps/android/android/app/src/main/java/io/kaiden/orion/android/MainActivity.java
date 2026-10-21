package io.kaiden.orion.android;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OrionStoragePlugin.class);
        registerPlugin(OrionUpdatesPlugin.class);
        registerPlugin(OrionBackupPlugin.class);
        registerPlugin(OrionLanPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
