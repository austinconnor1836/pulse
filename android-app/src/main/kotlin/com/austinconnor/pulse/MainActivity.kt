package com.austinconnor.pulse

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Scaffold
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import com.austinconnor.pulse.ui.FindSpotsScreen
import com.austinconnor.pulse.ui.HomeScreen
import com.austinconnor.pulse.ui.PlanDayScreen
import com.austinconnor.pulse.ui.theme.PulseTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PulseTheme {
                AppNav()
            }
        }
    }
}

@Composable
private fun AppNav() {
    val nav = rememberNavController()
    Scaffold(modifier = Modifier.fillMaxSize()) { padding ->
        NavHost(
            navController = nav,
            startDestination = "home",
            modifier = Modifier.padding(padding),
        ) {
            composable("home") {
                HomeScreen(
                    onFindSpots = { nav.navigate("find-spots") },
                    onPlanDay = { nav.navigate("plan-day") },
                )
            }
            composable("find-spots") { FindSpotsScreen() }
            composable("plan-day") { PlanDayScreen() }
        }
    }
}
