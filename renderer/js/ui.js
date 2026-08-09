const ui = {
  el(tag, attrs = {}, children = []) {
    const n = document.createElement(tag)
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v
      else if (k === 'text') n.textContent = v
      else if (k === 'html') n.innerHTML = v
      else if (k === 'style') n.style.cssText = v
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
      else n.setAttribute(k, v)
    }
    for (const c of [].concat(children)) {
      if (c == null) continue
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c)
    }
    return n
  },

  esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]))
  },

  md(text) {
    let s = this.esc(text)
    s = s.replace(/```([\s\S]*?)```/g, (_, c) => '<pre>' + c + '</pre>')
    s = s.replace(/`([^`\n]+)`/g, (_, c) => '<code>' + c + '</code>')
    s = s.replace(/\*([^*\n]+)\*/g, '<b>$1</b>')
    s = s.replace(/_([^_\n]+)_/g, '<i>$1</i>')
    s = s.replace(/~([^~\n]+)~/g, '<s>$1</s>')
    s = s.replace(/&lt;a href/g, '')
    s = s.replace(/(https?:\/\/[^\s<]+)/g, (_, url) =>
      '<a href="#" class="external-link" data-url="' + url + '">' + url + '</a>')
    return s
  },

  time(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  },

  day(ts) {
    const d = new Date(ts), now = new Date()
    const same = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
    if (same(d, now)) return 'Today'
    const y = new Date(now); y.setDate(now.getDate() - 1)
    if (same(d, y)) return 'Yesterday'
    return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined })
  },

  initials(name) {
    if (!name) return '?'
    const parts = String(name).trim().split(/\s+/)
    return (parts[0][0] || '?') + (parts.length > 1 && parts[1][0] ? parts[1][0] : '')
  },

  avatarClass(name) {
    const sum = String(name || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    return ['alt-a', 'alt-b', 'alt-c', 'alt-d'][sum % 4]
  },

  avatarEl(name, size) {
    return this.el('span', { class: 'avatar ' + this.avatarClass(name), text: this.initials(name) })
  },

  ticks(m) {
    if (!m.fromMe || m.kind === 'system') return ''
    const st = m.status || 'PENDING'
    if (st === 'READ') return '<span class="tick read">✓✓</span>'
    if (st === 'DELIVERY' || st === 'DELIVERY_ACK' || st === 'SERVER_ACK') return '<span class="tick">✓✓</span>'
    return '<span class="tick">✓</span>'
  },

  bubble(m, onCtx, onMedia) {
    const cls = 'msg ' + (m.fromMe ? 'out' : 'in') + (m.kind === 'system' ? ' system' : '')
    const node = this.el('div', { class: cls })

    if (m.kind === 'system') {
      node.appendChild(this.el('span', { text: m.text || 'System message' }))
      return node
    }

    const body = this.el('div', { class: 'body' })
    if (m.kind === 'text') {
      body.innerHTML = this.md(m.text || '')
    } else if (m.kind === 'image' || m.kind === 'sticker') {
      const img = this.el('img', { class: 'media', alt: '', style: 'width:' + (m.kind === 'sticker' ? '160px' : '280px') })
      node.classList.add('media-loading')
      img.addEventListener('click', () => onMedia && onMedia(m))
      body.appendChild(img)
      if (m.caption) body.appendChild(this.el('span', { class: 'media-caption', text: m.caption }))
      window.liquid.downloadMedia(m).then((res) => {
        img.src = res.dataUrl
        node.classList.remove('media-loading')
      }).catch(() => { img.alt = 'unavailable' })
    } else if (m.kind === 'poll') {
      body.appendChild(this.el('span', { text: '📊 ' + (m.text || 'Poll') }))
      body.appendChild(this.el('span', { class: 'poll-badge', text: 'Poll' }))
    } else {
      const labels = {
        video: '🎬 Video', audio: '🎵 Voice note', document: '📄 ' + m.text,
        contact: '👤 ' + m.text, location: '📍 Location', reaction: '⚡ ' + m.text,
        interactive: '🃏 Interactive', unknown: '🔒 Unsupported'
      }
      const media = this.el('button', {
        class: 'media-placeholder',
        type: 'button',
        text: labels[m.kind] || '📦 ' + m.text
      })
      media.addEventListener('click', () => onMedia && onMedia(m))
      body.appendChild(media)
    }
    if (m.quoted && m.quoted.text) {
      body.insertBefore(this.el('div', { class: 'quoted', text: '↪ ' + m.quoted.text }), body.firstChild)
    }
    node.appendChild(body)

    const meta = this.el('span', { class: 'msg-meta' })
    meta.innerHTML = this.time(m.timestamp) + this.ticks(m)
    node.appendChild(meta)

    node.addEventListener('contextmenu', (e) => {
      e.preventDefault(); e.stopPropagation()
      if (onCtx) onCtx(e, m)
    })
    return node
  },

  chatItem(c, onClick) {
    const node = this.el('div', { class: 'chat-item' + (c.unread ? ' unread' : '') + (c.muted ? ' muted' : '') + (c.pinned ? ' pinned' : '') })
    node.appendChild(this.avatarEl(c.name))
    const mid = this.el('div', { class: 'chat-mid' })
    const top = this.el('div', { class: 'chat-top' })
    top.appendChild(this.el('div', { class: 'chat-name', text: c.name }))
    if (c.timestamp) top.appendChild(this.el('span', { class: 'chat-time', text: this.day(c.timestamp * 1000) }))
    mid.appendChild(top)
    const bottom = this.el('div', { class: 'chat-bottom' })
    const lm = c.lastMessage
    const preview = (lm && lm.text) || (lm && lm.kind !== 'text' ? lm.kind : '')
    bottom.appendChild(this.el('div', { class: 'chat-preview', text: (lm && lm.fromMe ? 'You: ' : '') + preview }))
    if (c.unread) bottom.appendChild(this.el('span', { class: 'chat-badge', text: c.unread > 99 ? '99+' : c.unread }))
    mid.appendChild(bottom)
    node.appendChild(mid)
    node.addEventListener('click', () => onClick(c.id))
    return node
  },

  dayDivider(label) {
    return this.el('div', { class: 'day-divider', text: label })
  },

  modal(html) {
    const content = document.getElementById('modal-content')
    content.innerHTML = ''
    content.appendChild(html)
    document.getElementById('modal-overlay').classList.remove('hidden')
  },

  closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden')
    document.getElementById('modal-content').innerHTML = ''
  },


  toast(message) {
    let t = document.getElementById('liquid-toast')
    if (!t) {
      t = this.el('div', { id: 'liquid-toast', class: 'liquid-toast' })
      document.body.appendChild(t)
    }
    t.textContent = String(message || '')
    t.classList.add('show')
    clearTimeout(this._toastTimer)
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 3200)
  },

  prompt(title, placeholder, initial, onOk) {
    this.modal(
      this.el('div', {}, [
        this.el('h2', { text: title }),
        this.el('input', { id: 'ui-prompt-input', type: 'text', placeholder: placeholder || '', value: initial || '' }),
        this.el('div', { class: 'row', style: 'margin-top:12px' }, [
          this.el('button', { class: 'btn ghost', style: 'flex:1', text: 'Cancel', onclick: () => this.closeModal() }),
          this.el('button', { class: 'btn primary', style: 'flex:1', text: 'OK', onclick: () => {
            const v = document.getElementById('ui-prompt-input').value
            this.closeModal()
            if (v) onOk(v)
          } })
        ])
      ])
    )
    const inp = document.getElementById('ui-prompt-input')
    inp.focus(); inp.select()
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = inp.value
        this.closeModal()
        if (v) onOk(v)
      }
    })
  },

  ctxMenu(x, y, items) {
    const menu = document.getElementById('ctx-menu')
    menu.innerHTML = ''
    for (const it of items) {
      if (it === '-') { menu.appendChild(this.el('div', { class: 'ctx-sep' })); continue }
      const b = this.el('button', { class: 'ctx-item' + (it.danger ? ' danger' : ''), text: it.label })
      b.addEventListener('click', () => { menu.classList.add('hidden'); it.action() })
      menu.appendChild(b)
    }
    menu.classList.remove('hidden')
    const mw = menu.offsetWidth, mh = menu.offsetHeight
    menu.style.left = Math.min(x, window.innerWidth - mw - 8) + 'px'
    menu.style.top = Math.min(y, window.innerHeight - mh - 8) + 'px'
  },

  hideCtx() { document.getElementById('ctx-menu').classList.add('hidden') },
}
window.ui = ui
