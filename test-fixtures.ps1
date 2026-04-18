# E2E Test Fixtures — Setup / Teardown / Verify
# Usage:
#   .\test-fixtures.ps1 setup 3       # Apply fixture 3 only
#   .\test-fixtures.ps1 setup all     # Apply all fixtures
#   .\test-fixtures.ps1 teardown      # Remove all fixtures
#   .\test-fixtures.ps1 verify        # Verify fixtures produce expected errors

param(
    [Parameter(Position = 0)]
    [string]$Command = "help",

    [Parameter(Position = 1)]
    [string]$Arg = "all"
)

$ErrorActionPreference = "Stop"

# ── Fixture file paths ──
$FIXTURE_1 = "composeApp/src/commonMain/kotlin/com/diaryai/presentation/viewmodel/DiaryListViewModel.kt"
$FIXTURE_2 = "shared/src/commonTest/kotlin/com/diaryai/domain/usecase/GetDiaryEntriesUseCaseTest.kt"
$FIXTURE_3 = "composeApp/src/commonMain/kotlin/com/diaryai/presentation/viewmodel/EntryEditViewModel.kt"

# ── Backup suffix ──
$BAK_SUFFIX = ".fixture-bak"

# ═══════════════════════════════════════════════════════════════════════════
# FIXTURE CONTENT
# ═══════════════════════════════════════════════════════════════════════════

$FIXTURE_1_CONTENT = @'
package com.diaryai.presentation.viewmodel

import cafe.adriel.voyager.core.model.ScreenModel
import com.diaryai.domain.usecase.GetDiaryEntriesUseCase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// BUG SCENARIO 3: Missing import — DiaryEntry is used but not imported.

data class DiaryListUiState(
    val entries: List<DiaryEntry> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

sealed interface DiaryListEvent {
    data object LoadEntries : DiaryListEvent
    data class Delete(val id: String) : DiaryListEvent
}

class DiaryListViewModel(
    private val getEntries: GetDiaryEntriesUseCase,
) : ScreenModel {
    private val _state = MutableStateFlow(DiaryListUiState())
    val state: StateFlow<DiaryListUiState> = _state.asStateFlow()

    fun onEvent(event: DiaryListEvent) {
        when (event) {
            is DiaryListEvent.LoadEntries -> loadEntries()
            is DiaryListEvent.Delete -> { }
        }
    }

    private fun loadEntries() {
        _state.value = _state.value.copy(isLoading = true)
    }
}
'@

$FIXTURE_2_CONTENT = @'
package com.diaryai.domain.usecase

import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.model.Mood
import com.diaryai.domain.repository.DiaryEntryRepository
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GetDiaryEntriesUseCaseTest {

    // BUG SCENARIO 4: Mock returns 1 entry but test asserts size == 2.

    private val repo = object : DiaryEntryRepository {
        override suspend fun getEntries(): Result<List<DiaryEntry>> =
            Result.success(
                listOf(
                    DiaryEntry(id = "1", content = "Good day", date = 1000L, mood = Mood.GOOD),
                    // BUG: Second entry commented out — test expects 2 but mock returns 1
                    // DiaryEntry(id = "2", content = "Bad day", date = 2000L, mood = Mood.BAD),
                ),
            )

        override suspend fun getById(id: String): Result<DiaryEntry> =
            Result.failure(IllegalStateException("Not implemented"))
        override suspend fun saveEntry(entry: DiaryEntry): Result<Unit> =
            Result.success(Unit)
        override suspend fun deleteEntry(id: String): Result<Unit> =
            Result.success(Unit)
    }

    private val useCase = GetDiaryEntriesUseCase(repo)

    @Test
    fun `returns entries from repository`() = runTest {
        val result = useCase()
        assertTrue(result.isSuccess)
        assertEquals(2, result.getOrThrow().size)  // BUG: expects 2, mock returns 1
    }

    @Test
    fun `returns entries with correct content`() = runTest {
        val result = useCase()
        val entries = result.getOrThrow()
        assertEquals("Good day", entries.first().content)
    }
}
'@

$FIXTURE_3_CONTENT = @'
package com.diaryai.presentation.viewmodel

import cafe.adriel.voyager.core.model.ScreenModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

// BUG SCENARIO 5: Violates CLAUDE.md — public MutableStateFlow instead of private + asStateFlow.

data class EntryEditUiState(
    val content: String = "",
    val mood: MoodSelection? = null,
    val isSaving: Boolean = false,
)

sealed interface MoodSelection {
    data object Great : MoodSelection
    data object Good : MoodSelection
    data object Neutral : MoodSelection
    data object Bad : MoodSelection
    data object Awful : MoodSelection
}

class EntryEditViewModel : ScreenModel {

    // BUG: Should be private val _state
    val state: MutableStateFlow<EntryEditUiState> = MutableStateFlow(EntryEditUiState())

    val uiState: StateFlow<EntryEditUiState> = state.asStateFlow()

    fun onContentChanged(text: String) {
        state.value = state.value.copy(content = text)
    }

    fun onMoodSelected(mood: MoodSelection) {
        state.value = state.value.copy(mood = mood)
    }
}
'@

# ═══════════════════════════════════════════════════════════════════════════
# SETUP FUNCTIONS
# ═══════════════════════════════════════════════════════════════════════════

function Setup-Fixture3 {
    Write-Host "[Fixture 3] Compilation error — missing import" -ForegroundColor Yellow
    if (Test-Path $FIXTURE_1) {
        Write-Host "  Already exists: $FIXTURE_1"
    } else {
        $dir = Split-Path -Parent $FIXTURE_1
        if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Set-Content -Path $FIXTURE_1 -Value $FIXTURE_1_CONTENT -NoNewline -Encoding UTF8
        Write-Host "  Created: $FIXTURE_1"
    }
}

function Setup-Fixture4 {
    Write-Host "[Fixture 4] Failing test — wrong assertion" -ForegroundColor Yellow
    $dir = Split-Path -Parent $FIXTURE_2
    if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

    # Backup original test before overwriting
    $bakPath = "$FIXTURE_2$BAK_SUFFIX"
    if ((Test-Path $FIXTURE_2) -and !(Test-Path $bakPath)) {
        Copy-Item $FIXTURE_2 $bakPath
        Write-Host "  Backed up: $bakPath"
    }

    Set-Content -Path $FIXTURE_2 -Value $FIXTURE_2_CONTENT -NoNewline -Encoding UTF8
    Write-Host "  Overwritten: $FIXTURE_2"
}

function Setup-Fixture5 {
    Write-Host "[Fixture 5] CLAUDE.md violation — public MutableStateFlow" -ForegroundColor Yellow
    if (Test-Path $FIXTURE_3) {
        Write-Host "  Already exists: $FIXTURE_3"
    } else {
        $dir = Split-Path -Parent $FIXTURE_3
        if (!(Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
        Set-Content -Path $FIXTURE_3 -Value $FIXTURE_3_CONTENT -NoNewline -Encoding UTF8
        Write-Host "  Created: $FIXTURE_3"
    }
}

# ═══════════════════════════════════════════════════════════════════════════
# TEARDOWN
# ═══════════════════════════════════════════════════════════════════════════

function Invoke-Teardown {
    Write-Host "Removing all fixtures..." -ForegroundColor Yellow

    if (Test-Path $FIXTURE_1) {
        Remove-Item $FIXTURE_1 -Force
        Write-Host "  Removed: $FIXTURE_1"
    }

    # Restore original test from backup if exists
    $bakPath = "$FIXTURE_2$BAK_SUFFIX"
    if (Test-Path $bakPath) {
        Move-Item $bakPath $FIXTURE_2 -Force
        Write-Host "  Restored: $FIXTURE_2"
    }

    if (Test-Path $FIXTURE_3) {
        Remove-Item $FIXTURE_3 -Force
        Write-Host "  Removed: $FIXTURE_3"
    }

    Write-Host "Done." -ForegroundColor Green
}

# ═══════════════════════════════════════════════════════════════════════════
# VERIFY
# ═══════════════════════════════════════════════════════════════════════════

function Invoke-Verify {
    Write-Host ""
    Write-Host "═══ Verifying fixtures ═══"
    Write-Host ""

    # Check fixture 1
    Write-Host -NoNewline "Fixture 3 (compilation error): "
    if (Test-Path $FIXTURE_1) {
        $combined = cmd /c "gradlew.bat :composeApp:desktopMainClasses --no-daemon 2>&1" | Out-String
        if ($combined -match "Unresolved reference") {
            Write-Host "PASS" -ForegroundColor Green " — Unresolved reference found"
        } else {
            Write-Host "FAIL" -ForegroundColor Red " — Expected 'Unresolved reference' not found"
        }
    } else {
        Write-Host "SKIP" -ForegroundColor Yellow " — Fixture not applied"
    }

    # Check fixture 2
    Write-Host -NoNewline "Fixture 4 (failing test):     "
    $combined = cmd /c "gradlew.bat :shared:desktopTest --no-daemon 2>&1" | Out-String
    if ($combined -match "AssertionError.*entries from repository") {
        Write-Host "PASS" -ForegroundColor Green " — Test fails as expected"
    } elseif ($combined -match "FAIL") {
        Write-Host "PASS" -ForegroundColor Green " — Test fails (assertion)"
    } else {
        Write-Host "FAIL" -ForegroundColor Red " — Test did not fail"
    }

    # Check fixture 3
    Write-Host -NoNewline "Fixture 5 (CLAUDE.md violation): "
    if (Test-Path $FIXTURE_3) {
        $match = Select-String -Path $FIXTURE_3 -Pattern "val state: MutableStateFlow" -Quiet
        if ($match) {
            Write-Host "PASS" -ForegroundColor Green " — Public MutableStateFlow found"
        } else {
            Write-Host "FAIL" -ForegroundColor Red " — Expected violation not found"
        }
    } else {
        Write-Host "SKIP" -ForegroundColor Yellow " — Fixture not applied"
    }

    Write-Host ""
}

# ═══════════════════════════════════════════════════════════════════════════
# HELP
# ═══════════════════════════════════════════════════════════════════════════

function Show-Help {
    Write-Host "E2E Test Fixtures Manager"
    Write-Host ""
    Write-Host "Usage:"
    Write-Host "  .\test-fixtures.ps1 setup [3|4|5|all]  Apply fixture(s)"
    Write-Host "  .\test-fixtures.ps1 teardown             Remove all fixtures"
    Write-Host "  .\test-fixtures.ps1 verify               Verify fixtures produce expected errors"
    Write-Host ""
    Write-Host "Fixtures:"
    Write-Host "  3 — Compilation error (missing import)"
    Write-Host "  4 — Failing test (wrong assertion)"
    Write-Host "  5 — CLAUDE.md violation (public MutableStateFlow)"
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

switch ($Command) {
    "setup" {
        switch ($Arg) {
            "3" { Setup-Fixture3 }
            "4" { Setup-Fixture4 }
            "5" { Setup-Fixture5 }
            "all" {
                Setup-Fixture3
                Setup-Fixture4
                Setup-Fixture5
            }
            default {
                Write-Host "Usage: .\test-fixtures.ps1 setup [3|4|5|all]"
                exit 1
            }
        }
        Write-Host "Setup complete." -ForegroundColor Green
    }
    "teardown" {
        Invoke-Teardown
    }
    "verify" {
        Invoke-Verify
    }
    "help" {
        Show-Help
    }
    default {
        Show-Help
    }
}
