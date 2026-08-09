const Store = {
  user: null,
  conn: 'idle',
  chats: [],
  contacts: [],
  messages: new Map(),
  presence: new Map(),
  starred: [],
  settings: {},
  schedules: [],
  filter: 'all',
  search: '',
  activeJid: null,
  typingTimers: new Map(),

  setChats(list) { this.chats = list || [] },
  setContacts(list) { this.contacts = list || [] },
  upsertMessages(jid, msgs) {
    if (!this.messages.has(jid)) this.messages.set(jid, [])
    const arr = this.messages.get(jid)
    for (const m of msgs) {
      const i = arr.findIndex((x) => x.id === m.id)
      if (i >= 0) arr[i] = m
      else arr.push(m)
    }
    arr.sort((a, b) => a.timestamp - b.timestamp)
  },
  applyStatusUpdates(jid, updates) {
    const arr = this.messages.get(jid)
    if (!arr) return
    for (const u of updates) {
      const m = arr.find((x) => x.id === u.id)
      if (m) m.status = u.status
    }
  },
  messagesOf(jid) { return this.messages.get(jid) || [] },
  reset() {
    this.user = null; this.conn = 'idle'; this.chats = [];
    this.contacts = []; this.messages.clear(); this.presence.clear();
    this.activeJid = null; this.starred = [];
  },
}
window.Store = Store