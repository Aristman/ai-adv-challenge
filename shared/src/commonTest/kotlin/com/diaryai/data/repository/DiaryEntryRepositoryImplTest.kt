package com.diaryai.data.repository

import com.diaryai.data.local.dao.DiaryEntryDao
import com.diaryai.data.local.dto.DiaryEntryDto
import com.diaryai.data.mapper.DiaryEntryDtoToDomainMapper
import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.model.Mood
import kotlinx.coroutines.test.runTest
import kotlin.requireNotNull
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class DiaryEntryRepositoryImplTest {

    // --- Test data ---
    private companion object {
        const val ENTRY_ID = "entry-1"
        const val ENTRY_CONTENT = "Today was a good day"
        const val ENTRY_DATE = 1_700_000_000_000L
        const val UNKNOWN_ID = "nonexistent"
    }

    private val testDto = DiaryEntryDto(
        id = ENTRY_ID,
        content = ENTRY_CONTENT,
        date = ENTRY_DATE,
        mood = "GOOD",
        tags = listOf("happy", "productive"),
        aiSummary = "A productive day.",
    )

    private val testEntry = DiaryEntry(
        id = ENTRY_ID,
        content = ENTRY_CONTENT,
        date = ENTRY_DATE,
        mood = Mood.GOOD,
        tags = listOf("happy", "productive"),
        aiSummary = "A productive day.",
    )

    // --- Dependencies (manual stubs, no MockK in project) ---
    private var daoGetAllResult: List<DiaryEntryDto> = emptyList()
    private var daoGetByIdResult: DiaryEntryDto? = null
    private var daoInsertCalledWith: DiaryEntryDto? = null
    private var daoDeleteCalledWith: String? = null

    private val dao = object : DiaryEntryDao {
        override fun getAll(): List<DiaryEntryDto> = daoGetAllResult
        override fun getById(id: String): DiaryEntryDto? = daoGetByIdResult
        override fun insert(dto: DiaryEntryDto) { daoInsertCalledWith = dto }
        override fun delete(id: String) { daoDeleteCalledWith = id }
    }

    private val mapper = DiaryEntryDtoToDomainMapper()
    private lateinit var repository: DiaryEntryRepositoryImpl

    private fun setup() {
        // Reset state
        daoGetAllResult = emptyList()
        daoGetByIdResult = null
        daoInsertCalledWith = null
        daoDeleteCalledWith = null
        repository = DiaryEntryRepositoryImpl(dao, mapper)
    }

    // --- getEntries ---
    @Test
    fun `getEntries returns mapped list when dao has entries`() = runTest {
        setup()
        daoGetAllResult = listOf(testDto)

        val result = repository.getEntries()

        assertTrue(result.isSuccess)
        val entries = result.getOrThrow()
        assertEquals(1, entries.size)
        assertEquals(testEntry, entries.first())
    }

    @Test
    fun `getEntries returns empty list when dao has no entries`() = runTest {
        setup()
        daoGetAllResult = emptyList()

        val result = repository.getEntries()

        assertTrue(result.isSuccess)
        assertTrue(result.getOrThrow().isEmpty())
    }

    @Test
    fun `getEntries returns failure when mapper throws`() = runTest {
        setup()
        // DTO with invalid mood that mapper can't parse — Mood.valueOf will throw
        val invalidDto = DiaryEntryDto(
            id = "x",
            content = "test",
            date = 0L,
            mood = "INVALID_MOOD",
        )
        daoGetAllResult = listOf(invalidDto)

        val result = repository.getEntries()

        assertTrue(result.isFailure)
    }

    // --- getById ---
    @Test
    fun `getById returns mapped entry when found`() = runTest {
        setup()
        daoGetByIdResult = testDto

        val result = repository.getById(ENTRY_ID)

        assertTrue(result.isSuccess)
        assertEquals(testEntry, result.getOrThrow())
    }

    @Test
    fun `getById returns failure when entry not found`() = runTest {
        setup()
        daoGetByIdResult = null

        val result = repository.getById(UNKNOWN_ID)

        assertTrue(result.isFailure)
        assertIs<NoSuchElementException>(result.exceptionOrNull())
        assertTrue(requireNotNull(result.exceptionOrNull()).message?.contains(UNKNOWN_ID) == true)
    }

    @Test
    fun `getById returns failure when mapper throws on invalid mood`() = runTest {
        setup()
        daoGetByIdResult = DiaryEntryDto(
            id = "x",
            content = "test",
            date = 0L,
            mood = "INVALID_MOOD",
        )

        val result = repository.getById("x")

        assertTrue(result.isFailure)
    }

    // --- saveEntry ---
    @Test
    fun `saveEntry inserts mapped dto via dao`() = runTest {
        setup()

        val result = repository.saveEntry(testEntry)

        assertTrue(result.isSuccess)
        assertEquals(testDto, daoInsertCalledWith)
    }

    @Test
    fun `saveEntry preserves null optional fields`() = runTest {
        setup()
        val minimalEntry = DiaryEntry(
            id = "minimal",
            content = "hello",
            date = 0L,
        )

        val result = repository.saveEntry(minimalEntry)

        assertTrue(result.isSuccess)
        assertEquals("minimal", daoInsertCalledWith?.id)
        assertEquals(null, daoInsertCalledWith?.mood)
        assertEquals(null, daoInsertCalledWith?.aiSummary)
        assertTrue(daoInsertCalledWith?.tags?.isEmpty() == true)
    }

    // --- deleteEntry ---
    @Test
    fun `deleteEntry delegates id to dao`() = runTest {
        setup()

        val result = repository.deleteEntry(ENTRY_ID)

        assertTrue(result.isSuccess)
        assertEquals(ENTRY_ID, daoDeleteCalledWith)
    }

    @Test
    fun `deleteEntry succeeds even for nonexistent id`() = runTest {
        setup()

        val result = repository.deleteEntry(UNKNOWN_ID)

        assertTrue(result.isSuccess)
        assertEquals(UNKNOWN_ID, daoDeleteCalledWith)
    }
}
