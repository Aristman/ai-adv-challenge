# DiaryAI — Project CLAUDE.md

Мультиплатформенное приложение (Android, Web, Desktop) для ведения ежедневника с ИИ обогащением записей и генерацией картинок.

## Architecture: Clean + MVI + TDD

```
shared/src/commonMain/kotlin/
  domain/            ← Чистый Kotlin, ZERO framework deps
    model/             Domain models (data class, sealed)
    repository/        Интерфейсы только
    usecase/           Single-responsibility use cases
  data/
    remote/api + dto/  API, @Serializable DTOs
    local/dao + db/    DAO, DTOs
    repository/        Implementations
    mapper/            DTO ↔ Domain
  presentation/
    viewmodel/         MVI: StateFlow<UiState> + Channel<Effect>
    contract/          UiState + Event + Effect sealed classes
  di/                  Koin modules
  core/                Result wrapper, extensions

composeApp/src/commonMain/kotlin/ui/
  screen/  component/  theme/  navigation/
```

## Anti-Patterns (ЗАПРЕЩЕНО)

- ❌ `MutableStateFlow` public — используй `private val _state` + `val state = _state.asStateFlow()`
- ❌ `!!` (non-null assertion) — `requireNotNull`, safe call
- ❌ `println()` — Napier/kermit
- ❌ `Any`, untyped collections — strict types
- ❌ Exception-driven — `Result<T>` для fallible ops
- ❌ Framework in domain — domain = чистый Kotlin
- ❌ DTO in presentation — Mapper обязателен
- ❌ Hardcoded strings → `const val`
