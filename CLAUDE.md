# DiaryAI — Project CLAUDE.md

Мультиплатформенное приложение (Android, Web, Desktop) для ведения ежедневника с ИИ обогащением записей и генерацией картинок.

## Stack

Kotlin 2.1+, Compose Multiplatform, Koin 4.x, Ktor 3.x, kotlinx.serialization, SQLDelight 2.x, Voyager, Kamel/Coil 3, Kotlin Test + MockK + Turbine. Build: Gradle Kotlin DSL + version catalog.

## Architecture: Clean + MVI + TDD

```
shared/src/commonMain/kotlin/
  domain/            ← Чистый Kotlin, ZERO framework deps
    model/             Domain models (data class, sealed)
    repository/        Interfaces только
    usecase/           Single-responsibility use cases
  data/
    remote/api + dto/  Ktor API, @Serializable DTOs
    local/dao + db/    SQLDelight, expect/actual
    repository/        Implementations
    mapper/            DTO ↔ Domain
  presentation/
    viewmodel/         MVI: StateFlow<UiState> + Channel<Effect>
    contract/          UiState + Event + Effect sealed classes
  di/                  Koin modules
  core/                Result wrapper, extensions, datetime expect/actual

composeApp/src/commonMain/kotlin/ui/
  screen/  component/  theme/  navigation/
```

**Layer rules:** `domain` → zero framework deps. `data` → depends on `domain` only, DTOs never leak out. `presentation` → gets UseCases, never Repositories. `ui` → stateless Composables + state from ViewModel. Flow: `ui → presentation → domain ← data`.

## Naming

Packages: `lowercase` → `domain.model`. Classes: `PascalCase`. Functions/props: `camelCase`. Constants: `SCREAMING_SNAKE_CASE`. Backing props: `_` prefix.

| Сущность                  | Шаблон                             | Пример                        |
|---------------------------|------------------------------------|-------------------------------|
| Model                     | Существительное                    | `DiaryEntry`, `Mood`          |
| Repository interface/impl | `[Entity]Repository[Impl]`         | `DiaryEntryRepositoryImpl`    |
| Use case                  | `[Verb][Entity]UseCase`            | `GetDiaryEntriesUseCase`      |
| ViewModel                 | `[Screen]ViewModel`                | `DiaryListViewModel`          |
| MVI contract              | `[Screen]UiState / Event / Effect` | `DiaryListUiState`            |
| DTO                       | `[Entity]Dto`                      | `DiaryEntryDto`               |
| Mapper                    | `[From]To[To]Mapper`               | `DiaryEntryDtoToDomainMapper` |
| Test                      | `[Class]Test`                      | `GetDiaryEntriesUseCaseTest`  |

## Patterns

**Repository** — interface in domain, impl in data:
```kotlin
interface DiaryEntryRepository {
    suspend fun getEntries(range: DateRange): Result<List<DiaryEntry>>
}
```

**Use Case** — one class, one `invoke`, pure business logic:
```kotlin
class EnrichEntryWithAiUseCase(
    private val repo: DiaryEntryRepository,
    private val ai: AiService,
) {
    suspend operator fun invoke(entryId: String): Result<DiaryEntry> = runCatching {
        val entry = repo.getById(entryId).getOrThrow()
        val enriched = ai.enrichText(entry.content).getOrThrow()
        repo.saveEntry(entry.copy(aiSummary = enriched.summary, tags = enriched.tags)).getOrThrow()
    }
}
```

**MVI** — immutable UiState, sealed Event/Effect, reducer via `update`:
```kotlin
data class DiaryListUiState(val entries: List<DiaryEntry> = emptyList(), val isLoading: Boolean = false)
sealed interface DiaryListEvent { data object LoadEntries; data class Delete(val id: String) }
sealed interface DiaryListEffect { data class ShowError(val msg: String) }
```

**expect/actual** — platform-specific через mechanism, не через if/else по platform.

**Result wrapper** — все repo/usecase возвращают `Result<T>`, не бросают exceptions.
**StateFlow** — expose `StateFlow<UiState>`, never `MutableStateFlow` in public API.

## Good Code

**ViewModel** — MVI with reduce + effect channel:
```kotlin
class EntryEditViewModel(private val save: SaveEntryUseCase, private val genImage: GenerateImageUseCase) : ScreenModel {
    private val _state = MutableStateFlow(EntryEditUiState())
    val state: StateFlow<EntryEditUiState> = _state.asStateFlow()
    private val _effect = Channel<EntryEditEffect>()
    val effect: Flow<EntryEditEffect> = _effect.receiveAsFlow()

    fun onEvent(event: EntryEditEvent) = when (event) {
        is EntryEditEvent.ContentChanged -> _state.update { copy(content = event.text) }
        is EntryEditEvent.Save -> screenModelScope.launch { ... }
    }
}
```

**Compose Screen** — stateless, state hoisting:
```kotlin
@Composable
fun DiaryListScreen(state: DiaryListUiState, onEvent: (DiaryListEvent) -> Unit, modifier: Modifier = Modifier) {
    when { state.isLoading -> CircularProgressIndicator(); state.error != null -> ErrorMessage(state.error); else -> DiaryListContent(state.entries, onEvent) }
}
```

**Test** — Arrange-Act-Assert, Kotlin Test + MockK:
```kotlin
class EnrichEntryWithAiUseCaseTest {
    private val repo = mockk<DiaryEntryRepository>()
    private val ai = mockk<AiService>()
    private val useCase = EnrichEntryWithAiUseCase(repo, ai)

    @Test fun `enriches entry with AI summary`() = runTest {
        coEvery { repo.getById("1") } returns Result.success(DiaryEntry(id = "1", content = "..."))
        coEvery { ai.enrichText(any()) } returns Result.success(AiResponse(summary = "Хороший день"))
        coEvery { repo.saveEntry(any()) } returns Result.success(Unit)
        assertTrue(useCase("1").isSuccess)
    }
}
```

## Anti-Patterns (ЗАПРЕЩЕНО)

- ❌ **God ViewModel** — один экран = один ViewModel. Разные фичи = разные классы.
- ❌ **Framework in domain** — `@Serializable`, `Instant`, Ktor imports в domain модели. Domain = чистый Kotlin.
- ❌ **DTO leak** — DTO не появляется в presentation. Mapper обязателен.
- ❌ **Exception-driven errors** — `suspend fun get(): List<T>` который бросает. Всегда `Result<T>`.
- ❌ **Mutable state in Composable** — `remember { mutableStateOf() }` для бизнес-логики. Stateless Composable + MVI.
- ❌ **Ktor in ViewModel** — HttpClient прямо в presentation. Только через Repository interface.
- ❌ **`println()`** → Napier/kermit. ❌ **`!!`** → `requireNotNull` / safe call. ❌ **`GlobalScope`** → scoped.
- ❌ **`MutableStateFlow` public** → `.asStateFlow()`. ❌ **`suspend fun` in Composable** → `LaunchedEffect`.
- ❌ **Hardcoded strings** → `const val` в отдельном файле минимум.

## File Template

```kotlin
package com.diaryai.presentation.viewmodel

import com.diaryai.domain.usecase.GetDiaryEntriesUseCase
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow

class DiaryListViewModel(
    private val getEntries: GetDiaryEntriesUseCase,
) : ScreenModel {
    private val _state = MutableStateFlow(DiaryListUiState())
    val state = _state.asStateFlow()

    fun onEvent(event: DiaryListEvent) { ... }
    private fun loadEntries() { ... }
}
```

**Rules:** Imports alphabetical, no wildcards. Grouped: stdlib → kotlinx → third-party → project. One class per file. Max 300 lines → split. Inside class: properties → public → private.
