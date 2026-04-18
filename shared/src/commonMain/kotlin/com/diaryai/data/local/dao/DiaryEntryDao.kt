package com.diaryai.data.local.dao

import com.diaryai.data.local.dto.DiaryEntryDto

interface DiaryEntryDao {
    fun getAll(): List<DiaryEntryDto>
    fun getById(id: String): DiaryEntryDto?
    fun insert(dto: DiaryEntryDto)
    fun delete(id: String)
}
