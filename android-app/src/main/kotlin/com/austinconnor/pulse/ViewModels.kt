package com.austinconnor.pulse

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.CreationExtras
import com.austinconnor.pulse.shared.ApiClient
import com.austinconnor.pulse.shared.Defaults
import com.austinconnor.pulse.shared.FindSpotsRequest
import com.austinconnor.pulse.shared.OptimizationTarget
import com.austinconnor.pulse.shared.PlanDayRequest
import com.austinconnor.pulse.shared.PlanDayResponse
import com.austinconnor.pulse.shared.ScoredSpot
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

private fun apiClient(): ApiClient = ApiClient(
    supabaseUrl = BuildConfig.SUPABASE_URL,
    supabaseAnonKey = BuildConfig.SUPABASE_ANON_KEY,
)

data class FindSpotsUiState(
    val loading: Boolean = false,
    val spots: List<ScoredSpot> = emptyList(),
    val error: String? = null,
)

class FindSpotsViewModel : ViewModel() {
    private val api = apiClient()
    private val _state = MutableStateFlow(FindSpotsUiState())
    val state: StateFlow<FindSpotsUiState> = _state.asStateFlow()

    fun search(purpose: String) {
        if (purpose.isBlank()) return
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                api.findSpots(
                    FindSpotsRequest(purpose = purpose.trim(), location = Defaults.PENN_STATION)
                )
            }.onSuccess { res ->
                _state.update { it.copy(loading = false, spots = res.spots) }
            }.onFailure { e ->
                _state.update { it.copy(loading = false, error = e.message) }
            }
        }
    }
}

data class PlanDayUiState(
    val dateISO: String = Clock.System.now().toLocalDateTime(TimeZone.currentSystemDefault()).date.toString(),
    val target: OptimizationTarget = OptimizationTarget.BALANCED,
    val loading: Boolean = false,
    val plan: PlanDayResponse? = null,
    val error: String? = null,
)

class PlanDayViewModel : ViewModel() {
    private val api = apiClient()
    private val _state = MutableStateFlow(PlanDayUiState())
    val state: StateFlow<PlanDayUiState> = _state.asStateFlow()

    fun setDate(dateISO: String) = _state.update { it.copy(dateISO = dateISO) }
    fun setTarget(target: OptimizationTarget) = _state.update { it.copy(target = target) }

    fun plan() {
        _state.update { it.copy(loading = true, error = null) }
        viewModelScope.launch {
            runCatching {
                api.planDay(
                    PlanDayRequest(
                        dateISO = _state.value.dateISO,
                        anchorLocation = Defaults.PENN_STATION,
                        optimizeFor = _state.value.target,
                    )
                )
            }.onSuccess { res ->
                _state.update { it.copy(loading = false, plan = res) }
            }.onFailure { e ->
                _state.update { it.copy(loading = false, error = e.message) }
            }
        }
    }
}

object AppViewModelFactory : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>, extras: CreationExtras): T {
        @Suppress("UNCHECKED_CAST")
        return when (modelClass) {
            FindSpotsViewModel::class.java -> FindSpotsViewModel() as T
            PlanDayViewModel::class.java -> PlanDayViewModel() as T
            else -> error("Unknown ViewModel: $modelClass")
        }
    }
}
