# DiaryAI — Project CLAUDE.md

Мультиплатформенное приложение (Android, Web, Desktop) для ведения ежедневника с ИИ обогащением записей и ИИ генерацией картинок. Kotlin Multiplatform + Compose Multiplatform.

---

## Tech Stack

| Слой | Технология |
|------|-----------|
| Язык | Kotlin 2.1+ |
| UI | Compose Multiplatform |
| Навигация | Voyager |
| DI | Koin Multiplatform 4.x |
| Сеть | Ktor Client 3.x |
| Сериализация | kotlinx.serialization (JSON) |
| Локальная БД | SQLDelight 2.x |
| Async | Coroutines + StateFlow |
| Изображения | Kamel / Coil 3 (Compose Multiplatform) |
| AI | Ktor → OpenAI-compatible API (HTTP) |
| Тесты | Kotlin Test, MockK, Turbine, kotlinx-coroutines-test |
| Build | Gradle Kotlin DSL, version catalog |

---

## Architecture: Clean Architecture + MVI + TDD

```
shared/src/
  commonMain/
    domain/           ← Чистый Kotlin, ZERO зависимостей от фреймворков
      model/
      repository/     ← Interfaces только
      usecase/
    data/
      remote/         ← Ktor API, DTO
      local/          ← SQLDelight, expect/actual
      repository/     ← Implementation
      mapper/         ← DTO → Domain
    presentation/
      viewmodel/      ← MVI: State + Event + Effect
      state/
    di/
    core/             ← Утилиты, Result wrapper, extensions

composeApp/src/
  commonMain/
    ui/
      screen/
      component/
      theme/
  androidMain/
  desktopMain/
  wasmJsMain/        ← Web (Compose for Web)
```

**Правила слоёв:**

- `domain` НЕ знает про `data`, `presentation`,任何 фреймворк. Только Kotlin stdlib + `kotlinx.coroutines`
- `data` зависит только от `domain`. DTO не утекают за пределы `data`
- `presentation` зависит от `domain`. ViewModel получает UseCase, не Repository
- `ui` зависит от `presentation` (ViewModel) + Compose
- Зависимости строго однонаправленные: `ui → presentation → domain ← data`

---

## Folder Structure

```
diary-ai/
├── shared/                          ← KMP shared module
│   └── src/
│       └── commonMain/kotlin/
│           ├── domain/
│           │   ├── model/           ← Domain models (data class, sealed)
│           │   ├── repository/      ← Repository interfaces
│           │   └── usecase/         ← Use cases (single responsibility)
│           ├── data/
│           │   ├── remote/
│           │   │   ├── api/         ← Ktor API definitions
│           │   │   └── dto/         ← Network DTOs (@Serializable)
│           │   ├── local/
│           │   │   ├── database/    ← SQLDelight .sq files
│           │   │   └── dao/         ← Database DAOs
│           │   ├── repository/      ← Repository implementations
│           │   └── mapper/          ← DTO ↔ Domain mappers
│           ├── presentation/
│           │   ├── viewmodel/       ← ViewModels (MVI)
│           │   ├── contract/        ← State + Event + Effect sealed classes
│           │   └── reducer/         ← State reducers (pure functions)
│           ├── di/                  ← Koin modules
│           └── core/
│               ├── result/          ← NetworkResult<T> wrapper
│               ├── extensions/      ← Общие extension functions
│               └── datetime/        ← expect/actual для даты/времени
├── composeApp/                      ← Compose Multiplatform UI
│   └── src/
│       └── commonMain/kotlin/
│           └── ui/
│               ├── screen/          ← Экраны (DiaryListScreen, EntryEditScreen)
│               ├── component/       ← Переиспользуемые Compose компоненты
│               │   └── theme/       ← Тема, цвета, типография
│               └── navigation/      ← Навигация (Voyager)
├── gradle/
│   └── libs.versions.toml           ← Version catalog
├── build.gradle.kts
└── settings.gradle.kts
```

---

## Naming Conventions

### Общие правила (Kotlin official style guide)

- Пакеты: `lowercase`, без подчёркиваний → `domain.model`, `data.remote.dto`
- Классы: `PascalCase` → `DiaryEntry`, `GetEntriesUseCase`
- Функции и свойства: `camelCase` → `getEntries()`, `isLoading`
- Константы: `SCREAMING_SNAKE_CASE` → `MAX_ENTRY_LENGTH`
- Backing properties: `_` prefix → `private var _entries: List<Entry>`
- Файлы: один класс = имя класса. Несколько сущностей = описательное `PascalCase` → `DiaryEntry.kt`, `ApiEndpoints.kt`

### Проектные конвенции

| Сущность | Шаблон | Пример |
|----------|--------|--------|
| Domain model | Существительное | `DiaryEntry`, `Mood`, `AIGeneratedImage` |
| Repository interface | `[Entity]Repository` | `DiaryEntryRepository` |
| Repository implementation | `[Entity]RepositoryImpl` | `DiaryEntryRepositoryImpl` |
| Use case | `[Verb][Entity]UseCase` | `GetDiaryEntriesUseCase`, `CreateEntryUseCase` |
| ViewModel | `[Screen]ViewModel` | `DiaryListViewModel`, `EntryEditViewModel` |
| UI State | `[Screen]UiState` | `DiaryListUiState`, `EntryEditUiState` |
| UI Event | `[Screen]Event` | `DiaryListEvent`, `EntryEditEvent` |
| UI Effect | `[Screen]Effect` | `DiaryListEffect` |
| DTO | `[Entity]Dto` | `DiaryEntryDto`, `AiResponseDto` |
| Mapper | `[From]To[To]Mapper` | `DiaryEntryDtoToDomainMapper` |
| API endpoint | `[Entity]Api` | `DiaryApi`, `AiImageApi` |
| SQLDelight | `[entity].sq` | `DiaryEntry.sq` |
| Koin module | `[scope]Module` | `DataModule`, `DomainModule` |
| Test | `[TestedClass]Test` | `GetDiaryEntriesUseCaseTest` |

---

## Design Patterns

### Обязательные паттерны

**1. Repository Pattern**
Interfaces в `domain`, implementation в `data`. Presentation знает только interface.

```kotlin
// domain/repository/DiaryEntryRepository.kt
interface DiaryEntryRepository {
    suspend fun getEntries(dateRange: DateRange): Result<List<DiaryEntry>>
    suspend fun saveEntry(entry: DiaryEntry): Result<Unit>
}

// data/repository/DiaryEntryRepositoryImpl.kt
class DiaryEntryRepositoryImpl(
    private val localDataSource: DiaryEntryDao,
    private val remoteDataSource: DiaryApi,
) : DiaryEntryRepository { ... }
```

**2. Use Case Pattern**
Каждый use case — один класс, один публичный метод `invoke`. Чистая бизнес-логика.

```kotlin
class GetDiaryEntriesUseCase(
    private val repository: DiaryEntryRepository,
) {
    suspend operator fun invoke(dateRange: DateRange): Result<List<DiaryEntry>> {
        return repository.getEntries(dateRange)
    }
}
```

**3. MVI (Model-View-Intent)**
State — immutable `data class`. Event — sealed. Effect — sealed (одноразовые побочные действия).

```kotlin
// presentation/contract/DiaryListContract.kt
data class DiaryListUiState(
    val entries: List<DiaryEntry> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null,
)

sealed interface DiaryListEvent {
    data object LoadEntries : DiaryListEvent
    data class DeleteEntry(val id: String) : DiaryListEvent
    data class SelectDate(val date: LocalDate) : DiaryListEvent
}

sealed interface DiaryListEffect {
    data class ShowError(val message: String) : DiaryListEffect
    data object NavigateToCreate : DiaryListEffect
}
```

**4. Factory Pattern**
Koin modules используют factory для ViewModels (новый инстанс каждый раз).

```kotlin
viewModel {
    DiaryListViewModel(
        getEntries = get(),
        deleteEntry = get(),
    )
}
```

**5. expect/actual для platform-specific**
Любой код, зависящий от платформы — через `expect`/`actual`.

```kotlin
// core/datetime/PlatformDateTime.kt
expect fun currentDateTime(): LocalDateTime

// core/datetime/PlatformDateTime.android.kt
actual fun currentDateTime(): LocalDateTime = LocalDateTime.now()

// core/datetime/PlatformDateTime.desktop.kt
actual fun currentDateTime(): LocalDateTime = Clock.System.now()
    .toLocalDateTime(TimeZone.currentSystemDefault())
```

### Вспомогательные паттерны

- **Result wrapper**: все repository/UseCase возвращают `Result<T>`, не бросают исключения
- **StateFlow**: ViewModel expose `StateFlow<UiState>`, не `MutableStateFlow`
- **Immutable UiState**: только `val` в data class, никаких `var`

---

## Good Code Examples

### 1. ✅ Use case — чистый, тестируемый, один responsibility

```kotlin
class EnrichEntryWithAiUseCase(
    private val entryRepository: DiaryEntryRepository,
    private val aiService: AiService,
) {
    suspend operator fun invoke(entryId: String): Result<DiaryEntry> = runCatching {
        val entry = entryRepository.getById(entryId).getOrThrow()
        val enriched = aiService.enrichText(entry.content).getOrThrow()
        val updated = entry.copy(
            aiSummary = enriched.summary,
            mood = enriched.mood,
            tags = enriched.tags,
        )
        entryRepository.saveEntry(updated).getOrThrow()
        updated
    }
}
```

### 2. ✅ ViewModel — MVI, чистый reducer, SideEffect через separate channel

```kotlin
class EntryEditViewModel(
    private val saveEntry: SaveEntryUseCase,
    private val generateImage: GenerateImageUseCase,
) : ScreenModel, ScreenModelScope by screenModelScope {

    private val _state = MutableStateFlow(EntryEditUiState())
    val state: StateFlow<EntryEditUiState> = _state.asStateFlow()

    private val _effect = Channel<EntryEditEffect>()
    val effect: Flow<EntryEditEffect> = _effect.receiveAsFlow()

    fun onEvent(event: EntryEditEvent) {
        when (event) {
            is EntryEditEvent.ContentChanged -> reduce { copy(content = event.text) }
            is EntryEditEvent.Save -> save()
            is EntryEditEvent.GenerateImage -> generateImage()
        }
    }

    private fun reduce(reducer: EntryEditUiState.() -> EntryEditUiState) {
        _state.update(reducer)
    }

    private fun save() { screenModelScope.launch { ... } }
    private fun generateImage() { screenModelScope.launch { ... } }
}
```

### 3. ✅ Repository implementation — правильная обработка ошибок, Offline-first

```kotlin
class DiaryEntryRepositoryImpl(
    private val remoteApi: DiaryApi,
    private val localDao: DiaryEntryDao,
    private val mapper: DiaryEntryMapper,
) : DiaryEntryRepository {

    override suspend fun getEntries(range: DateRange): Result<List<DiaryEntry>> =
        runCatching {
            localDao.getByDateRange(range.start, range.end)
                .map(mapper::mapToDomain)
        }

    override suspend fun syncEntries(): Result<Unit> = runCatching {
        val remote = remoteApi.getAllEntries().map(mapper::mapToDomain)
        localDao.insertAll(remote.map(mapper::mapToLocal))
    }
}
```

### 4. ✅ Compose Screen — Stateless component + state hoisting

```kotlin
@Composable
fun DiaryListScreen(
    state: DiaryListUiState,
    onEvent: (DiaryListEvent) -> Unit,
    onEffect: (DiaryListEffect) -> Unit,
    modifier: Modifier = Modifier,
) {
    when {
        state.isLoading -> CircularProgressIndicator(modifier = modifier.fillMaxSize())
        state.error != null -> ErrorMessage(state.error, onRetry = { onEvent(DiaryListEvent.LoadEntries) })
        else -> DiaryListContent(
            entries = state.entries,
            onSelect = { onEvent(DiaryListEvent.SelectDate(it)) },
            onDelete = { onEvent(DiaryListEvent.DeleteEntry(it)) },
            modifier = modifier,
        )
    }
}
```

### 5. ✅ Тест UseCase — Arrange-Act-Assert, Kotlin Test

```kotlin
class EnrichEntryWithAiUseCaseTest {
    private val repository = mockk<DiaryEntryRepository>()
    private val aiService = mockk<AiService>()
    private val useCase = EnrichEntryWithAiUseCase(repository, aiService)

    @Test
    fun `should enrich entry with AI summary and tags`() = runTest {
        val entry = DiaryEntry(id = "1", content = "Сегодня был отличный день...")
        val enriched = AiEnrichmentResponse(summary = "Отличный день", tags = listOf("настроение"))

        coEvery { repository.getById("1") } returns Result.success(entry)
        coEvery { aiService.enrichText("Сегодня был отличный день...") } returns Result.success(enriched)
        coEvery { repository.saveEntry(any()) } returns Result.success(Unit)

        val result = useCase("1")

        assertTrue(result.isSuccess)
        assertEquals("Отличный день", result.getOrThrow().aiSummary)
        coVerify { repository.saveEntry(match { it.aiSummary == "Отличный день" }) }
    }

    @Test
    fun `should propagate error when AI service fails`() = runTest {
        coEvery { repository.getById("1") } returns Result.success(DiaryEntry(id = "1", content = "..."))
        coEvery { aiService.enrichText(any()) } returns Result.failure(IOException("Network error"))

        val result = useCase("1")

        assertTrue(result.isFailure)
    }
}
```

---

## Anti-Patterns (ЗАПРЕЩЕНО)

### 1. ❌ God ViewModel

```kotlin
// BAD — ViewModel с 20 методами и 3 состояниями
class DiaryViewModel(
    private val entryRepo: DiaryEntryRepository,
    private val aiService: AiService,
    private val imageService: AiImageService,
    private val settingsRepo: SettingsRepository,
) {
    // 20 public methods, 3 MutableStateFlows, mixed concerns
    fun loadEntries() { ... }
    fun saveEntry() { ... }
    fun deleteEntry() { ... }
    fun enrichWithAi() { ... }
    fun generateImage() { ... }
    fun updateSettings() { ... }
}
```

**Почему:** Нарушает SRP, невозможно тестировать, состояние невозможно отслеживать.

**Правильно:** Один экран = один ViewModel. Разные экраны = разные ViewModels. Общие данные через shared UseCase/Repository.

### 2. ❌ Domain model зависит от фреймворка

```kotlin
// BAD — @Serializable в domain модели
@Serializable
data class DiaryEntry(
    val id: String,
    val content: String,
    val createdAt: Instant,  ← kotlinx-datetime (зависимость)
)

// BAD — DTO просочился в presentation
class DiaryListViewModel : ScreenModel {
    fun load() {
        viewModelScope.launch {
            val entries: List<DiaryEntryDto> = repository.getEntries()  ← DTO в presentation!
        }
    }
}
```

**Правильно:** Domain model — чистый Kotlin data class. DTO отдельный класс в `data/dto`. Mapper между ними.

### 3. ❌ Exception-driven error handling

```kotlin
// BAD — исключения как flow control
class GetEntriesUseCase(private val repo: DiaryEntryRepository) {
    suspend operator fun invoke(): List<DiaryEntry> {
        return repo.getEntries()  // бросает IOException при ошибке сети
    }
}
```

**Правильно:** Всегда `Result<T>`. Вызывающий решает, что делать с ошибкой.

### 4. ❌ Mutable state в UI

```kotlin
// BAD — mutable state в Compose, no state hoisting
@Composable
fun DiaryListScreen() {
    var entries by remember { mutableStateOf(emptyList<DiaryEntry>()) }
    var isLoading by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) {
        isLoading = true
        entries = viewModel.getEntries()
        isLoading = false
    }
}
```

**Почему:** Логика в Composable, нет разделения concerns, невозможно тестировать.

**Правильно:** Stateless Composable + state из ViewModel через MVI contract.

### 5. ❌ Прямые запросы к API из ViewModel/Composable

```kotlin
// BAD — Ktor client в ViewModel
class DiaryListViewModel : ScreenModel {
    private val httpClient = HttpClient() {  // Ktor в presentation!
        install(ContentNegotiation) { json() }
    }

    fun load() {
        viewModelScope.launch {
            val response: List<DiaryEntryDto> = httpClient.get("https://api.example.com/entries").body()
        }
    }
}
```

**Почему:** Нарушает Clean Architecture, невозможно тестировать без реального HTTP.

**Правильно:** API call в `data/remote/`, через Repository interface в `domain`.

### Дополнительные anti-patterns

- ❌ `println()` / `console.log()` в коде → используем `Napier` или `kermit` для логирования
- ❌ `!!` (non-null assertion) в production → `?: throw`, `?: return`, `val x = requireNotNull(x)`
- ❌ `GlobalScope.launch` → всегда scoped coroutine (`viewModelScope`, `screenModelScope`)
- ❌ `MutableStateFlow` в public API → expose `StateFlow` через `.asStateFlow()`
- ❌ `suspend fun` в Composable → `LaunchedEffect` или `rememberCoroutineScope`
- ❌ Hardcoded строки → string resources (пока KMP i18n не определён, хотя бы `const val` в отдельном файле)

---

## File Template

Стандартная структура файла в проекте:

```kotlin
// 1. File-level comment (опционально, для сложных файлов)
//
// File: [краткое описание]
// Owner: [фича/модуль]

// 2. Package
package com.diaryai.presentation.viewmodel

// 3. Imports — alphabetical, grouped: stdlib → third-party → project
import com.diaryai.domain.usecase.GetDiaryEntriesUseCase
import com.diaryai.domain.model.DiaryEntry
import com.diaryai.presentation.contract.DiaryListEvent
import com.diaryai.presentation.contract.DiaryListUiState
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

// 4. Class/object declaration
class DiaryListViewModel(
    private val getEntries: GetDiaryEntriesUseCase,
) : ScreenModel {

    // 5. Private state
    private val _state = MutableStateFlow(DiaryListUiState())
    val state: StateFlow<DiaryListUiState> = _state.asStateFlow()

    private val _effect = Channel<DiaryListEffect>()
    val effect: Flow<DiaryListEffect> = _effect.receiveAsFlow()

    // 6. Public API
    fun onEvent(event: DiaryListEvent) { ... }

    // 7. Private implementation
    private fun reduce(reducer: DiaryListUiState.() -> DiaryListUiState) { ... }
    private fun loadEntries() { ... }
}
```

**Правила:**
- Imports alphabetical, без wildcards (`import ...*`)
- Группировка: stdlib → kotlinx → third-party → project
- Одно объявление класса на файл (если не тесно связанные sealed-классы)
- Файл < 300 строк. Если больше — split
- Внутри класса: properties → constructor → public methods → private methods
