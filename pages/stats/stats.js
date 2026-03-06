const db = wx.cloud.database()
const _ = db.command
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    mode: 'week',
    periodTitle: '',
    isLatest: true,
    totalDays: 0,
    totalDuration: '',
    avgDuration: '',
    dayList: []
  },

  _offset: 0,

  onShow() {
    this._offset = 0
    this.refresh()
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (mode === this.data.mode) return
    this._offset = 0
    this.setData({ mode })
    this.refresh()
  },

  onPrev() {
    this._offset--
    this.refresh()
  },

  onNext() {
    if (this.data.isLatest) return
    this._offset++
    this.refresh()
  },

  async refresh() {
    const dates = this.data.mode === 'week' ? this.getWeekDates() : this.getMonthDates()
    const isLatest = this._offset >= 0
    const startDate = dates[0]
    const endDate = dates[dates.length - 1]

    try {
      const res = await db.collection('daily_records')
        .where({
          date: _.gte(startDate).and(_.lte(endDate))
        })
        .orderBy('date', 'asc')
        .limit(31)
        .get()

      // date -> records 映射
      const recordMap = {}
      res.data.forEach(item => {
        recordMap[item.date] = item.records
      })

      const dayList = []
      let totalSeconds = 0
      let totalDays = 0

      dates.forEach(dateKey => {
        const records = recordMap[dateKey] || []
        const d = this.parseDateKey(dateKey)
        const weekday = '周' + WEEKDAYS[d.getDay()]
        let duration = '--'
        if (records.length > 0) {
          const seconds = this.calcSeconds(records[0], records[records.length - 1])
          duration = this.formatDuration(seconds)
          totalSeconds += seconds
          totalDays++
        }
        dayList.push({ date: dateKey.slice(5), weekday, duration })
      })

      this.setData({
        periodTitle: this.getPeriodTitle(dates),
        isLatest,
        totalDays,
        totalDuration: this.formatDuration(totalSeconds),
        avgDuration: totalDays > 0 ? this.formatDuration(Math.floor(totalSeconds / totalDays)) : '0秒',
        dayList
      })
    } catch (err) {
      console.error('refresh error:', err)
    }
  },

  getWeekDates() {
    const today = new Date()
    today.setDate(today.getDate() + this._offset * 7)
    const day = today.getDay()
    const monday = new Date(today)
    monday.setDate(today.getDate() - (day === 0 ? 6 : day - 1))

    const dates = []
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday)
      d.setDate(monday.getDate() + i)
      dates.push(this.formatDateKey(d))
    }
    return dates
  },

  getMonthDates() {
    const today = new Date()
    const year = today.getFullYear()
    const month = today.getMonth() + this._offset
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    const dates = []
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(firstDay.getFullYear(), firstDay.getMonth(), d)
      dates.push(this.formatDateKey(date))
    }
    return dates
  },

  getPeriodTitle(dates) {
    if (this.data.mode === 'week') {
      return dates[0].slice(5) + ' ~ ' + dates[6].slice(5)
    }
    const d = this.parseDateKey(dates[0])
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月'
  },

  formatDateKey(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  },

  parseDateKey(key) {
    const [y, m, d] = key.split('-').map(Number)
    return new Date(y, m - 1, d)
  },

  calcSeconds(start, end) {
    const toSec = t => {
      const [h, m, s] = t.split(':').map(Number)
      return h * 3600 + m * 60 + s
    }
    const diff = toSec(end) - toSec(start)
    return diff > 0 ? diff : 0
  },

  formatDuration(seconds) {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    if (h > 0) return h + '时' + m + '分' + s + '秒'
    if (m > 0) return m + '分' + s + '秒'
    return s + '秒'
  }
})