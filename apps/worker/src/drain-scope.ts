const queues = ['audit', 'fix', 'verify-fix', 'verify', 'confirm-verify', 'poll-ai'] as const
type Queue = (typeof queues)[number]

/** Validate before connecting, so a typo cannot silently drain unrelated work. */
export function drainScope(value = 'all') {
  const selected = value === 'crawl' ? 'audit' : value
  if (selected !== 'all' && !queues.some((queue) => queue === selected))
    throw new Error(`Unknown worker queue: ${value}`)
  const includes = (queue: Queue) => selected === 'all' || selected === queue
  return {
    selected,
    includes,
    async run(queue: Queue, work: () => Promise<{ completed: number; failed: number }>) {
      return includes(queue) ? work() : { completed: 0, failed: 0 }
    },
  }
}
