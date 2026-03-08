const db = wx.cloud.database()
const _ = db.command
const { getDayType } = require('../../utils/holidays')

Page({
  data: {
    monthTitle: '',
    weekDays: ['一', '二', '三', '四', '五', '六', '日'],
    calendarDays: [],
    isCurrentMonth: true,
    workDays: 0,
    overtimeDays: 0,
    leaveDays: 0,
    absentDays: 0
  },

  _offset: 0,

  onLoad() {
    this._offset = 0
  },

  onShow() {
    this.refresh()
  },

  onPrevMonth() {
    this._offset--
    this.refresh()
  },

  onNextMonth() {
    if (this._offset >= 0) return
    this._offset++
    this.refresh()
  },

  async refresh() {
    const pending = getApp()._pendingClockIn
    if (pending) await pending

    const today = new Date()
    const target = new Date(today.getFullYear(), today.getMonth() + this._offset, 1)
    const year = target.getFullYear()
    const month = target.getMonth()
    const isCurrentMonth = this._offset >= 0
    const monthTitle = year + '年' + (month + 1) + '月'

    const lastDay = new Date(year, month + 1, 0).getDate()
    // Monday-based weekday: 0=Mon … 6=Sun
    let startWd = target.getDay() - 1
    if (startWd < 0) startWd = 6
    const totalCells = Math.ceil((startWd + lastDay) / 7) * 7

    const todayKey = this.fmtDate(today)
    const origin = new Date(year, month, 1 - startWd)
    const cells = []
    for (let i = 0; i < totalCells; i++) {
      const d = new Date(origin)
      d.setDate(origin.getDate() + i)
      const dk = this.fmtDate(d)
      cells.push({
        dateKey: dk,
        day: d.getDate(),
        inMonth: d.getMonth() === month,
        isToday: dk === todayKey,
        dayType: getDayType(dk),
        hasRecords: false,
        status: null,
        indicator: '',
        indicatorClass: ''
      })
    }

    const rangeStart = cells[0].dateKey
    const rangeEnd = cells[cells.length - 1].dateKey

    try {
      const res = await db.collection('daily_records')
        .where({ date: _.gte(rangeStart).and(_.lte(rangeEnd)) })
        .orderBy('date', 'asc')
        .limit(50)
        .get()

      const recordMap = {}
      const statusMap = {}
      res.data.forEach(item => {
        const prev = recordMap[item.date]
        recordMap[item.date] = prev ? prev.concat(item.records || []) : (item.records || [])
        if (item.status) statusMap[item.date] = item.status
      })

      let workDays = 0, overtimeDays = 0, leaveDays = 0, absentDays = 0

      cells.forEach(cell => {
        const records = recordMap[cell.dateKey] || []
        const status = statusMap[cell.dateKey] || null
        cell.hasRecords = records.length > 0
        cell.status = status

        const isFuture = cell.dateKey > todayKey
        const isHolidayOrRest = cell.dayType === 'holiday' || cell.dayType === 'restday'

        if (isFuture) {
          if (cell.dayType === 'holiday') {
            cell.indicator = '假'
            cell.indicatorClass = 'holiday'
          } else if (cell.dayType === 'restday') {
            cell.indicator = '休'
            cell.indicatorClass = 'rest'
          }
        } else if (status === 'leave') {
          cell.indicator = '请假'
          cell.indicatorClass = 'leave'
          if (cell.inMonth) leaveDays++
        } else if (status === 'absent') {
          cell.indicator = '缺勤'
          cell.indicatorClass = 'absent'
          if (cell.inMonth) absentDays++
        } else if (cell.hasRecords && isHolidayOrRest) {
          cell.indicator = '加班'
          cell.indicatorClass = 'overtime'
          if (cell.inMonth) overtimeDays++
        } else if (cell.hasRecords) {
          cell.indicator = '●'
          cell.indicatorClass = 'checked'
          if (cell.inMonth) workDays++
        } else if (cell.dayType === 'holiday') {
          cell.indicator = '假'
          cell.indicatorClass = 'holiday'
        } else if (cell.dayType === 'restday') {
          cell.indicator = '休'
          cell.indicatorClass = 'rest'
        }
      })

      this.setData({
        monthTitle,
        calendarDays: cells,
        isCurrentMonth,
        workDays,
        overtimeDays,
        leaveDays,
        absentDays
      })
    } catch (err) {
      console.error('calendar refresh error:', err)
    }
  },

  onDayTap(e) {
    const dk = e.currentTarget.dataset.datekey
    const cell = this.data.calendarDays.find(c => c.dateKey === dk)
    if (!cell || !cell.inMonth) return
    if (dk > this.fmtDate(new Date())) return

    if (cell.hasRecords) {
      getApp()._navigateToDate = dk
      wx.switchTab({ url: '/pages/index/index' })
    } else if (cell.dayType === 'workday' && !cell.status) {
      this.showStatusPicker(dk)
    }
  },

  onDayLongpress(e) {
    const dk = e.currentTarget.dataset.datekey
    const cell = this.data.calendarDays.find(c => c.dateKey === dk)
    if (!cell || !cell.inMonth || !cell.status) return

    const label = cell.status === 'leave' ? '请假' : '缺勤'
    wx.showModal({
      title: '清除标记',
      content: `确定清除 ${dk} 的${label}标记？`,
      confirmColor: '#e64340',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const qr = await db.collection('daily_records')
            .where({ date: dk })
            .get()
          if (qr.data.length > 0) {
            const doc = qr.data[0]
            if (doc.records && doc.records.length > 0) {
              await db.collection('daily_records').doc(doc._id).update({
                data: { status: _.remove() }
              })
            } else {
              await db.collection('daily_records').doc(doc._id).remove()
            }
          }
          this.refresh()
          wx.showToast({ title: '已清除', icon: 'success' })
        } catch (err) {
          console.error('clear status error:', err)
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  },

  showStatusPicker(dk) {
    wx.showActionSheet({
      itemList: ['请假', '缺勤'],
      success: async (res) => {
        const status = res.tapIndex === 0 ? 'leave' : 'absent'
        try {
          const qr = await db.collection('daily_records')
            .where({ date: dk })
            .get()
          if (qr.data.length > 0) {
            await db.collection('daily_records').doc(qr.data[0]._id).update({
              data: { status }
            })
          } else {
            await db.collection('daily_records').add({
              data: { date: dk, records: [], status }
            })
          }
          this.refresh()
          wx.showToast({ title: '标记成功', icon: 'success' })
        } catch (err) {
          console.error('set status error:', err)
          wx.showToast({ title: '操作失败', icon: 'none' })
        }
      }
    })
  },

  fmtDate(date) {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
})
