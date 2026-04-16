package com.diaryai.ui.navigation

import androidx.compose.runtime.Composable
import cafe.adriel.voyager.navigator.Navigator
import com.diaryai.ui.screen.SplashScreen
import com.diaryai.ui.theme.AppTheme

@Composable
fun App() {
    AppTheme {
        Navigator(SplashScreen)
    }
}
