package com.thoughtstack.app

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.provider.Settings
import androidx.activity.enableEdgeToEdge
import java.io.File

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    try {
      val extDir = getExternalFilesDir(null)
      if (extDir != null) {
        File(filesDir, "external_files_dir.txt").writeText(extDir.absolutePath)
      }
    } catch (_: Exception) {}
    super.onCreate(savedInstanceState)
    requestAllFilesAccess()
  }

  override fun onResume() {
    super.onResume()
    // After user returns from the All Files Access settings screen, reload the webview
    // so the vault can be re-checked with the newly granted permission.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (Environment.isExternalStorageManager()) {
        // Permission granted — let the WebView know by dispatching a storage-ready event
        try {
          val webView = javaClass.superclass?.getDeclaredField("mWebView")
          webView?.isAccessible = true
        } catch (_: Exception) {}
      }
    }
  }

  private fun requestAllFilesAccess() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      if (!Environment.isExternalStorageManager()) {
        val intent = Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION)
        intent.data = Uri.parse("package:$packageName")
        startActivity(intent)
      }
    }
  }
}

