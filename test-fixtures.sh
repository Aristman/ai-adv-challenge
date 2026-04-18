#!/usr/bin/env bash
# E2E Test Fixtures — Setup / Teardown
# Usage:
#   bash test-fixtures.sh setup 3     # Apply fixture 3 only
#   bash test-fixtures.sh setup all   # Apply all fixtures
#   bash test-fixtures.sh teardown    # Remove all fixtures
#   bash test-fixtures.sh verify      # Verify fixtures produce expected errors

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Fixture file paths ──
FIXTURE_1="composeApp/src/commonMain/kotlin/com/diaryai/presentation/viewmodel/DiaryListViewModel.kt"
FIXTURE_2="shared/src/commonTest/kotlin/com/diaryai/domain/usecase/GetDiaryEntriesUseCaseTest.kt"
FIXTURE_3="composeApp/src/commonMain/kotlin/com/diaryai/presentation/viewmodel/EntryEditViewModel.kt"

# ── Backup suffix ──
BAK=".fixture-bak"

# ═══════════════════════════════════════════════════════════════════════════
# SETUP
# ═══════════════════════════════════════════════════════════════════════════

setup_fixture_3() {
    echo -e "${YELLOW}[Fixture 3] Compilation error — missing import${NC}"
    if [ -f "$FIXTURE_1" ]; then
        echo "  Already exists: $FIXTURE_1"
    else
        # No backup needed — file doesn't exist yet
        mkdir -p "$(dirname "$FIXTURE_1")"
        cat > "$FIXTURE_1" << 'EOF'
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
EOF
        echo "  Created: $FIXTURE_1"
    fi
}

setup_fixture_4() {
    echo -e "${YELLOW}[Fixture 4] Failing test — wrong assertion${NC}"
    mkdir -p "$(dirname "$FIXTURE_2")"
    # Backup original test before overwriting
    if [ -f "$FIXTURE_2" ] && [ ! -f "${FIXTURE_2}${BAK}" ]; then
        cp "$FIXTURE_2" "${FIXTURE_2}${BAK}"
        echo "  Backed up: ${FIXTURE_2}${BAK}"
    fi
    cat > "$FIXTURE_2" << 'EOF'
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
EOF
    echo "  Overwritten: $FIXTURE_2"
}

setup_fixture_5() {
    echo -e "${YELLOW}[Fixture 5] CLAUDE.md violation — public MutableStateFlow${NC}"
    if [ -f "$FIXTURE_3" ]; then
        echo "  Already exists: $FIXTURE_3"
    else
        # No backup needed — file doesn't exist yet
        mkdir -p "$(dirname "$FIXTURE_3")"
        cat > "$FIXTURE_3" << 'EOF'
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
EOF
        echo "  Created: $FIXTURE_3"
    fi
}

# ═══════════════════════════════════════════════════════════════════════════
# TEARDOWN
# ═══════════════════════════════════════════════════════════════════════════

teardown() {
    echo -e "${YELLOW}Removing all fixtures...${NC}"

    if [ -f "$FIXTURE_1" ]; then
        rm "$FIXTURE_1"
        echo "  Removed: $FIXTURE_1"
    fi

    # Restore original test from backup if exists
    if [ -f "${FIXTURE_2}${BAK}" ]; then
        mv "${FIXTURE_2}${BAK}" "$FIXTURE_2"
        echo "  Restored: $FIXTURE_2"
    fi

    if [ -f "$FIXTURE_3" ]; then
        rm "$FIXTURE_3"
        echo "  Removed: $FIXTURE_3"
    fi

    echo -e "${GREEN}Done.${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════
# VERIFY
# ═══════════════════════════════════════════════════════════════════════════

verify() {
    echo ""
    echo "═══ Verifying fixtures ═══"
    echo ""

    # Check fixture 1
    echo -n "Fixture 3 (compilation error): "
    if [ -f "$FIXTURE_1" ]; then
        OUTPUT=$(./gradlew :composeApp:desktopMainClasses --no-daemon 2>&1 || true)
        if echo "$OUTPUT" | grep -q "Unresolved reference.*DiaryEntry"; then
            echo -e "${GREEN}PASS${NC} — Unresolved reference found"
        else
            echo -e "${RED}FAIL${NC} — Expected 'Unresolved reference' not found"
        fi
    else
        echo -e "${YELLOW}SKIP${NC} — Fixture not applied"
    fi

    # Check fixture 2
    echo -n "Fixture 4 (failing test):     "
    OUTPUT=$(./gradlew :shared:desktopTest --no-daemon 2>&1 || true)
    if echo "$OUTPUT" | grep -q "AssertionError.*entries from repository"; then
        echo -e "${GREEN}PASS${NC} — Test fails as expected"
    elif echo "$OUTPUT" | grep -q "FAIL"; then
        echo -e "${GREEN}PASS${NC} — Test fails (assertion)"
    else
        echo -e "${RED}FAIL${NC} — Test did not fail"
    fi

    # Check fixture 3
    echo -n "Fixture 5 (CLAUDE.md violation): "
    if [ -f "$FIXTURE_3" ]; then
        if grep -q "val state: MutableStateFlow" "$FIXTURE_3"; then
            echo -e "${GREEN}PASS${NC} — Public MutableStateFlow found"
        else
            echo -e "${RED}FAIL${NC} — Expected violation not found"
        fi
    else
        echo -e "${YELLOW}SKIP${NC} — Fixture not applied"
    fi

    echo ""
}

# ═══════════════════════════════════════════════════════════════════════════
# MAIN
# ═══════════════════════════════════════════════════════════════════════════

case "${1:-help}" in
    setup)
        case "${2:-all}" in
            3) setup_fixture_3 ;;
            4) setup_fixture_4 ;;
            5) setup_fixture_5 ;;
            all)
                setup_fixture_3
                setup_fixture_4
                setup_fixture_5
                ;;
            *)
                echo "Usage: $0 setup [3|4|5|all]"
                exit 1
                ;;
        esac
        echo -e "${GREEN}Setup complete.${NC}"
        ;;
    teardown)
        teardown
        ;;
    verify)
        verify
        ;;
    help|*)
        echo "E2E Test Fixtures Manager"
        echo ""
        echo "Usage:"
        echo "  $0 setup [3|4|5|all]  Apply fixture(s)"
        echo "  $0 teardown             Remove all fixtures"
        echo "  $0 verify               Verify fixtures produce expected errors"
        echo ""
        echo "Fixtures:"
        echo "  3 — Compilation error (missing import)"
        echo "  4 — Failing test (wrong assertion)"
        echo "  5 — CLAUDE.md violation (public MutableStateFlow)"
        ;;
esac
