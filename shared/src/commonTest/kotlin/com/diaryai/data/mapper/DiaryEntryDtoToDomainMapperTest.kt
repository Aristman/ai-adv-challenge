package com.diaryai.data.mapper

import com.diaryai.data.local.dto.DiaryEntryDto
import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.model.Mood
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DiaryEntryDtoToDomainMapperTest {

    private val mapper = DiaryEntryDtoToDomainMapper()

    // --- Test data ---
    private companion object {
        const val ID = "entry-1"
        const val CONTENT = "Great day today"
        const val DATE = 1_700_000_000_000L
        val TAGS = listOf("happy", "work", "exercise")
        const val AI_SUMMARY = "User had a productive and positive day."
    }

    private val fullDto = DiaryEntryDto(
        id = ID,
        content = CONTENT,
        date = DATE,
        mood = "GREAT",
        tags = TAGS,
        aiSummary = AI_SUMMARY,
    )

    private val fullEntry = DiaryEntry(
        id = ID,
        content = CONTENT,
        date = DATE,
        mood = Mood.GREAT,
        tags = TAGS,
        aiSummary = AI_SUMMARY,
    )

    // --- map (DTO → Domain) ---
    @Test
    fun `map converts full dto to domain entry`() {
        val result = mapper.map(fullDto)

        assertTrue(result.isSuccess)
        assertEquals(fullEntry, result.getOrThrow())
    }

    @Test
    fun `map converts dto with null mood to domain entry with null mood`() {
        val dto = fullDto.copy(mood = null)

        val result = mapper.map(dto)

        assertTrue(result.isSuccess)
        assertNull(result.getOrThrow().mood)
    }

    @Test
    fun `map converts dto with empty tags to domain entry with empty tags`() {
        val dto = fullDto.copy(tags = emptyList())

        val result = mapper.map(dto)

        assertTrue(result.isSuccess)
        assertEquals(emptyList<String>(), result.getOrThrow().tags)
    }

    @Test
    fun `map converts dto with null aiSummary to domain entry with null aiSummary`() {
        val dto = fullDto.copy(aiSummary = null)

        val result = mapper.map(dto)

        assertTrue(result.isSuccess)
        assertNull(result.getOrThrow().aiSummary)
    }

    @Test
    fun `map converts dto with minimal fields`() {
        val dto = DiaryEntryDto(id = "min", content = "hello", date = 0L)

        val result = mapper.map(dto)

        assertTrue(result.isSuccess)
        val entry = result.getOrThrow()
        assertEquals("min", entry.id)
        assertEquals("hello", entry.content)
        assertEquals(0L, entry.date)
        assertNull(entry.mood)
        assertEquals(emptyList<String>(), entry.tags)
        assertNull(entry.aiSummary)
    }

    @Test
    fun `map parses all valid mood values`() {
        Mood.entries.forEach { mood ->
            val dto = fullDto.copy(mood = mood.name)

            val result = mapper.map(dto)

            assertTrue(result.isSuccess)
            assertEquals(mood, result.getOrThrow().mood)
        }
    }

    @Test
    fun `map returns failure for invalid mood string`() {
        val dto = fullDto.copy(mood = "NOT_A_MOOD")

        val result = mapper.map(dto)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IllegalArgumentException)
    }

    @Test
    fun `map returns failure for empty mood string`() {
        val dto = fullDto.copy(mood = "")

        val result = mapper.map(dto)

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IllegalArgumentException)
    }

    // --- mapReverse (Domain → DTO) ---
    @Test
    fun `mapReverse converts full domain entry to dto`() {
        val result = mapper.mapReverse(fullEntry)

        assertEquals(fullDto, result)
    }

    @Test
    fun `mapReverse converts entry with null mood to dto with null mood`() {
        val entry = fullEntry.copy(mood = null)

        val result = mapper.mapReverse(entry)

        assertNull(result.mood)
    }

    @Test
    fun `mapReverse converts entry with empty tags to dto with empty tags`() {
        val entry = fullEntry.copy(tags = emptyList())

        val result = mapper.mapReverse(entry)

        assertEquals(emptyList<String>(), result.tags)
    }

    @Test
    fun `mapReverse converts entry with null aiSummary to dto with null aiSummary`() {
        val entry = fullEntry.copy(aiSummary = null)

        val result = mapper.mapReverse(entry)

        assertNull(result.aiSummary)
    }

    @Test
    fun `mapReverse converts minimal entry`() {
        val entry = DiaryEntry(id = "min", content = "hello", date = 0L)

        val result = mapper.mapReverse(entry)

        assertEquals("min", result.id)
        assertEquals("hello", result.content)
        assertEquals(0L, result.date)
        assertNull(result.mood)
        assertEquals(emptyList<String>(), result.tags)
        assertNull(result.aiSummary)
    }

    // --- Round-trip ---
    @Test
    fun `map then mapReverse round-trip preserves data`() {
        val result = mapper.mapReverse(mapper.map(fullDto).getOrThrow())

        assertEquals(fullDto, result)
    }

    @Test
    fun `mapReverse then map round-trip preserves data`() {
        val result = mapper.map(mapper.mapReverse(fullEntry))

        assertTrue(result.isSuccess)
        assertEquals(fullEntry, result.getOrThrow())
    }
}
