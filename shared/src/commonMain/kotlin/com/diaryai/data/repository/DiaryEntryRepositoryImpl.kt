package com.diaryai.data.repository

import com.diaryai.data.local.dao.DiaryEntryDao
import com.diaryai.data.mapper.DiaryEntryDtoToDomainMapper
import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.repository.DiaryEntryRepository
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class DiaryEntryRepositoryImpl(
    private val dao: DiaryEntryDao,
    private val mapper: DiaryEntryDtoToDomainMapper,
) : DiaryEntryRepository {

    override suspend fun getEntries(): Result<List<DiaryEntry>> = runCatching {
        withContext(Dispatchers.Default) { dao.getAll() }.map { mapper.map(it).getOrThrow() }
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
}
