const api = {
  handlers: { 
    connection: [], chats: [], messages: [], 
    presence: [], settings: [], schedules: [], 
    call: [], outbox: []
  },

  async init() {
    const boot = await window.liquid.init()
    Store.user = boot.user
    Store.settings = boot.settings || {}
    Store.schedules = boot.schedules || []
    return boot
  },

  on(channel, cb) {
    if (!this.handlers[channel]) this.handlers[channel] = []
    this.handlers[channel].push(cb)
  },

  _emit(channel, data) {
    for (const cb of this.handlers[channel] || []) cb(data)
  },

  subscribe() {
    window.liquid.on('connection', (u) => {
      Store.conn = u.connection
      if (u.loggedOut) Store.reset()
      this._emit('connection', u)
    })
    window.liquid.on('chats', (list) => { Store.setChats(list); this._emit('chats', list) })
    window.liquid.on('messages', ({ jid, messages, statusUpdates }) => {
      if (statusUpdates) {
        Store.applyStatusUpdates(jid, statusUpdates)
        this._emit('messages', { jid, messages: [], statusUpdates })
      } else {
        Store.upsertMessages(jid, messages)
        this._emit('messages', { jid, messages })
      }
    })
    window.liquid.on('presence', ({ jid, state }) => {
      if (jid) Store.presence.set(jid, state)
      this._emit('presence', { jid, state })
    })
    window.liquid.on('settings', (s) => { Store.settings = s; this._emit('settings', s) })
    window.liquid.on('schedules', (s) => { Store.schedules = s; this._emit('schedules', s) })
    window.liquid.onOpenChat((jid) => this._emit('open-chat', jid))

    // Securely listen for secure inbound call network rings passing through the bridge wrapper
    window.liquid.onOutbox((data) => this._emit('outbox', data))
    window.liquid.onCallRing((callData) => {
      console.log(`[API Interface] Intercepted active ring handshake protocol request token: ${callData.id}`)
      this._emit('call', callData)
    })
  },
}
window.api = api
