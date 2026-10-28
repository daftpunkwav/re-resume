/**
 * @file time
 * @description Relative labels for conversation rows. Stored timestamps are UTC
 * ISO strings; the label is the local reading a person expects from a chat list.
 */

import type { DateTime } from '../../../domain/shared/DateTime'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** The compact "刚刚 / 12 分钟前 / 昨天" label the sidebar shows. */
export function formatRelativeTime(value: DateTime, now: Date = new Date()): string {
  const then = new Date(value)
  const elapsed = now.getTime() - then.getTime()
  if (!Number.isFinite(elapsed)) return ''
  if (elapsed < MINUTE) return '刚刚'
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE).toString()} 分钟前`
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR).toString()} 小时前`
  const days = Math.floor(elapsed / DAY)
  if (days === 1) return '昨天'
  if (days < 7) return `${days.toString()} 天前`
  if (days < 30) return `${Math.floor(days / 7).toString()} 周前`
  return `${then.getFullYear().toString()}-${String(then.getMonth() + 1).padStart(2, '0')}-${String(then.getDate()).padStart(2, '0')}`
}
