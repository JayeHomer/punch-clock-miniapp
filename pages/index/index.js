const db = wx.cloud.database()
const _ = db.command

const _hours = Array.from({length: 24}, (_, i) => String(i).padStart(2, '0'))
const _mins = Array.from({length: 60}, (_, i) => String(i).padStart(2, '0'))
const _secs = Array.from({length: 60}, (_, i) => String(i).padStart(2, '0'))

Page({
  data: {
    currentDate: '',
    isToday: true,
    isYesterday: false,
    records: [],
    firstTime: '',
    lastTime: '',
    duration: '',
    timePickerRange: [_hours, _mins, _secs]
  },

  _viewDate: null,
  _todayDocId: null,
  _clockingIn: false,

  onLoad() {
    this._viewDate = new Date()
  },

  onShow() {
    this.loadDate()
  },

  formatDateKey(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  formatTime(date) {
    const h = String(date.getHours()).padStart(2, '0')
    const m = String(date.getMinutes()).padStart(2, '0')
    const s = String(date.getSeconds()).padStart(2, '0')
    return `${h}:${m}:${s}`
  },

  getTodayKey() {
    return this.formatDateKey(new Date())
  },

  async loadDate() {
    const dateKey = this.formatDateKey(this._viewDate)
    const todayKey = this.getTodayKey()
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const yesterdayKey = this.formatDateKey(yesterday)

    try {
      const res = await db.collection('daily_records')
        .where({ date: dateKey })
        .get()
      const primaryDoc = res.data.length > 0 ? res.data[0] : null
      let records = primaryDoc ? primaryDoc.records || [] : []

      // Auto-cleanup duplicate documents
      if (res.data.length > 1) {
        records = []
        res.data.forEach(d => { records = records.concat(d.records || []) })
        records.sort()
        const extras = []
        for (let i = 1; i < res.data.length; i++) {
          extras.push(...(res.data[i].records || []))
          db.collection('daily_records').doc(res.data[i]._id).remove().catch(console.error)
        }
        if (extras.length > 0) {
          db.collection('daily_records').doc(primaryDoc._id).update({
            data: { records: _.push(extras) }
          }).catch(console.error)
        }
      }

      if (dateKey === todayKey) this._todayDocId = primaryDoc ? primaryDoc._id : null
      this.setData({
        currentDate: dateKey,
        todayKey,
        isToday: dateKey === todayKey,
        isYesterday: dateKey === yesterdayKey,
        records
      })
      this.updateStats(records)
    } catch (err) {
      console.error('loadDate error:', err)
      this.setData({
        currentDate: dateKey,
        todayKey,
        isToday: dateKey === todayKey,
        isYesterday: dateKey === yesterdayKey,
        records: []
      })
      this.updateStats([])
    }
  },

  onPrevDay() {
    this._viewDate.setDate(this._viewDate.getDate() - 1)
    this.loadDate()
  },

  onNextDay() {
    if (this.formatDateKey(this._viewDate) >= this.getTodayKey()) return
    this._viewDate.setDate(this._viewDate.getDate() + 1)
    this.loadDate()
  },

  onPickDate(e) {
    const dateKey = e.detail.value
    const [y, m, d] = dateKey.split('-').map(Number)
    this._viewDate = new Date(y, m - 1, d)
    this.loadDate()
  },

  async onClockIn() {
    if (this._clockingIn) return
    this._clockingIn = true
    const dateKey = this.getTodayKey()
    const now = this.formatTime(new Date())

    // Optimistic UI: update display immediately
    const newRecords = this.data.records.concat(now)
    this.setData({ records: newRecords })
    this.updateStats(newRecords)
    wx.showToast({ title: '打卡成功', icon: 'success' })

    // Write to DB, store promise for cross-page sync
    const p = this._writeToDB(dateKey, now)
    getApp()._pendingClockIn = p
    await p
    getApp()._pendingClockIn = null
    this._clockingIn = false
  },

  async _writeToDB(dateKey, now) {
    try {
      if (this._todayDocId) {
        await db.collection('daily_records').doc(this._todayDocId).update({
          data: { records: _.push([now]) }
        })
      } else {
        const res = await db.collection('daily_records')
          .where({ date: dateKey })
          .get()
        if (res.data.length > 0) {
          this._todayDocId = res.data[0]._id
          await db.collection('daily_records').doc(this._todayDocId).update({
            data: { records: _.push([now]) }
          })
        } else {
          const addRes = await db.collection('daily_records').add({
            data: { date: dateKey, records: [now] }
          })
          this._todayDocId = addRes._id
        }
      }
    } catch (err) {
      console.error('onClockIn error:', err)
      wx.showToast({ title: '打卡失败', icon: 'none' })
      this.loadDate()
    }
  },

  async onManualRecord(e) {
    const [hi, mi, si] = e.detail.value
    const time = `${_hours[hi]}:${_mins[mi]}:${_secs[si]}`
    const dateKey = this.formatDateKey(this._viewDate)

    if (this.data.records.includes(time)) {
      wx.showToast({ title: '该时间已有记录', icon: 'none' })
      return
    }

    try {
      const res = await db.collection('daily_records')
        .where({ date: dateKey })
        .get()

      if (res.data.length > 0) {
        const doc = res.data[0]
        const newRecords = [...doc.records, time].sort()
        await db.collection('daily_records').doc(doc._id).update({
          data: { records: newRecords }
        })
      } else {
        await db.collection('daily_records').add({
          data: { date: dateKey, records: [time] }
        })
      }

      await this.loadDate()
      wx.showToast({ title: '补录成功', icon: 'success' })
    } catch (err) {
      console.error('onManualRecord error:', err)
      wx.showToast({ title: '补录失败', icon: 'none' })
    }
  },

  updateStats(records) {
    if (records.length === 0) {
      this.setData({ firstTime: '', lastTime: '', duration: '' })
      return
    }
    const firstTime = records[0]
    const lastTime = records[records.length - 1]
    const duration = this.calcDuration(firstTime, lastTime)
    this.setData({ firstTime, lastTime, duration })
  },

  async onDeleteRecord(e) {
    const index = e.currentTarget.dataset.index
    const time = this.data.records[index]
    const res = await wx.showModal({
      title: '确认删除',
      content: `确定删除 ${time} 的打卡记录？`,
      confirmColor: '#e64340'
    })
    if (!res.confirm) return

    const dateKey = this.formatDateKey(this._viewDate)
    try {
      const queryRes = await db.collection('daily_records')
        .where({ date: dateKey })
        .get()
      if (queryRes.data.length === 0) return

      const doc = queryRes.data[0]
      const newRecords = [...doc.records]
      newRecords.splice(index, 1)

      if (newRecords.length === 0) {
        await db.collection('daily_records').doc(doc._id).remove()
        if (dateKey === this.getTodayKey()) this._todayDocId = null
      } else {
        await db.collection('daily_records').doc(doc._id).update({
          data: { records: newRecords }
        })
      }

      await this.loadDate()
      wx.showToast({ title: '已删除', icon: 'success' })
    } catch (err) {
      console.error('onDeleteRecord error:', err)
      wx.showToast({ title: '删除失败', icon: 'none' })
    }
  },

  async onClearDay() {
    const dateKey = this.formatDateKey(this._viewDate)
    const res = await wx.showModal({
      title: '确认清除',
      content: `确定清除 ${dateKey} 的所有打卡记录？此操作不可恢复`,
      confirmColor: '#e64340'
    })
    if (!res.confirm) return

    try {
      const queryRes = await db.collection('daily_records')
        .where({ date: dateKey })
        .get()
      const tasks = queryRes.data.map(doc =>
        db.collection('daily_records').doc(doc._id).remove()
      )
      await Promise.all(tasks)

      if (dateKey === this.getTodayKey()) {
        this._todayDocId = null
      }
      await this.loadDate()
      wx.showToast({ title: '已清除', icon: 'success' })
    } catch (err) {
      console.error('onClearDay error:', err)
      wx.showToast({ title: '清除失败', icon: 'none' })
    }
  },

  calcDuration(start, end) {
    const toSeconds = t => {
      const [h, m, s] = t.split(':').map(Number)
      return h * 3600 + m * 60 + s
    }
    let diff = toSeconds(end) - toSeconds(start)
    if (diff < 0) diff = 0
    const h = Math.floor(diff / 3600)
    const m = Math.floor((diff % 3600) / 60)
    const s = diff % 60
    if (h > 0) return `${h}小时${m}分${s}秒`
    if (m > 0) return `${m}分${s}秒`
    return `${s}秒`
  }
})