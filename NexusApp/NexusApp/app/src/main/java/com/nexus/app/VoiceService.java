package com.nexus.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

/**
 * VoiceService – keeps the app's microphone session alive when the user
 * backgrounds the app while in a voice channel.
 *
 * Started by MainActivity via the NexusBridge JS interface.
 * Shows a persistent notification so Android won't kill the process.
 */
public class VoiceService extends Service {

    public static final String ACTION_START   = "com.nexus.app.START_VOICE";
    public static final String ACTION_STOP    = "com.nexus.app.STOP_VOICE";
    public static final String EXTRA_CHANNEL  = "channel_name";

    private static final String CHANNEL_ID    = "nexus_voice";
    private static final int    NOTIF_ID      = 1;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) return START_NOT_STICKY;

        String action = intent.getAction();

        if (ACTION_START.equals(action)) {
            String channelName = intent.getStringExtra(EXTRA_CHANNEL);
            if (channelName == null) channelName = "Voice Channel";
            startForegroundWithNotification(channelName);
        } else if (ACTION_STOP.equals(action)) {
            stopForeground(true);
            stopSelf();
        }

        return START_NOT_STICKY;
    }

    private void startForegroundWithNotification(String channelName) {
        createNotificationChannel();

        // Tapping the notification reopens the app
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            flags |= PendingIntent.FLAG_IMMUTABLE;
        }
        PendingIntent pendingIntent = PendingIntent.getActivity(this, 0, openApp, flags);

        Notification.Builder builder;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            builder = new Notification.Builder(this, CHANNEL_ID);
        } else {
            builder = new Notification.Builder(this);
        }

        Notification notification = builder
                .setContentTitle("Nexus – Voice Connected")
                .setContentText("🔊 " + channelName)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .build();

        startForeground(NOTIF_ID, notification);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Voice Session",
                    NotificationManager.IMPORTANCE_LOW   // silent, no sound
            );
            channel.setDescription("Keeps Nexus voice active in background");
            channel.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(channel);
        }
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}