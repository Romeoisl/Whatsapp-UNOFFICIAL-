const fs = require('fs')
const path = require('path')

// Small append-only local message database. It avoids a native SQLite dependency,
// which keeps Catalina/Intel builds easier to install and update.
class LocalMessageStore {
  constructor(file, legacyFile) {
    this.file = file
    this.legacyFile = legacyFile
    this.index = new Map()
    this.dirtyBytes = 0
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this._load()
  }

  _load() {
    if (fs.existsSync(this.file)) {
      const lines = fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean)
      for (const line of lines) {
        try { this._apply(JSON.parse(line)) } catch (_) {}
      }
      return
    }
    if (this.legacyFile && fs.existsSync(this.legacyFile)) {
      try {
        const legacy = JSON.parse(fs.readFileSync(this.legacyFile, 'utf8'))
        for (const [jid, msgs] of Object.entries(legacy || {})) {
          for (const msg of msgs || []) this._apply({ op: 'upsert', jid, message: msg })
        }
        this.compact()
      } catch (_) {}
    }
  }

  _apply(record) {
    if (!record?.jid || !record?.message?.id) return
    if (!this.index.has(record.jid)) this.index.set(record.jid, new Map())
    const bucket = this.index.get(record.jid)
    if (record.op === 'delete') bucket.delete(record.message.id)
    else bucket.set(record.message.id, record.message)
  }

  _append(record) {
    const line = JSON.stringify(record) + '\n'
    fs.appendFileSync(this.file, line)
    this.dirtyBytes += Buffer.byteLength(line)
    this._apply(record)
    if (this.dirtyBytes > 4 * 1024 * 1024) this.compact()
  }

  upsert(jid, message) {
    if (!jid || !message?.id) return
    const safe = { ...message }
    delete safe.raw
    this._append({ op: 'upsert', jid, message: safe })
  }

  upsertMany(jid, messages) {
    for (const m of messages || []) this.upsert(jid, m)
  }

  list(jid, limit = 80) {
    const bucket = this.index.get(jid)
    if (!bucket) return []
    return Array.from(bucket.values()).sort((a, b) => a.timestamp - b.timestamp).slice(-limit)
  }

  all() {
    const out = []
    for (const [jid, bucket] of this.index) for (const message of bucket.values()) out.push({ jid, ...message })
    return out
  }

  search(query, jid = null) {
    const q = String(query || '').trim().toLowerCase()
    if (!q) return []
    const entries = jid ? [[jid, this.index.get(jid) || new Map()]] : this.index.entries()
    const out = []
    for (const [chatJid, bucket] of entries) {
      for (const message of bucket.values()) {
        const hay = `${message.text || ''} ${message.caption || ''} ${message.kind || ''}`.toLowerCase()
        if (hay.includes(q)) out.push({ ...message, jid: chatJid })
      }
    }
    return out.sort((a, b) => b.timestamp - a.timestamp).slice(0, 200)
  }

  compact() {
    const tmp = this.file + '.tmp'
    const fd = fs.openSync(tmp, 'w')
    try {
      for (const [jid, bucket] of this.index) {
        for (const message of bucket.values()) {
          fs.writeSync(fd, JSON.stringify({ op: 'upsert', jid, message: { ...message, raw: undefined } }) + '\n')
        }
      }
    } finally { fs.closeSync(fd) }
    fs.renameSync(tmp, this.file)
    this.dirtyBytes = 0
  }

  exportData() {
    return {
      schema: 2,
      exportedAt: new Date().toISOString(),
      messages: this.all()
    }
  }
}

module.exports = LocalMessageStore
