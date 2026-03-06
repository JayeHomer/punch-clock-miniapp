const db = wx.cloud.database()
const _ = db.command

Page({
  data: {
    currentDate: '',
    isToday: true,
    isYesterday: false,
    records: [],
    firstTime: '',
    lastTime: '',
    duration: ''
  },

  _viewDate: null,

  onShow() {
    this._viewDate = new Date()
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
      const records = res.data.length > 0 ? res.data[0].records : []
      this.setData({
        currentDate: dateKey,
        isToday: dateKey === todayKey,
        isYesterday: dateKey === yesterdayKey,
        records
      })
      this.updateStats(records)
    } catch (err) {
      console.error('loadDate error:', err)
      this.setData({
        currentDate: dateKey,
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
    if (this.data.isToday) return
    this._viewDate.setDate(this._viewDate.getDate() + 1)
    this.loadDate()
  },

  onPickDate() {
    const todayKey = this.getTodayKey()
    wx.showModal({
      title: '选择日期',
      editable: true,
      placeholderText: '格式：2026-03-06',
      success: res => {
        if (!res.confirm || !res.content) return
        const match = res.content.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
        if (!match) {
          wx.showToast({ title: '日期格式错误', icon: 'none' })
          return
        }
        const d = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
        if (this.formatDateKey(d) > todayKey) {
          wx.showToast({ title: '不能选未来日期', icon: 'none' })
          return
        }
        this._viewDate = d
        this.loadDate()
      }
    })
  },

  async onClockIn() {
    const dateKey = this.getTodayKey()
    const now = this.formatTime(new Date())

    try {
      const res = await db.collection('daily_records')
        .where({ date: dateKey })
        .get()

      if (res.data.length > 0) {
        await db.collection('daily_records').doc(res.data[0]._id).update({
          data: { records: _.push([now]) }
        })
      } else {
        await db.collection('daily_records').add({
          data: { date: dateKey, records: [now] }
        })
      }

      await this.loadDate()
      wx.showToast({ title: '打卡成功', icon: 'success' })
    } catch (err) {
      console.error('onClockIn error:', err)
      wx.showToast({ title: '打卡失败', icon: 'none' })
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