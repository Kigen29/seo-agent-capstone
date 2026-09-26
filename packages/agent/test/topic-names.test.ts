import { describe, expect, it } from 'vitest'
import { nameTopics, type TopicNamingLlm } from '../src/topic-names.js'

const answering = (clusters: { id: number; name: string }[]) =>
  ({ object: async () => ({ output: { clusters } }) }) as unknown as TopicNamingLlm

describe('nameTopics', () => {
  const clusters = [
    { id: 1, titles: ['Admissions', 'How to apply'] },
    { id: 2, titles: ['KCSE results 2025'] },
  ]

  it('keeps every usable name and drops only the one too long for the treemap', async () => {
    const names = await nameTopics(
      answering([
        { id: 1, name: '  School   admissions ' },
        { id: 2, name: 'x'.repeat(41) },
      ]),
      't',
      clusters,
    )
    expect([...names]).toEqual([[1, 'School admissions']])
  })

  it('ignores a group id nobody asked about', async () => {
    const names = await nameTopics(answering([{ id: 9, name: 'Invented' }]), 't', clusters)
    expect(names.size).toBe(0)
  })

  it('returns no names, never an error, when the call fails', async () => {
    const failing = {
      object: async () => {
        throw new Error('insufficient_quota')
      },
    } as unknown as TopicNamingLlm
    expect((await nameTopics(failing, 't', clusters)).size).toBe(0)
  })
})
