package com.diaryai.data.repository

import com.diaryai.data.local.dao.DiaryEntryDao
import com.diaryai.data.mapper.DiaryEntryDtoToDomainMapper
import com.diaryai.domain.model.DiaryEntry
import com.diaryai.domain.repository.DiaryEntryRepository

class DiaryEntryRepositoryImpl(
    private val dao: DiaryEntryDao,
    private val mapper: DiaryEntryDtoToDomainMapper,
) : DiaryEntryRepository {

    override suspend fun getEntries(): Result<List<DiaryEntry>> = runCatching {
        dao.getAll().map(mapper::map)
    }

    override suspend fun getById(id: String): Result<DiaryEntry> {
        val dto = dao.getById(id)
            ?: return Result.failure(NoSuchElementException("DiaryEntry with id '$id' not found"))
        return runCatching { mapper.map(dto) }
    }

    override suspend fun saveEntry(entry: DiaryEntry): Result<Unit> = runCatching {
        dao.insert(mapper.mapReverse(entry))
    }

    override suspend fun deleteEntry(id: String): Result<Unit> = runCatching {
        dao.delete(id)
    }
}
