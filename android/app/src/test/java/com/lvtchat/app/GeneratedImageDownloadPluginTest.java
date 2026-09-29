package com.lvtchat.app;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class GeneratedImageDownloadPluginTest {

    @Test
    public void acceptsSupportedDocumentMimeTypesWithMatchingExtensions() {
        assertTrue(GeneratedImageDownloadPlugin.isAllowedMimeType("application/pdf"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("report.pdf", "application/pdf"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("matrix.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("slides.pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("bundle.zip", "application/zip"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("notes.md", "text/markdown"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("notes.txt", "text/plain"));
    }

    @Test
    public void preservesImageSupportAndRejectsMismatchedOrUnsupportedTypes() {
        assertTrue(GeneratedImageDownloadPlugin.isAllowedMimeType("image/webp"));
        assertTrue(GeneratedImageDownloadPlugin.hasSafeExtension("image.webp", "image/webp"));
        assertFalse(GeneratedImageDownloadPlugin.hasSafeExtension("image.pdf", "image/webp"));
        assertFalse(GeneratedImageDownloadPlugin.isAllowedMimeType("application/x-executable"));
    }
}
