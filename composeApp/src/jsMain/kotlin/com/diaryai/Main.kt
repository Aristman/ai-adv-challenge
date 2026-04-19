package com.diaryai

import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.window.CanvasBasedWindow
import com.diaryai.ui.navigation.App
import io.github.aakira.napier.DebugAntilog
import io.github.aakira.napier.Napier

private const val CANVAS_ELEMENT_ID = "ComposeTarget"

@OptIn(ExperimentalComposeUiApi::class)
fun main() {
    Napier.base(DebugAntilog())
    CanvasBasedWindow(canvasElementId = CANVAS_ELEMENT_ID) {
        App()
    }
}
