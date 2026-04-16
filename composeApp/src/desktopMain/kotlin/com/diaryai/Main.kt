package com.diaryai

import androidx.compose.runtime.remember
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import com.diaryai.ui.navigation.App

fun main() = application {
    Window(
        onCloseRequest = ::exitApplication,
        title = "DiaryAI",
    ) {
        App()
    }
}
