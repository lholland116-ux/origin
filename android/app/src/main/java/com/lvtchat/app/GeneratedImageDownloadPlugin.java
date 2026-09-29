package com.lvtchat.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "GeneratedImageDownload")
public class GeneratedImageDownloadPlugin extends Plugin {

    private static final String[] ALLOWED_MIME_TYPES = {
        "image/webp",
        "image/png",
        "image/jpeg",
        "text/plain",
        "text/markdown",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/zip"
    };

    @PluginMethod
    public void save(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Saving downloads requires Android 10 or newer.");
            return;
        }

        String base64 = call.getString("base64");
        String fileName = sanitizeFileName(call.getString("fileName"));
        String mimeType = call.getString("mimeType");

        if (base64 == null || base64.isEmpty() || fileName == null || !isAllowedMimeType(mimeType) || !hasSafeExtension(fileName, mimeType)) {
            call.reject("The file could not be saved safely.");
            return;
        }

        final byte[] imageBytes;
        try {
            imageBytes = Base64.decode(base64.getBytes(StandardCharsets.US_ASCII), Base64.DEFAULT);
        } catch (IllegalArgumentException error) {
            call.reject("The file could not be saved safely.");
            return;
        }

        if (imageBytes.length == 0) {
            call.reject("The file could not be saved safely.");
            return;
        }

        ContentResolver resolver = getContext().getContentResolver();
        Uri itemUri = null;

        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.IS_PENDING, 1);

            itemUri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (itemUri == null) {
                throw new IllegalStateException("Download destination unavailable.");
            }

            try (OutputStream output = resolver.openOutputStream(itemUri)) {
                if (output == null) {
                    throw new IllegalStateException("Download destination unavailable.");
                }
                output.write(imageBytes);
                output.flush();
            }

            ContentValues completed = new ContentValues();
            completed.put(MediaStore.Downloads.IS_PENDING, 0);
            if (resolver.update(itemUri, completed, null, null) != 1) {
                throw new IllegalStateException("Download could not be finalized.");
            }

            JSObject result = new JSObject();
            result.put("uri", itemUri.toString());
            call.resolve(result);
        } catch (Exception error) {
            if (itemUri != null) {
                resolver.delete(itemUri, null, null);
            }
            call.reject("Could not save the file. Please try again.");
        }
    }

    static boolean isAllowedMimeType(String mimeType) {
        if (mimeType == null) {
            return false;
        }

        for (String allowedMimeType : ALLOWED_MIME_TYPES) {
            if (allowedMimeType.equals(mimeType)) {
                return true;
            }
        }

        return false;
    }

    static boolean hasSafeExtension(String fileName, String mimeType) {
        String lowerName = fileName.toLowerCase(java.util.Locale.ROOT);
        if (mimeType == null) return false;
        if (mimeType.equals("image/webp")) return lowerName.endsWith(".webp");
        if (mimeType.equals("image/png")) return lowerName.endsWith(".png");
        if (mimeType.equals("image/jpeg")) return lowerName.endsWith(".jpg") || lowerName.endsWith(".jpeg");
        if (mimeType.equals("text/plain")) return lowerName.endsWith(".txt");
        if (mimeType.equals("text/markdown")) return lowerName.endsWith(".md");
        if (mimeType.equals("application/vnd.openxmlformats-officedocument.wordprocessingml.document")) return lowerName.endsWith(".docx");
        if (mimeType.equals("application/pdf")) return lowerName.endsWith(".pdf");
        if (mimeType.equals("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")) return lowerName.endsWith(".xlsx");
        if (mimeType.equals("application/vnd.openxmlformats-officedocument.presentationml.presentation")) return lowerName.endsWith(".pptx");
        if (mimeType.equals("application/zip")) return lowerName.endsWith(".zip");
        return false;
    }

    static String sanitizeFileName(String fileName) {
        if (fileName == null || fileName.isEmpty()) {
            return null;
        }

        String safeName = fileName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (safeName.length() > 120) {
            safeName = safeName.substring(0, 120);
        }

        return safeName.isEmpty() ? null : safeName;
    }
}
