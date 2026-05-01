# Nexus Android App

A native Android WebView wrapper for the Nexus web app.

## 📱 App Details
- **Package:** com.nexus.app
- **Min SDK:** Android 5.0 (API 21)
- **Target SDK:** Android 14 (API 34)
- **Theme:** Full-screen, dark status/nav bars (#313338)

## 🚀 How to Build the APK

### Option A — Android Studio (Easiest)
1. Download & install [Android Studio](https://developer.android.com/studio)
2. Open Android Studio → **File > Open** → select this `NexusApp` folder
3. Wait for Gradle sync to finish
4. Go to **Build > Build Bundle(s) / APK(s) > Build APK(s)**
5. APK will be at: `app/build/outputs/apk/debug/app-debug.apk`

### Option B — Command Line
```bash
# Install Android SDK command-line tools, then:
./gradlew assembleDebug
# Output: app/build/outputs/apk/debug/app-debug.apk
```

### Option C — GitHub Actions (No local setup)
Push this folder to a GitHub repo and use this workflow:

```yaml
name: Build APK
on: [push]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-java@v3
        with: { distribution: temurin, java-version: '17' }
      - uses: android-actions/setup-android@v2
      - run: ./gradlew assembleDebug
      - uses: actions/upload-artifact@v3
        with:
          name: nexus-debug.apk
          path: app/build/outputs/apk/debug/app-debug.apk
```

## 📁 Project Structure
```
NexusApp/
├── app/
│   ├── src/main/
│   │   ├── assets/
│   │   │   └── index.html          ← Your Nexus web app
│   │   ├── java/com/nexus/app/
│   │   │   └── MainActivity.java   ← WebView activity
│   │   ├── res/
│   │   │   ├── layout/activity_main.xml
│   │   │   ├── values/{strings,colors,themes}.xml
│   │   │   ├── xml/network_security_config.xml
│   │   │   └── mipmap-*/ic_launcher.png
│   │   └── AndroidManifest.xml
│   ├── build.gradle
│   └── proguard-rules.pro
├── build.gradle
├── settings.gradle
└── gradle/wrapper/gradle-wrapper.properties
```

## ✨ Features
- Full-screen WebView (no action bar)
- JavaScript & DOM storage enabled
- File upload support
- Camera & microphone permissions
- Back-button navigation support
- Hardware-accelerated rendering
- External links open in browser
