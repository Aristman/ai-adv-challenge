package com.diaryai

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.diaryai.ui.navigation.App
import io.github.aakira.napier.DebugAntilog
import io.github.aakira.napier.Napier

private const val APP_TITLE = "DiaryAI"

fun main() {
    Napier.base(DebugAntilog())
    application {
        Window(
            onCloseRequest = ::exitApplication,
            title = APP_TITLE,
        ) {
            App()
        }
    }
}
