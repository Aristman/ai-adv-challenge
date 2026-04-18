package com.diaryai

import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.diaryai.ui.navigation.App

private const val APP_TITLE = "DiaryAI"

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = APP_TITLE,
    ) {
        App()
    }
}
