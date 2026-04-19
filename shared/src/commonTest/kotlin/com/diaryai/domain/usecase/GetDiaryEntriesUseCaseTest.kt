package com.diaryai.domain.usecase

import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.model.Mood
import com.diaryai.domain.repository.DiaryEntryRepository
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class GetDiaryEntriesUseCaseTest {

    // Stub repository returning 2 entries for use-case tests.

    private val repo = object : DiaryEntryRepository {
        override suspend fun getEntries(): Result<List<DiaryEntry>> =
            Result.success(
                listOf(
                    DiaryEntry(id = "1", content = "Good day", date = 1000L, mood = Mood.GOOD),
                    DiaryEntry(id = "2", content = "Bad day", date = 2000L, mood = Mood.BAD),
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
        assertEquals(2, result.getOrThrow().size)
    }

    @Test
    fun `returns entries with correct content`() = runTest {
        val result = useCase()
        val entries = result.getOrThrow()
        assertEquals("Good day", entries.first().content)
    }
}
