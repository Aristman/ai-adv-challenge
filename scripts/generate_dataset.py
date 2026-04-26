import json

SYSTEM_PROMPT = (
    "You are an expert Kotlin developer. Write clean, idiomatic Kotlin code. "
    "Follow best practices: prefer immutability, use data classes, sealed classes, "
    "extension functions, scope functions, coroutines with suspend, and Result<T> for "
    "error handling. Never use !!, println(), or mutable state as public API."
)

examples = []

# Helper
def add(user, assistant):
    examples.append({
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user},
            {"role": "assistant", "content": assistant}
        ]
    })

# ============================================================
# 12 REAL EXAMPLES (from DiaryAI project)
# ============================================================

add(
    'Create a Kotlin data class for a diary entry with fields: id, content, date as Long, optional mood, tags list, and optional AI-generated summary. Include a Mood enum with five levels.',
    '''data class DiaryEntry(
    val id: String,
    val content: String,
    val date: Long,
    val mood: Mood? = null,
    val tags: List<String> = emptyList(),
    val aiSummary: String? = null,
)

enum class Mood {
    GREAT, GOOD, NEUTRAL, BAD, AWFUL,
}'''
)

add(
    'Write a Kotlin repository interface for diary entries. All methods should be suspend and return Result<T>. Include getEntries, getById, saveEntry, and deleteEntry.',
    '''interface DiaryEntryRepository {
    suspend fun getEntries(): Result<List<DiaryEntry>>
    suspend fun getById(id: String): Result<DiaryEntry>
    suspend fun saveEntry(entry: DiaryEntry): Result<Unit>
    suspend fun deleteEntry(id: String): Result<Unit>
}'''
)

add(
    'Implement a Kotlin use case class that delegates to a repository. Use operator fun invoke so it can be called like a function. Follow Clean Architecture — domain layer has zero framework deps.',
    '''class GetDiaryEntriesUseCase(
    private val repository: DiaryEntryRepository,
) {
    suspend operator fun invoke(): Result<List<DiaryEntry>> =
        repository.getEntries()
}'''
)

add(
    'Create a DAO interface for local storage of diary entries with synchronous methods: getAll, getById (nullable), insert, and delete.',
    '''interface DiaryEntryDao {
    fun getAll(): List<DiaryEntryDto>
    fun getById(id: String): DiaryEntryDto?
    fun insert(dto: DiaryEntryDto)
    fun delete(id: String)
}'''
)

add(
    'Create a kotlinx.serialization DTO for a diary entry. Mood is stored as nullable String (enum name), not as the enum itself. Mark with @Serializable.',
    '''@Serializable
data class DiaryEntryDto(
    val id: String,
    val content: String,
    val date: Long,
    val mood: String? = null,
    val tags: List<String> = emptyList(),
    val aiSummary: String? = null,
)'''
)

add(
    'Write a Kotlin mapper class that converts DiaryEntryDto to DiaryEntry (domain model). The mood field is a nullable String in DTO but Mood enum in domain. Use runCatching, log warnings via Napier on invalid mood, and provide a mapReverse method for the opposite direction.',
    '''class DiaryEntryDtoToDomainMapper {

    private companion object {
        const val LOG_TAG = "DiaryEntryDtoToDomainMapper"
    }

    fun map(dto: DiaryEntryDto): Result<DiaryEntry> = runCatching {
        DiaryEntry(
            id = dto.id,
            content = dto.content,
            date = dto.date,
            mood = dto.mood?.let { moodStr ->
                runCatching { Mood.valueOf(moodStr) }.onFailure {
                    Napier.w("Invalid mood value: '$moodStr' for entry ${dto.id}", throwable = it, tag = LOG_TAG)
                }.getOrThrow()
            },
            tags = dto.tags,
            aiSummary = dto.aiSummary,
        )
    }

    fun mapReverse(entry: DiaryEntry): DiaryEntryDto = DiaryEntryDto(
        id = entry.id,
        content = entry.content,
        date = entry.date,
        mood = entry.mood?.name,
        tags = entry.tags,
        aiSummary = entry.aiSummary,
    )
}'''
)

add(
    'Show me an example of safe enum parsing from String in Kotlin with error logging. The string might be null or invalid.',
    '''dto.mood?.let { moodStr ->
    runCatching { Mood.valueOf(moodStr) }.onFailure {
        Napier.w("Invalid mood value: '$moodStr' for entry ${dto.id}", throwable = it, tag = LOG_TAG)
    }.getOrThrow()
}'''
)

add(
    'Implement a repository in Kotlin that wraps a synchronous DAO with coroutines. Use withContext(Dispatchers.Default) for thread switching, runCatching for Result wrapping, and a mapper for DTO-to-domain conversion. Return Result.failure with a descriptive message when an entity is not found.',
    '''class DiaryEntryRepositoryImpl(
    private val dao: DiaryEntryDao,
    private val mapper: DiaryEntryDtoToDomainMapper,
) : DiaryEntryRepository {

    override suspend fun getEntries(): Result<List<DiaryEntry>> = runCatching {
        withContext(Dispatchers.Default) { dao.getAll() }.map { dtoList ->
            dtoList.map { mapper.map(it).getOrThrow() }
        }
    }

    override suspend fun getById(id: String): Result<DiaryEntry> {
        val dto = withContext(Dispatchers.Default) { dao.getById(id) }
            ?: return Result.failure(NoSuchElementException("$ENTRY_NOT_FOUND '$id' not found"))
        return mapper.map(dto)
    }

    override suspend fun saveEntry(entry: DiaryEntry): Result<Unit> = runCatching {
        withContext(Dispatchers.Default) { dao.insert(mapper.mapReverse(entry)) }
    }

    override suspend fun deleteEntry(id: String): Result<Unit> = runCatching {
        withContext(Dispatchers.Default) { dao.delete(id) }
    }

    companion object {
        private const val ENTRY_NOT_FOUND = "DiaryEntry with id"
    }
}'''
)

add(
    'How to map a list of DTOs to domain models in Kotlin when the mapper returns Result<T>? Use the Result.map extension on the list.',
    '''override suspend fun getEntries(): Result<List<DiaryEntry>> = runCatching {
    withContext(Dispatchers.Default) { dao.getAll() }.map { dtoList ->
        dtoList.map { mapper.map(it).getOrThrow() }
    }
}'''
)

add(
    'Show an idiom for early return with Result.failure in Kotlin when a nullable lookup returns null.',
    '''override suspend fun getById(id: String): Result<DiaryEntry> {
    val dto = withContext(Dispatchers.Default) { dao.getById(id) }
        ?: return Result.failure(NoSuchElementException("Entry '$id' not found"))
    return mapper.map(dto)
}'''
)

add(
    'Show me the Clean Architecture use case pattern in Kotlin: a single-action class with operator fun invoke that delegates to a repository.',
    '''class GetDiaryEntriesUseCase(
    private val repository: DiaryEntryRepository,
) {
    suspend operator fun invoke(): Result<List<DiaryEntry>> =
        repository.getEntries()
}'''
)

add(
    'Demonstrate the DTO-to-domain mapping pattern in Kotlin multiplatform. DTO uses @Serializable and stores enums as strings; domain uses proper types. Show both the DTO class and the mapper with forward + reverse mapping.',
    '''@Serializable
data class DiaryEntryDto(
    val id: String,
    val content: String,
    val date: Long,
    val mood: String? = null,
    val tags: List<String> = emptyList(),
    val aiSummary: String? = null,
)

class DiaryEntryDtoToDomainMapper {
    fun map(dto: DiaryEntryDto): Result<DiaryEntry> = runCatching {
        DiaryEntry(
            id = dto.id,
            content = dto.content,
            date = dto.date,
            mood = dto.mood?.let { runCatching { Mood.valueOf(it) }.getOrNull() },
            tags = dto.tags,
            aiSummary = dto.aiSummary,
        )
    }

    fun mapReverse(entry: DiaryEntry): DiaryEntryDto = DiaryEntryDto(
        id = entry.id,
        content = entry.content,
        date = entry.date,
        mood = entry.mood?.name,
        tags = entry.tags,
        aiSummary = entry.aiSummary,
    )
}'''
)

# ============================================================
# 48 SYNTHETIC EXAMPLES
# ============================================================

# --- Utility Functions (14) ---

add(
    'Write a Kotlin function charFrequency that takes a String and returns a Map<Char, Int> counting how often each character appears.',
    '''fun charFrequency(text: String): Map<Char, Int> =
    text.groupingBy { it }.eachCount()'''
)

add(
    'Write a Kotlin function to flatten a nested List<List<T>> into a flat List<T>.',
    '''fun <T> flatten(nested: List<List<T>>): List<T> =
    nested.flatten()'''
)

add(
    'Write a Kotlin function chunked that splits a list into sublists of the given size. Use the standard library chunked extension.',
    '''fun <T> chunkList(items: List<T>, size: Int): List<List<T>> =
    items.chunked(size)'''
)

add(
    'Write a Kotlin function that partitions a list into two lists based on a predicate. Show usage with a list of numbers partitioned into even and odd.',
    '''fun <T> partitionByPredicate(
    items: List<T>,
    predicate: (T) -> Boolean,
): Pair<List<T>, List<T>> = items.partition(predicate)

// Usage:
// val (evens, odds) = partitionByPredicate(listOf(1, 2, 3, 4, 5)) { it % 2 == 0 }
// evens = [2, 4], odds = [1, 3, 5]'''
)

add(
    'Write a Kotlin function distinctBy that returns unique elements from a list based on a selector function. Do not use the built-in distinctBy.',
    '''fun <T, K> distinctBy(items: List<T>, selector: (T) -> K): List<T> {
    val seen = mutableSetOf<K>()
    return items.filter { seen.add(selector(it)) }
}'''
)

add(
    'Write a Kotlin suspend function retry that retries a block with exponential backoff. It should accept maxAttempts, initialDelayMs, and a factor.',
    '''suspend fun <T> retry(
    maxAttempts: Int = 3,
    initialDelayMs: Long = 100L,
    factor: Double = 2.0,
    block: suspend () -> Result<T>,
): Result<T> {
    var delay = initialDelayMs
    repeat(maxAttempts - 1) { attempt ->
        val result = block()
        if (result.isSuccess) return result
        delay(delay)
        delay = (delay * factor).toLong()
    }
    return block()
}

private suspend fun delay(ms: Long) {
    kotlinx.coroutines.delay(ms)
}'''
)

add(
    'Write a Kotlin Flow extension function debounceUntilChanged that only emits when the value actually changes after the debounce window.',
    '''import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.transformLatest

fun <T> Flow<T>.debounceUntilChanged(timeoutMs: Long): Flow<T> =
    debounce(timeoutMs).transformLatest { value ->
        emit(value)
    }

// Simpler version using distinctUntilChanged + debounce:
// fun <T> Flow<T>.debounceUntilChanged(timeoutMs: Long): Flow<T> =
//     debounce(timeoutMs).distinctUntilChanged()'''
)

add(
    'Write a Kotlin function memoize that caches the result of a suspend function. The cache should be based on the input parameter.',
    '''import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

fun <T, R> memoize(block: suspend (T) -> R): suspend (T) -> R {
    val cache = mutableMapOf<T, R>()
    val mutex = Mutex()
    return { input: T ->
        mutex.withLock {
            cache.getOrPut(input) { block(input) }
        }
    }
}'''
)

add(
    'Write a Kotlin function parseUrlParameters that extracts query parameters from a URL string and returns them as a Map<String, String>.',
    '''fun parseUrlParameters(url: String): Map<String, String> {
    val queryStart = url.indexOf("?")
    if (queryStart < 0) return emptyMap()
    val query = url.substring(queryStart + 1)
    return query.split("&")
        .filter { it.contains("=") }
        .associate { pair ->
            val (key, value) = pair.split("=", limit = 2)
            key to value
        }
}'''
)

add(
    'Write a Kotlin tail-recursive function to calculate the nth Fibonacci number.',
    '''tailrec fun fibonacci(n: Int, a: Long = 0L, b: Long = 1L): Long =
    when {
        n <= 0 -> a
        else -> fibonacci(n - 1, b, a + b)
    }'''
)

add(
    'Write a Kotlin function shuffleWithSeed that shuffles a list deterministically using a seed value.',
    '''import kotlin.random.Random

fun <T> shuffleWithSeed(items: List<T>, seed: Long): List<T> {
    val random = Random(seed)
    return items.toMutableList().apply { shuffle(random) }.toList()
}'''
)

add(
    'Write a Kotlin function deepCopy that creates a deep copy of a @Serializable data class using kotlinx.serialization JSON.',
    '''import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

inline fun <reified T : Any> deepCopy(value: T): T {
    val json = Json { encodeDefaults = true }
    val jsonString = json.encodeToString(value)
    return json.decodeFromString(jsonString)
}'''
)

add(
    'Write a Kotlin function weightedRandom that selects an element from a list based on weights. Return a Result wrapping the selected element.',
    '''import kotlin.random.Random

fun <T> weightedRandom(items: List<T>, weights: List<Double>): Result<T> = runCatching {
    require(items.size == weights.size) { "Items and weights must have the same size" }
    require(weights.all { it >= 0.0 }) { "Weights must be non-negative" }
    val totalWeight = weights.sum()
    var random = Random.nextDouble() * totalWeight
    items.zip(weights).first { (_, weight) ->
        random -= weight
        random <= 0.0
    }.first
}'''
)

add(
    'Write a Kotlin function groupConsecutive that groups consecutive equal elements in a list.',
    '''fun <T> groupConsecutive(items: List<T>): List<List<T>> {
    if (items.isEmpty()) return emptyList()
    val result = mutableListOf<List<T>>()
    var current = mutableListOf(items.first())
    for (i in 1 until items.size) {
        if (items[i] == items[i - 1]) {
            current.add(items[i])
        } else {
            result.add(current.toList())
            current = mutableListOf(items[i])
        }
    }
    result.add(current)
    return result
}'''
)

# --- Data Classes and Models (8) ---

add(
    'Create a Kotlin User data class with a sealed Role hierarchy (Admin, Editor, Viewer). Each role may have different properties.',
    '''data class User(
    val id: String,
    val name: String,
    val email: String,
    val role: Role,
)

sealed class Role {
    data class Admin(val permissions: List<String>) : Role()
    data object Editor : Role()
    data object Viewer : Role()
}'''
)

add(
    'Create a generic ApiResponse<T> sealed class with Loading, Success, and Error states for use in UI layer.',
    '''sealed class ApiResponse<out T> {
    data object Loading : ApiResponse<Nothing>()
    data class Success<T>(val data: T) : ApiResponse<T>()
    data class Error(val message: String, val cause: Throwable? = null) : ApiResponse<Nothing>()

    val isLoading: Boolean get() = this is Loading
    val dataOrNull: T? get() = (this as? Success)?.data
}'''
)

add(
    'Create a Kotlin Configuration data class with a validate method that returns ValidationResult. Fields: host, port, timeoutMs, retryCount.',
    '''data class Configuration(
    val host: String,
    val port: Int,
    val timeoutMs: Long = 30_000L,
    val retryCount: Int = 3,
) {
    fun validate(): ValidationResult {
        val errors = buildList {
            if (host.isBlank()) add("Host must not be blank")
            if (port !in 1..65535) add("Port must be in range 1..65535")
            if (timeoutMs <= 0) add("Timeout must be positive")
            if (retryCount < 0) add("Retry count must be non-negative")
        }
        return if (errors.isEmpty()) ValidationResult.Valid else ValidationResult.Invalid(errors)
    }
}

sealed class ValidationResult {
    data object Valid : ValidationResult()
    data class Invalid(val errors: List<String>) : ValidationResult()
}'''
)

add(
    'Create a Kotlin NetworkResult sealed interface with variants for success, server error, and network error.',
    '''sealed interface NetworkResult<out T> {
    data class Success<T>(val data: T, val statusCode: Int) : NetworkResult<T>
    data class ServerError(val statusCode: Int, val message: String) : NetworkResult<Nothing>
    data class NetworkError(val cause: Throwable) : NetworkResult<Nothing>()

    val isSuccess: Boolean get() = this is Success
    val dataOrNull: T? get() = (this as? Success)?.data
}'''
)

add(
    'Create a Kotlin PaginatedResponse<T> data class with items list, page, pageSize, and total count.',
    '''data class PaginatedResponse<T>(
    val items: List<T>,
    val page: Int,
    val pageSize: Int,
    val totalCount: Long,
) {
    val totalPages: Int get() = ((totalCount + pageSize - 1) / pageSize).coerceAtLeast(1)
    val hasNextPage: Boolean get() = page < totalPages
    val hasPreviousPage: Boolean get() = page > 1
}'''
)

add(
    'Create a Kotlin ValidationResult sealed class with variants for Valid, Invalid (with field errors map), and Partial (some fields valid, some not).',
    '''sealed class ValidationResult {
    data object Valid : ValidationResult()
    data class Invalid(val fieldErrors: Map<String, List<String>>) : ValidationResult() {
        val allErrors: List<String> get() = fieldErrors.values.flatten()
    }
    data class Partial(
        val validFields: Set<String>,
        val fieldErrors: Map<String, List<String>>,
    ) : ValidationResult() {
        val allErrors: List<String> get() = fieldErrors.values.flatten()
    }
}'''
)

add(
    'Create a Kotlin sealed class Event for MVI architecture with variants for LoadData, Refresh, and Navigate.',
    '''sealed class Event {
    data object LoadData : Event()
    data object Refresh : Event()
    data class Navigate(val route: String) : Event()
    data class UpdateField(val field: String, val value: String) : Event()
    data class ShowMessage(val message: String) : Event()
}'''
)

add(
    'Create a generic Resource wrapper sealed class with Loading, Success, and Error states. Include fold and map transformations.',
    '''sealed class Resource<out T> {
    data object Loading : Resource<Nothing>()
    data class Success<T>(val data: T) : Resource<T>()
    data class Error(val message: String, val cause: Throwable? = null) : Resource<Nothing>()

    inline fun <R> fold(
        onSuccess: (T) -> R,
        onError: (String, Throwable?) -> R,
        onLoading: () -> R,
    ): R = when (this) {
        is Success -> onSuccess(data)
        is Error -> onError(message, cause)
        Loading -> onLoading()
    }

    inline fun <R> map(transform: (T) -> R): Resource<R> = when (this) {
        is Success -> Success(transform(data))
        is Error -> Error(message, cause)
        Loading -> Loading
    }
}'''
)

# --- Kotlin-Specific (8) ---

add(
    'Show a Kotlin sealed class with when expression that is exhaustive (no else needed). Include all variants.',
    '''sealed class PaymentMethod {
    data class CreditCard(val lastFour: String) : PaymentMethod()
    data class PayPal(val email: String) : PaymentMethod()
    data object Cash : PaymentMethod()
}

fun processPayment(method: PaymentMethod): String = when (method) {
    is PaymentMethod.CreditCard -> "Charging card ending in ${method.lastFour}"
    is PaymentMethod.PayPal -> "Sending payment to ${method.email}"
    is PaymentMethod.Cash -> "Cash on delivery"
}'''
)

add(
    'Compare Kotlin scope functions: let, apply, also, and run. Show a concise example of each.',
    '''// let — transforms value, returns lambda result
val upper = name?.let { it.uppercase() }

// apply — configures object, returns the object itself
val config = StringBuilder().apply {
    append("host=localhost")
    append("&port=8080")
}

// also — performs side effect, returns the original value
val user = fetchUser().also { log.debug("Fetched user: ${it.id}") }

// run — combines let + apply: context of object + returns lambda result
val length = "hello".run { length * 2 }'''
)

add(
    'Show the Kotlin Result binding pattern using runCatching with onSuccess and onFailure.',
    '''fun fetchAndProcess(id: String): Result<String> =
    fetchFromNetwork(id)
        .onSuccess { data -> log.debug("Data fetched: $data") }
        .onFailure { e -> log.warn("Fetch failed", e) }
        .mapCatching { data -> processData(data) }

// Chaining multiple fallible operations:
fun pipeline(input: String): Result<Int> = runCatching {
    parseInt(input).getOrThrow()
}.mapCatching { parsed ->
    validate(parsed).getOrThrow()
}.mapCatching { validated ->
    compute(validated)
}'''
)

add(
    'Show a Kotlin lazy delegate example that computes a value only once on first access.',
    '''class DatabaseConnection private constructor(val url: String) {
    companion object {
        private var instance: DatabaseConnection? = null
        val instanceLazy: DatabaseConnection by lazy {
            DatabaseConnection("jdbc:postgresql://localhost:5432/db")
        }
    }

    val metadata: String by lazy {
        "Connection to $url established"
    }
}'''
)

add(
    'Create a custom observable property delegate in Kotlin that logs changes.',
    '''import kotlin.properties.Delegates
import kotlin.reflect.KProperty

class ObservableProperty<T>(
    initialValue: T,
    private val onChange: (oldValue: T, newValue: T) -> Unit,
) {
    private var value = initialValue

    operator fun getValue(thisRef: Any?, property: KProperty<*>): T = value

    operator fun setValue(thisRef: Any?, property: KProperty<*>, newValue: T) {
        val oldValue = value
        if (oldValue != newValue) {
            value = newValue
            onChange(oldValue, newValue)
        }
    }
}

// Usage:
// var count: Int by ObservableProperty(0) { old, new ->
//     log.debug("Count changed: $old -> $new")
// }'''
)

add(
    'Write a Kotlin inline function with reified type parameter that retrieves the simple class name.',
    '''import kotlin.reflect.KClass

inline fun <reified T> className(): String = T::class.simpleName ?: "Unknown"

inline fun <reified T> isInstanceOf(value: Any): Boolean = value is T

// Usage:
// val name = className<String>() // "String"
// val check = isInstanceOf<List<Int>>(emptyList<Any>()) // false'''
)

add(
    'Show a Kotlin value class example for wrapping a primitive type with zero runtime overhead.',
    '''@JvmInline
value class UserId(val value: String) {
    init {
        require(value.isNotBlank()) { "UserId must not be blank" }
    }

    val sanitized: String get() = value.trim()
}

@JvmInline
value class PositiveInt(val value: Int) {
    init {
        require(value > 0) { "PositiveInt must be positive, got $value" }
    }
}'''
)

add(
    'Show a Kotlin annotation class with a retention policy and how to use it.',
    '''@Target(AnnotationTarget.CLASS, AnnotationTarget.FUNCTION)
@Retention(AnnotationRetention.RUNTIME)
annotation class ApiEndpoint(
    val path: String,
    val method: HttpMethod,
)

enum class HttpMethod { GET, POST, PUT, DELETE }

@ApiEndpoint(path = "/users/{id}", method = HttpMethod.GET)
class GetUserEndpoint

// Reflection usage:
// val annotation = GetUserEndpoint::class.findAnnotation<ApiEndpoint>()
// println(annotation?.path) // "/users/{id}"'''
)

# --- Collections and Sequences (8) ---

add(
    'Write a Kotlin function using Sequence to lazily process lines from a large file. Only include lines matching a predicate.',
    '''import java.io.File

fun findMatchingLines(file: File, predicate: (String) -> Boolean): Sequence<String> =
    file.useLines { lines ->
        lines.filter(predicate)
    }

// Usage — processes lazily, no full file in memory:
// val result = findMatchingLines(File("large.txt")) { it.contains("ERROR") }
//     .take(10)
//     .toList()'''
)

add(
    'Show Kotlin groupingBy with eachCount to count occurrences of elements in a list.',
    '''fun countOccurrences(items: List<String>): Map<String, Int> =
    items.groupingBy { it }.eachCount()

// Count by a property:
data class Product(val category: String, val name: String)

fun countByCategory(products: List<Product>): Map<String, Int> =
    products.groupingBy { it.category }.eachCount()

// Usage:
// val counts = countByCategory(listOf(
//     Product("food", "apple"),
//     Product("food", "bread"),
//     Product("tech", "laptop"),
// ))
// counts == mapOf("food" to 2, "tech" to 1)'''
)

add(
    'Write a Kotlin function that zips two lists and produces a list of transformed pairs.',
    '''fun <A, B, R> zipTransform(
    first: List<A>,
    second: List<B>,
    transform: (A, B) -> R,
): List<R> {
    val minSize = minOf(first.size, second.size)
    return (0 until minSize).map { i -> transform(first[i], second[i]) }
}

// Usage:
// val result = zipTransform(listOf(1, 2, 3), listOf("a", "b", "c")) { num, str -> "$num$str" }
// result == ["1a", "2b", "3c"]'''
)

add(
    'Show Kotlin associateBy and associateWith to create maps from collections.',
    '''data class Item(val id: Int, val name: String)

// associateBy: use element as value, selector produces key
fun indexById(items: List<Item>): Map<Int, Item> =
    items.associateBy { it.id }

// associateWith: use element as key, lambda produces value
fun nameLengths(names: List<String>): Map<String, Int> =
    names.associateWith { it.length }

// associateBy + value transform
fun idToName(items: List<Item>): Map<Int, String> =
    items.associateBy({ it.id }, { it.name })'''
)

add(
    'Write a Kotlin function using foldRight to accumulate results in reverse order.',
    '''fun <T, R> accumulateFromRight(
    items: List<T>,
    initial: R,
    operation: (T, R) -> R,
): R = items.foldRight(initial, operation)

// Example: build a description string from right to left
fun describeFromEnd(items: List<String>): String =
    items.foldRight(StringBuilder()) { item, acc ->
        acc.append(item).append(" -> ")
    }.toString().removeSuffix(" -> ")

// Usage:
// describeFromEnd(listOf("first", "second", "third"))
// "third -> second -> first"'''
)

add(
    'Write a Kotlin function that produces a sliding window over a list — each window of size N.',
    '''fun <T> slidingWindow(items: List<T>, windowSize: Int): List<List<T>> {
    require(windowSize > 0) { "Window size must be positive" }
    return (0..items.size - windowSize).map { start ->
        items.subList(start, start + windowSize)
    }
}

// Usage:
// slidingWindow(listOf(1, 2, 3, 4, 5), 3)
// [[1, 2, 3], [2, 3, 4], [3, 4, 5]]'''
)

add(
    'Write a Kotlin function that computes the cartesian product of two lists.',
    '''fun <A, B> cartesianProduct(first: List<A>, second: List<B>): List<Pair<A, B>> =
    first.flatMap { a -> second.map { b -> a to b } }

// Generic version for multiple lists using recursion:
fun <T> cartesianProduct(lists: List<List<T>>): List<List<T>> {
    if (lists.isEmpty()) return listOf(emptyList())
    val rest = cartesianProduct(lists.drop(1))
    return lists.first().flatMap { head -> rest.map { tail -> listOf(head) + tail } }
}'''
)

add(
    'Write a Kotlin function that returns the top-K largest elements from a list without sorting the entire list.',
    '''import java.util.PriorityQueue

fun <T : Comparable<T>> topK(items: List<T>, k: Int): List<T> {
    require(k >= 0) { "k must be non-negative" }
    if (k >= items.size) return items.sortedDescending()
    val heap = PriorityQueue<T>(k)
    items.forEach { item ->
        if (heap.size < k) {
            heap.add(item)
        } else if (item > heap.peek()) {
            heap.poll()
            heap.add(item)
        }
    }
    return heap.toList().sortedDescending()
}'''
)

# --- Null-safety and Error Handling (5) ---

add(
    'Compare requireNotNull and checkNotNull in Kotlin. Show examples of when to use each.',
    '''// requireNotNull — for invalid arguments
fun setUsername(name: String?) {
    val trimmed = requireNotNull(name) { "Username must not be null" }
    // use trimmed...
}

// checkNotNull — for illegal state
class UserRepository(private val db: Database?) {
    fun getUser(id: String): User {
        val database = checkNotNull(db) { "Database not initialized" }
        return database.query(id)
    }
}

// Difference: requireNotNull throws IllegalArgumentException, checkNotNull throws IllegalStateException'''
)

add(
    'Show Kotlin nullable chaining with map for safe property access on nullable objects.',
    '''data class Address(val city: String?)
data class Company(val address: Address?)
data class Employee(val company: Company?)

fun getCity(employee: Employee?): String? =
    employee?.company?.address?.city

// Using map for transformations:
fun getCityUpper(employee: Employee?): String? =
    employee.map { it.company }.map { it.address }.map { it.city }.map { it.uppercase() }

fun <T, R> T?.map(transform: (T) -> R?): R? = this?.let(transform)'''
)

add(
    'Show Kotlin runCatching with recover pattern for fallback values on failure.',
    '''fun safeDivide(a: Int, b: Int): Result<Int> = runCatching {
    a / b
}.recover { exception ->
    when (exception) {
        is ArithmeticException -> 0
        else -> throw exception
    }
}

// Chain recover with logging:
fun fetchWithFallback(id: String): Result<String> =
    fetchFromCache(id).recoverCatching {
        log.info("Cache miss for $id, fetching from network")
        fetchFromNetwork(id).getOrThrow()
    }'''
)

add(
    'Create Kotlin Result extension functions onSuccess and onFailure for fluent error handling chains.',
    '''inline fun <T> Result<T>.onSuccess(
    action: (value: T) -> Unit,
): Result<T> {
    if (isSuccess) action(getOrThrow())
    return this
}

inline fun <T> Result<T>.onFailure(
    action: (exception: Throwable) -> Unit,
): Result<T> {
    if (isFailure) exceptionOrNull()?.let(action)
    return this
}

inline fun <T, R> Result<T>.mapCatching(
    transform: (value: T) -> R,
): Result<R> = runCatching {
    transform(getOrThrow())
}'''
)

add(
    'Create a Kotlin sealed error hierarchy for domain-level error handling.',
    '''sealed class DomainError {
    abstract val message: String

    data class NotFound(val resource: String, val id: String) : DomainError() {
        override val message: String = "$resource with id '$id' not found"
    }

    data class ValidationError(val field: String, val reason: String) : DomainError() {
        override val message: String = "Validation failed on '$field': $reason"
    }

    data class Unauthorized(val detail: String) : DomainError() {
        override val message: String = "Unauthorized: $detail"
    }

    data class NetworkUnavailable(val cause: Throwable? = null) : DomainError() {
        override val message: String = "Network unavailable"
    }
}

fun DomainError.toResult(): Result<Nothing> = Result.failure(DomainException(this))

class DomainException(val error: DomainError) : Exception(error.message)'''
)

# --- Extensions (5) ---

add(
    'Write a Kotlin String extension function toSlug that converts a title to a URL-safe slug.',
    '''fun String.toSlug(): String = lowercase()
    .replace(Regex("[^a-z0-9\\s-]"), "")
    .replace(Regex("\\s+"), "-")
    .replace(Regex("-+"), "-")
    .trim('-')

// Usage:
// "Hello World! Kotlin is Great".toSlug() // "hello-world-kotlin-is-great"'''
)

add(
    'Write a Kotlin Iterable extension function partitionN that splits a collection into N roughly equal parts.',
    '''fun <T> Iterable<T>.partitionN(partCount: Int): List<List<T>> {
    require(partCount > 0) { "Part count must be positive" }
    val items = toList()
    if (items.isEmpty()) return emptyList()
    return items.chunked(
        size = (items.size + partCount - 1) / partCount,
    )
}

// Usage:
// listOf(1, 2, 3, 4, 5, 6, 7).partitionN(3)
// [[1, 2, 3], [4, 5], [6, 7]]'''
)

add(
    'Write a Kotlin Flow extension debounceUntilChanged that combines debouncing with distinct filtering.',
    '''import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged

fun <T> Flow<T>.debounceUntilChanged(timeoutMs: Long): Flow<T> =
    distinctUntilChanged().debounce(timeoutMs)

// Or: debounce first, then filter duplicates
fun <T> Flow<T>.debounceThenDistinct(timeoutMs: Long): Flow<T> =
    debounce(timeoutMs).distinctUntilChanged()'''
)

add(
    'Write a Kotlin Throwable extension property rootCause that traverses the cause chain to find the original exception.',
    '''val Throwable.rootCause: Throwable
    get() {
        var current = this
        val seen = mutableSetOf<Throwable>()
        while (true) {
            val cause = current.cause ?: break
            if (cause in seen) break
            seen.add(current)
            current = cause
        }
        return current
    }'''
)

add(
    'Write Kotlin LocalDate formatting extensions for common patterns like ISO date, readable date, and relative time.',
    '''import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

fun LocalDate.toIsoString(): String = format(DateTimeFormatter.ISO_LOCAL_DATE)

fun LocalDate.toReadableString(): String =
    format(DateTimeFormatter.ofPattern("MMMM d, yyyy"))

fun LocalDate.daysUntil(other: LocalDate): Long =
    ChronoUnit.DAYS.between(this, other)

fun LocalDate.relativeTo(other: LocalDate): String = when {
    this == other -> "today"
    daysUntil(other) == 1L -> "yesterday"
    daysUntil(other) == -1L -> "tomorrow"
    daysUntil(other) > 0 -> "${daysUntil(other)} days ago"
    else -> "in ${-daysUntil(other)} days"
}'''
)

# ============================================================
# Write dataset.jsonl
# ============================================================

assert len(examples) == 60, f"Expected 60 examples, got {len(examples)}"

with open("/home/sergun/projects/ai-adv-challenge/data/dataset.jsonl", "w") as f:
    for i, ex in enumerate(examples):
        if i > 0:
            f.write("\n")
        f.write(json.dumps(ex, ensure_ascii=False))

print(f"Written {len(examples)} examples")

# Split into train (48) and eval (12)
with open("/home/sergun/projects/ai-adv-challenge/data/train.jsonl", "w") as f:
    for i, ex in enumerate(examples[:48]):
        if i > 0:
            f.write("\n")
        f.write(json.dumps(ex, ensure_ascii=False))

with open("/home/sergun/projects/ai-adv-challenge/data/eval.jsonl", "w") as f:
    for i, ex in enumerate(examples[48:]):
        if i > 0:
            f.write("\n")
        f.write(json.dumps(ex, ensure_ascii=False))

print("Train: 48, Eval: 12")
