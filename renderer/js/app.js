const $ = (id) => document.getElementById(id)

async function init() {
  const boot = await api.init()
  api.subscribe()
  wireEvents()
  wireStaticUI()
  document.documentElement.dataset.theme = boot.settings?.theme || 'system'
  if (boot.hasSession) enterApp()
  else showLogin()
}

function showLogin() {
  $('login-view').classList.remove('hidden')
  $('app-view').classList.add('hidden')
}

function enterApp() {
  $('login-view').classList.add('hidden')
  $('app-view').classList.remove('hidden')
  renderMe()
  renderChatList()
}

function renderMe() {
  const u = Store.user
  if (u) {
    $('me-name').textContent = u.name || u.number || 'Me'
    $('me-avatar').textContent = ui.initials(u.name || u.number)
  }
  const c = $('conn-status')
  c.className = 'conn ' + (Store.conn === 'open' ? 'online' : Store.conn === 'close' || Store.conn === 'idle' ? 'offline' : '')
  c.innerHTML = '<span class="dot"></span> ' + (Store.conn === 'open' ? ' Online' : Store.conn === 'connecting' ? ' Connecting…' : Store.conn === 'close' ? ' Reconnecting…' : ' Offline')
}

// Variables to capture active phone network call signaling states
let activeCallId = null
let activeCallJid = null
let activeCallVideo = false
let quotedMessage = null

function wireEvents() {
  api.on('connection', (u) => {
    if (u.connection === 'open' && !Store.user && u.user) { Store.user = u.user }
    if (u.connection === 'open' && $('app-view').classList.contains('hidden')) enterApp()
    if (u.loggedOut) { Store.reset(); showLogin(); renderMe(); return }
    renderMe()
  })
  api.on('chats', () => renderChatList())
  api.on('messages', ({ jid }) => {
    if (jid === Store.activeJid) renderMessages()
    else if (!document.hidden) {
      const unread = Store.messagesOf(jid).filter((m) => !m.fromMe && m.id).map((m) => m.id)
      if (unread.length) window.liquid.read(jid, unread)
    }
    renderChatList()
  })
  api.on('presence', ({ jid }) => { if (jid === Store.activeJid) renderPresence() })
  api.on('open-chat', (jid) => openChat(jid))
  api.on('outbox', ({ count }) => {
    $('outbox-status').textContent = count ? `${count} message${count === 1 ? '' : 's'} queued` : 'Session saved on this Mac'
  })

  // Intercept the API calling signal event to slide the frosted glass banner into view
  api.on('call', (callData) => {
    activeCallId = callData.id
    activeCallJid = callData.from
    activeCallVideo = callData.isVideo

    const cleanNum = activeCallJid.split('@')[0]
    $('callContactName').textContent = cleanNum
    $('callAvatarInitial').textContent = ui.initials(cleanNum)
    $('callBadgeType').textContent = activeCallVideo ? 'Liquid Video Connection' : 'Liquid Voice Connection'

    // Animates the banner cleanly below Catalina's hiddenInset drag margin region
    $('liquidCallBanner').classList.remove('liquid-banner-hidden')
  })
}

let voiceRecorder = null
let voiceChunks = []
let voiceStartedAt = 0
let voiceTimer = null
let voiceStream = null
let voiceAnalyser = null
let voiceLevelFrame = null

function formatVoiceTime(ms) {
  const sec = Math.floor(ms / 1000)
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function stopVoiceLevel() {
  if (voiceLevelFrame) cancelAnimationFrame(voiceLevelFrame)
  voiceLevelFrame = null
  const fill = $('voice-level-fill')
  if (fill) fill.style.width = '8%'
}

function cleanupVoiceStream() {
  if (voiceStream) voiceStream.getTracks().forEach(t => t.stop())
  voiceStream = null
  voiceAnalyser = null
  stopVoiceLevel()
}

function drawVoiceLevel() {
  if (!voiceAnalyser) return
  const data = new Uint8Array(voiceAnalyser.fftSize)
  const tick = () => {
    if (!voiceAnalyser) return
    voiceAnalyser.getByteTimeDomainData(data)
    let sum = 0
    for (const v of data) { const n = (v - 128) / 128; sum += n * n }
    const rms = Math.sqrt(sum / data.length)
    const fill = $('voice-level-fill')
    if (fill) fill.style.width = `${Math.min(100, 8 + rms * 220)}%`
    voiceLevelFrame = requestAnimationFrame(tick)
  }
  tick()
}

async function startVoiceNote() {
  if (!Store.activeJid || voiceRecorder) return
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    ui.toast('Voice recording is not supported by this macOS/Electron build')
    return
  }
  try {
    voiceStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
    voiceRecorder = new MediaRecorder(voiceStream, { mimeType: mime })
    voiceChunks = []
    voiceStartedAt = Date.now()
    voiceRecorder.ondataavailable = e => { if (e.data.size) voiceChunks.push(e.data) }
    voiceRecorder.onstop = () => {}
    const AudioCtx = window.AudioContext || window.webkitAudioContext
    if (AudioCtx) {
      const ctx = new AudioCtx()
      const source = ctx.createMediaStreamSource(voiceStream)
      voiceAnalyser = ctx.createAnalyser(); voiceAnalyser.fftSize = 256
      source.connect(voiceAnalyser)
      drawVoiceLevel()
    }
    $('voice-recorder').classList.remove('hidden')
    $('composer-input').classList.add('hidden')
    $('btn-send').classList.add('hidden')
    $('btn-voice').classList.add('recording')
    voiceTimer = setInterval(() => { $('voice-timer').textContent = formatVoiceTime(Date.now() - voiceStartedAt) }, 250)
    voiceRecorder.start(200)
  } catch (e) {
    cleanupVoiceStream()
    ui.toast(e.name === 'NotAllowedError' ? 'Microphone access was denied' : (e.message || 'Could not start recording'))
  }
}

function resetVoiceUI() {
  if (voiceTimer) clearInterval(voiceTimer)
  voiceTimer = null
  $('voice-timer').textContent = '0:00'
  $('voice-recorder').classList.add('hidden')
  $('composer-input').classList.remove('hidden')
  $('btn-send').classList.remove('hidden')
  $('btn-voice').classList.remove('recording')
}

async function cancelVoiceNote() {
  if (voiceRecorder) { voiceRecorder.ondataavailable = null; voiceRecorder.stop(); voiceRecorder = null }
  cleanupVoiceStream(); resetVoiceUI(); voiceChunks = []
}

async function finishVoiceNote(send = true) {
  if (!voiceRecorder) return
  const recorder = voiceRecorder
  const duration = Date.now() - voiceStartedAt
  const stopped = new Promise(resolve => { recorder.addEventListener('stop', resolve, { once: true }) })
  recorder.stop()
  await stopped
  voiceRecorder = null
  cleanupVoiceStream(); resetVoiceUI()
  const chunks = voiceChunks; voiceChunks = []
  if (!send || !chunks.length || duration < 300 || !Store.activeJid) return
  try {
    const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
    const reader = new FileReader()
    const dataUrl = await new Promise((resolve, reject) => { reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob) })
    await window.liquid.sendVoiceNote(Store.activeJid, dataUrl, duration, quotedMessage)
    clearQuote()
  } catch (e) { ui.toast(e.message || 'Voice message failed to send') }
}

function wireStaticUI() {
  $('btn-voice').addEventListener('click', () => voiceRecorder ? finishVoiceNote(true) : startVoiceNote())
  $('voice-cancel').addEventListener('click', cancelVoiceNote)
  $('voice-send').addEventListener('click', () => finishVoiceNote(true))
  document.addEventListener('click', (e) => {
    const link = e.target.closest('.external-link')
    if (!link) return
    e.preventDefault()
    const url = link.dataset.url
    if (url) window.liquid.openExternal(url)
  })
  $('login-btn').addEventListener('click', doPair)
  $('login-number').addEventListener('keydown', (e) => { if (e.key === 'Enter') doPair() })

  $('btn-new-chat').addEventListener('click', () => openNewChat())
  $('btn-new-chat-empty').addEventListener('click', () => openNewChat())
  $('btn-status').addEventListener('click', openStatusModal)
  $('btn-starred').addEventListener('click', openStarredModal)
  $('btn-settings').addEventListener('click', openSettingsModal)
  $('btn-profile').addEventListener('click', openProfileModal)
  $('btn-chat-search').addEventListener('click', openMessageSearchModal)
  $('btn-gallery').addEventListener('click', openGalleryModal)
  $('btn-profile').addEventListener('click', openProfileModal)
  $('btn-chat-search').addEventListener('click', openMessageSearchModal)
  $('btn-gallery').addEventListener('click', openGalleryModal)
  $('btn-logout').addEventListener('click', async () => {
    ui.prompt('Log out', 'Type LOGOUT to confirm', '', (v) => {
      if (v.toUpperCase() === 'LOGOUT') window.liquid.logout()
    })
  })
  $('search').addEventListener('input', (e) => { Store.search = e.target.value; renderChatList() })
  document.querySelectorAll('#filter-tabs .tab').forEach((t) => {
    t.addEventListener('click', () => {
      document.querySelectorAll('#filter-tabs .tab').forEach((x) => x.classList.remove('active'))
      t.classList.add('active')
      Store.filter = t.dataset.filter
      renderChatList()
    })
  })

  $('btn-media').addEventListener('click', async () => {
    await window.liquid.sendMedia(Store.activeJid, '', quotedMessage)
    clearQuote()
  })
  $('composer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && quotedMessage) clearQuote()
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })
  $('quote-cancel').addEventListener('click', clearQuote)
  $('btn-poll').addEventListener('click', openPollModal)
  $('btn-viewonce').addEventListener('click', openViewOnceModal)
  $('btn-disappear').addEventListener('click', openDisappearModal)
  $('btn-ai').addEventListener('click', openAiModal)
  $('btn-mention-all').addEventListener('click', () => {
    ui.prompt('Message to @all', 'Type message', '', (t) => window.liquid.mentionAll(Store.activeJid, t))
  })
  $('btn-send').addEventListener('click', sendMessage)
  $('composer-input').addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && voiceRecorder) { e.preventDefault(); cancelVoiceNote(); return }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  })
  const composer = $('composer')
  const dropHint = $('drop-hint')
  ;['dragenter','dragover'].forEach(ev => composer.addEventListener(ev, (e) => { e.preventDefault(); dropHint.classList.remove('hidden') }))
  ;['dragleave','drop'].forEach(ev => composer.addEventListener(ev, (e) => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget && composer.contains(e.relatedTarget)) return; dropHint.classList.add('hidden') }))
  composer.addEventListener('drop', async (e) => {
    if (!Store.activeJid || !e.dataTransfer.files.length) return
    for (const file of e.dataTransfer.files) { await window.liquid.sendDroppedMedia(Store.activeJid, file.path, '', quotedMessage).catch(err => ui.toast(err.message || 'Upload failed')) }
    clearQuote()
  })
  $('composer-input').addEventListener('input', () => {
    clearTimeout(Store.typingTimers.get(Store.activeJid))
    window.liquid.typing(Store.activeJid, true)
    Store.typingTimers.set(Store.activeJid, setTimeout(() => window.liquid.typing(Store.activeJid, false), 2000))
  })

  // Wire up the banner overlay acceptance/rejection mechanics
  $('btnBannerAccept').addEventListener('click', async () => {
    $('liquidCallBanner').classList.add('liquid-banner-hidden')
    try { await window.liquid.callAction('accept', activeCallId, activeCallJid, activeCallVideo) } catch (e) { ui.toast(e.message || 'Calls are not supported yet') }
  })
  $('btnBannerDecline').addEventListener('click', async () => {
    $('liquidCallBanner').classList.add('liquid-banner-hidden')
    try { await window.liquid.callAction('reject', activeCallId, activeCallJid, activeCallVideo) } catch (_) {}
  })

  // Hook up your inline header call options to fire outbound calling window popups
  $('headerVoiceCallBtn').addEventListener('click', async () => {
    if (!Store.activeJid) return
    const customOutboundId = 'out_' + Date.now()
    try { await window.liquid.callAction('start', customOutboundId, Store.activeJid, false) } catch (e) { ui.toast(e.message || 'Calls are not supported yet') }
  })
  $('headerVideoCallBtn').addEventListener('click', async () => {
    if (!Store.activeJid) return
    const customOutboundId = 'out_' + Date.now()
    try { await window.liquid.callAction('start', customOutboundId, Store.activeJid, true) } catch (e) { ui.toast(e.message || 'Calls are not supported yet') }
  })

  document.addEventListener('keydown', (e) => {
    const cmd = e.metaKey || e.ctrlKey
    if (cmd && e.key.toLowerCase() === 'k') { e.preventDefault(); $('search').focus(); $('search').select() }
    if (cmd && e.key.toLowerCase() === 'f' && Store.activeJid) { e.preventDefault(); openMessageSearchModal() }
    if (e.key === 'Escape') {
      if (!$('modal-overlay').classList.contains('hidden')) ui.closeModal()
      else if (!$('viewer').classList.contains('hidden')) $('viewer').classList.add('hidden')
      else if (quotedMessage) clearQuote()
    }
  })

  $('modal-close').addEventListener('click', ui.closeModal)
  $('modal-overlay').addEventListener('click', (e) => { if (e.target === $('modal-overlay')) ui.closeModal() })
  $('viewer-close').addEventListener('click', () => $('viewer').classList.add('hidden'))
  document.querySelector('.viewer-backdrop').addEventListener('click', () => $('viewer').classList.add('hidden'))
  document.addEventListener('click', ui.hideCtx)
}

function filteredChats() {
  const q = Store.search.toLowerCase()
  let list = Store.chats
  if (Store.filter === 'unread') list = list.filter((c) => c.unread > 0)
  if (Store.filter === 'groups') list = list.filter((c) => c.id.endsWith('@g.us'))
  if (Store.filter !== 'archived') list = list.filter((c) => !c.archived)
  if (Store.filter === 'archived') list = list.filter((c) => c.archived)
  if (Store.filter !== 'archived') list = list.filter((c) => !c.archived)
  if (Store.filter === 'archived') list = list.filter((c) => c.archived)
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q) || (c.lastMessage && c.lastMessage.text && c.lastMessage.text.toLowerCase().includes(q)))
  return list
}

function renderChatList() {
  const nav = $('chat-list')
  nav.innerHTML = ''
  const list = filteredChats()
  if (!list.length) {
    nav.appendChild(ui.el('div', { class: 'hint', style: 'text-align:center;padding:24px 0', text: Store.search ? 'No chats match' : 'No chats yet — start a new chat' }))
    return
  }
  for (const c of list) {
    const node = ui.chatItem(c, (jid) => openChat(jid))
    node.addEventListener('contextmenu', (e) => { e.preventDefault(); ui.ctxMenu(e.clientX, e.clientY, [
      {label: c.pinned ? 'Unpin chat' : 'Pin chat', action: () => window.liquid.pinChat(c.id, !c.pinned)},
      {label: c.muted ? 'Unmute chat' : 'Mute chat', action: () => window.liquid.muteChat(c.id, !c.muted)},
      {label: c.archived ? 'Unarchive chat' : 'Archive chat', action: () => window.liquid.archiveChat(c.id, !c.archived)}
    ]) })
    nav.appendChild(node)
  }
}

function openChat(jid) {
  clearQuote()
  Store.activeJid = jid
  window.liquid.setActive(jid)
  $('empty-state').classList.add('hidden')
  $('chat-panel').classList.remove('hidden')
  const chat = Store.chats.find((c) => c.id === jid)
  const name = chat ? chat.name : jid.split('@')[0]
  $('chat-name').textContent = name
  $('chat-avatar').className = 'avatar ' + ui.avatarClass(name)
  $('chat-avatar').textContent = ui.initials(name)
  $('btn-mention-all').classList.toggle('hidden', !jid.endsWith('@g.us'))
  renderPresence()
  renderMessages()
  window.liquid.loadChat(jid).then((msgs) => {
    Store.messages.set(jid, msgs)
    renderMessages()
    renderChatList()
  }).catch(() => {})
}

function renderPresence() {
  const st = Store.presence.get(Store.activeJid)
  const el = $('chat-presence')
  el.textContent = st === 'typing' ? 'typing…' : st === 'recording' ? 'recording…' : st === 'online' ? 'online' : 'offline'
  el.className = 'presence' + (st && st !== 'offline' ? ' online' : '')
}

function renderMessages() {
  const wrap = $('messages')
  wrap.innerHTML = ''
  const msgs = Store.messagesOf(Store.activeJid)
  let lastDay = null
  for (const m of msgs) {
    const d = ui.day(m.timestamp)
    if (d !== lastDay) { wrap.appendChild(ui.dayDivider(d)); lastDay = d }
    wrap.appendChild(ui.bubble(m, onMsgCtx, openViewer))
  }
  const sw = $('messages-wrap')
  sw.scrollTop = sw.scrollHeight
}

function setQuote(m) {
  quotedMessage = m
  $('quote-preview').classList.remove('hidden')
  $('quote-preview-text').textContent = (m.text || m.caption || m.kind || 'Message').slice(0, 180)
  $('composer-input').focus()
}

function clearQuote() {
  quotedMessage = null
  const q = $('quote-preview')
  if (q) q.classList.add('hidden')
}

function onMsgCtx(e, m) {
  const items = [
    { label: 'Reply', action: () => setQuote(m) }
  ]
  if (m.kind === 'text') {
    items.push({ label: 'Copy text', action: () => window.liquid.copyText(m.text) })
  }
  if (m.kind !== 'system' && m.raw) {
    items.push({ label: 'React ❤️', action: () => window.liquid.react(m.jid, m, '❤️') })
    items.push({ label: 'React 👍', action: () => window.liquid.react(m.jid, m, '👍') })
    items.push({ label: 'Star / unstar', action: async () => {
      Store.starred = await window.liquid.star(m)
    }})
    items.push({ label: 'Forward…', action: () => ui.prompt(
      'Forward message',
      'Enter recipient number with country code',
      '',
      (v) => {
        const raw = String(v || '').replace(/\D/g, '')
        if (raw.length >= 8) window.liquid.forward(m, raw + '@s.whatsapp.net')
      }
    )})
  }
  if (m.fromMe && m.kind === 'text') {
    items.push('-')
    items.push({ label: 'Edit…', action: () => ui.prompt(
      'Edit message', 'New text', m.text,
      (t) => window.liquid.edit(m.jid, m.id, t)
    )})
    items.push({ label: 'Delete for everyone', danger: true, action: () => window.liquid.del(m.jid, m.id) })
  }
  items.push('-')
  if (m.kind === 'image') {
    items.push({ label: 'Send as sticker…', action: () => window.liquid.sticker(Store.activeJid) })
  }
  ui.ctxMenu(e.clientX, e.clientY, items)
}

function openViewer(m) {
  window.liquid.downloadMedia(m).then((res) => {
    $('viewer-img').src = res.dataUrl
    $('viewer-caption').textContent = m.caption || ''
    $('viewer').classList.remove('hidden')
  }).catch(() => {})
}

async function sendMessage() {
  const input = $('composer-input')
  const text = input.value.trim()
  if (!text || !Store.activeJid) return
  input.value = ''
  window.liquid.typing(Store.activeJid, false)
  try {
    await window.liquid.sendText(Store.activeJid, text, quotedMessage)
    clearQuote()
  } catch (e) {
    ui.toast(e.message || 'Message failed to send')
  }
}

async function doPair() {
  const num = $('login-number').value.trim()
  const st = $('login-status')
  const btn = $('login-btn')
  const box = $('pair-code')
  const value = $('pair-code-value')
  st.className = 'status-line'
  st.textContent = 'Connecting to WhatsApp…'
  btn.disabled = true
  try {
    const code = await window.liquid.pair(num)
    value.textContent = code || '—'
    box.classList.remove('hidden')
    st.className = 'status-line ok'
    st.textContent = 'Enter the code on your phone. Keep this app open while linking.'
  } catch (e) {
    st.className = 'status-line err'
    st.textContent = e.message || 'Pairing failed'
  } finally {
    btn.disabled = false
  }
}

function withModal(tplId, wire) {
  const tpl = $(tplId)
  const clone = document.importNode(tpl.content, true)
  ui.modal(clone)
  if (wire) wire()
}

function openNewChat() {
  withModal('tpl-newchat', () => {
    const go = () => {
      const raw = $('nc-number').value.trim()
      const broadcast = $('nc-broadcast').checked
      if (broadcast) {
        const jids = raw.split(/[,\s]+/).filter(Boolean).map((n) => n.replace(/\D/g, '') + '@s.whatsapp.net')
        ui.prompt('Broadcast message', 'Type message', '', (t) => {
          if (jids.length) window.liquid.broadcast(jids, t)
        })
      } else {
        const jid = raw.replace(/\D/g, '') + '@s.whatsapp.net'
        ui.closeModal(); openChat(jid)
      }
    }
    $('nc-go').addEventListener('click', go)
    $('nc-number').addEventListener('keydown', (e) => { if (e.key === 'Enter') go() })
    const list = $('nc-contacts')
    window.liquid.contacts().then((cs) => {
      Store.setContacts(cs)
      for (const c of cs.slice(0, 200)) {
        const it = ui.el('div', { class: 'contact-item' })
        it.appendChild(ui.avatarEl(c.name))
        const mid = ui.el('div')
        mid.appendChild(ui.el('div', { class: 'c-name', text: c.name }))
        mid.appendChild(ui.el('div', { class: 'c-num', text: c.number }))
        it.appendChild(mid)
        it.addEventListener('click', () => { ui.closeModal(); openChat(c.id) })
        list.appendChild(it)
      }
    })
  })
}

function openPollModal() {
  withModal('tpl-poll', () => {
    $('poll-go').addEventListener('click', async () => {
      const name = $('poll-name').value.trim()
      const options = $('poll-options').value.split('\n').map((s) => s.trim()).filter(Boolean)
      if (name && options.length >= 1) { await window.liquid.poll(Store.activeJid, name, options); ui.closeModal() }
    })
  })
}

function openViewOnceModal() {
  withModal('tpl-viewonce', () => {
    $('vo-go').addEventListener('click', async () => {
      const t = $('vo-text').value.trim()
      if (t) { await window.liquid.viewOnce(Store.activeJid, t); ui.closeModal() }
    })
  })
}

function openDisappearModal() {
  withModal('tpl-disappear', () => {
    $('disp-go').addEventListener('click', async () => {
      await window.liquid.disappear(Store.activeJid, Number($('disp-select').value))
      ui.closeModal()
    })
  })
}

async function openMessageSearchModal() {
  withModal('tpl-search', () => {
    const input = $('msg-search-input'), out = $('msg-search-results')
    const run = async () => {
      const q = input.value.trim(); out.innerHTML = ''
      if (!q) return
      const results = await window.liquid.searchMessages(q, Store.activeJid)
      if (!results.length) { out.appendChild(ui.el('div',{class:'hint',text:'No messages found'})); return }
      for (const m of results) {
        const b = ui.el('button',{class:'search-result',type:'button'})
        b.appendChild(ui.el('div',{text:(m.text||m.caption||m.kind||'Message').slice(0,220)}))
        b.appendChild(ui.el('small',{text:`${m.fromMe?'You':m.name} · ${new Date(m.timestamp).toLocaleString()}`}))
        b.addEventListener('click',()=>{ ui.closeModal(); openChat(m.jid); setTimeout(()=>{ const el=[...document.querySelectorAll('.msg')].find(x=>x.textContent.includes((m.text||'').slice(0,30))); el?.scrollIntoView({behavior:'smooth',block:'center'}) },150) })
        out.appendChild(b)
      }
    }
    input.addEventListener('input', run); input.focus()
  })
}

async function openGalleryModal() {
  withModal('tpl-gallery', () => {
    const out=$('gallery-grid'); out.innerHTML=''
    const media=Store.messagesOf(Store.activeJid).filter(m=>['image','sticker'].includes(m.kind))
    if(!media.length){out.appendChild(ui.el('div',{class:'hint',text:'No images or stickers in this chat.'}));return}
    media.slice(-100).forEach(m=>{ const img=ui.el('img',{alt:''}); out.appendChild(img); window.liquid.downloadMedia(m).then(r=>img.src=r.dataUrl).catch(()=>{}); img.addEventListener('click',()=>{ui.closeModal();openViewer(m)}) })
  })
}

async function openProfileModal() {
  const chat=Store.chats.find(c=>c.id===Store.activeJid); if(!chat) return
  withModal('tpl-profile',()=>{
    const out=$('profile-content'); out.appendChild(ui.avatarEl(chat.name,'large')); out.appendChild(ui.el('h2',{text:chat.name})); out.appendChild(ui.el('div',{class:'hint',text:Store.activeJid}))
    const row=ui.el('div',{class:'row',style:'margin-top:14px;gap:8px'})
    row.appendChild(ui.el('button',{class:'btn ghost',text:chat.pinned?'Unpin':'Pin',onclick:async()=>{await window.liquid.pinChat(chat.id,!chat.pinned);ui.closeModal()}}))
    row.appendChild(ui.el('button',{class:'btn ghost',text:chat.muted?'Unmute':'Mute',onclick:async()=>{await window.liquid.muteChat(chat.id,!chat.muted);ui.closeModal()}}))
    row.appendChild(ui.el('button',{class:'btn ghost',text:chat.archived?'Unarchive':'Archive',onclick:async()=>{await window.liquid.archiveChat(chat.id,!chat.archived);ui.closeModal()}})); out.appendChild(row)
    if(chat.id.endsWith('@g.us')) { const g=ui.el('button',{class:'btn primary',style:'width:100%;margin-top:10px',text:'Manage group',onclick:()=>{ui.closeModal();openGroupModal()}});out.appendChild(g) }
  })
}

async function openGroupModal() {
  if(!Store.activeJid?.endsWith('@g.us')) return
  withModal('tpl-group', async()=>{
    $('group-subject').value=Store.chats.find(c=>c.id===Store.activeJid)?.name||''
    const members=await window.liquid.groupParticipants(Store.activeJid).catch(()=>[]), out=$('group-members')
    out.innerHTML=''
    members.forEach(m=>{ const jid=m.id||m.jid||m; const label=typeof m==='string'?m:(m.name||m.notify||jid); const b=ui.el('button',{class:'contact-item',type:'button',text:label}); b.dataset.jid=jid; b.addEventListener('click',()=>b.classList.toggle('selected')); out.appendChild(b) })
    $('group-subject-save').onclick=async()=>{await window.liquid.groupSubject(Store.activeJid,$('group-subject').value);ui.closeModal()}
    const selected=()=>[...out.querySelectorAll('.selected')].map(x=>x.dataset.jid)
    $('group-add').onclick=async()=>{ui.toast('Use New chat/contact selection to choose members; group add requires a selected WhatsApp contact JID.');}
    $('group-remove').onclick=async()=>{await window.liquid.groupAction(Store.activeJid,'remove',selected());ui.closeModal()}
    $('group-promote').onclick=async()=>{await window.liquid.groupAction(Store.activeJid,'promote',selected());ui.closeModal()}
    $('group-leave').onclick=async()=>{await window.liquid.groupLeave(Store.activeJid);ui.closeModal()}
  })
}

async function openMessageSearchModal() {
  withModal('tpl-search', () => {
    const input = $('msg-search-input'), out = $('msg-search-results')
    const run = async () => {
      const q = input.value.trim(); out.innerHTML = ''
      if (!q) return
      const results = await window.liquid.searchMessages(q, Store.activeJid)
      if (!results.length) { out.appendChild(ui.el('div',{class:'hint',text:'No messages found'})); return }
      for (const m of results) {
        const b = ui.el('button',{class:'search-result',type:'button'})
        b.appendChild(ui.el('div',{text:(m.text||m.caption||m.kind||'Message').slice(0,220)}))
        b.appendChild(ui.el('small',{text:`${m.fromMe?'You':m.name} · ${new Date(m.timestamp).toLocaleString()}`}))
        b.addEventListener('click',()=>{ ui.closeModal(); openChat(m.jid) })
        out.appendChild(b)
      }
    }
    input.addEventListener('input', run); input.focus()
  })
}

async function openGalleryModal() {
  withModal('tpl-gallery', () => {
    const out=$('gallery-grid'); out.innerHTML=''
    const media=Store.messagesOf(Store.activeJid).filter(m=>['image','sticker'].includes(m.kind))
    if(!media.length){out.appendChild(ui.el('div',{class:'hint',text:'No images or stickers in this chat.'}));return}
    media.slice(-100).forEach(m=>{ const img=ui.el('img',{alt:''}); out.appendChild(img); window.liquid.downloadMedia(m).then(r=>img.src=r.dataUrl).catch(()=>{}); img.addEventListener('click',()=>{ui.closeModal();openViewer(m)}) })
  })
}

async function openProfileModal() {
  const chat=Store.chats.find(c=>c.id===Store.activeJid); if(!chat) return
  withModal('tpl-profile',()=>{
    const out=$('profile-content'); out.appendChild(ui.avatarEl(chat.name)); out.appendChild(ui.el('h2',{text:chat.name})); out.appendChild(ui.el('div',{class:'hint',text:Store.activeJid}))
    const row=ui.el('div',{class:'row',style:'margin-top:14px;gap:8px'})
    row.appendChild(ui.el('button',{class:'btn ghost',text:chat.pinned?'Unpin':'Pin',onclick:async()=>{await window.liquid.pinChat(chat.id,!chat.pinned);ui.closeModal()}}))
    row.appendChild(ui.el('button',{class:'btn ghost',text:chat.muted?'Unmute':'Mute',onclick:async()=>{await window.liquid.muteChat(chat.id,!chat.muted);ui.closeModal()}}))
    row.appendChild(ui.el('button',{class:'btn ghost',text:chat.archived?'Unarchive':'Archive',onclick:async()=>{await window.liquid.archiveChat(chat.id,!chat.archived);ui.closeModal()}})); out.appendChild(row)
    if(chat.id.endsWith('@g.us')) out.appendChild(ui.el('button',{class:'btn primary',style:'width:100%;margin-top:10px',text:'Manage group',onclick:()=>{ui.closeModal();openGroupModal()}}))
  })
}

async function openGroupModal() {
  if(!Store.activeJid?.endsWith('@g.us')) return
  withModal('tpl-group', async()=>{
    $('group-subject').value=Store.chats.find(c=>c.id===Store.activeJid)?.name||''
    const members=await window.liquid.groupParticipants(Store.activeJid).catch(()=>[]), out=$('group-members'); out.innerHTML=''
    members.forEach(m=>{ const jid=m.id||m.jid||m; const label=typeof m==='string'?m:(m.name||m.notify||jid); const b=ui.el('button',{class:'contact-item',type:'button',text:label}); b.dataset.jid=jid; b.addEventListener('click',()=>b.classList.toggle('selected')); out.appendChild(b) })
    $('group-subject-save').onclick=async()=>{await window.liquid.groupSubject(Store.activeJid,$('group-subject').value);ui.closeModal()}
    const selected=()=>[...out.querySelectorAll('.selected')].map(x=>x.dataset.jid)
    $('group-add').onclick=()=>ui.prompt('Add participant','Phone number with country code','',(v)=>window.liquid.groupAction(Store.activeJid,'add',[v.replace(/\D/g,'')+'@s.whatsapp.net']))
    $('group-remove').onclick=async()=>{await window.liquid.groupAction(Store.activeJid,'remove',selected());ui.closeModal()}
    $('group-promote').onclick=async()=>{await window.liquid.groupAction(Store.activeJid,'promote',selected());ui.closeModal()}
    $('group-leave').onclick=async()=>{await window.liquid.groupLeave(Store.activeJid);ui.closeModal()}
  })
}

function openStatusModal() {
  withModal('tpl-status', () => {
    $('st-go').addEventListener('click', async () => {
      const t = $('st-text').value.trim()
      if (t) { await window.liquid.postStatus(t); ui.closeModal() }
    })
    $('st-img').addEventListener('click', async () => { await window.liquid.postStatusImage(''); ui.closeModal() })
  })
}

async function openStarredModal() {
  const list = await window.liquid.starred()
  const tpl = $('tpl-starred')
  const clone = document.importNode(tpl.content, true)
  ui.modal(clone)
  const out = $('starred-list')
  out.innerHTML = ''
  if (!list.length) {
    out.appendChild(ui.el('div', { class: 'hint', text: 'No starred messages yet.' }))
    return
  }
  for (const s of list) {
    const it = ui.el('button', { class: 'star-item', type: 'button' })
    it.appendChild(ui.el('div', { text: s.text || s.kind || 'Message' }))
    it.appendChild(ui.el('div', { class: 's-meta', text: `${s.name || s.jid} · ${ui.day(s.ts)}` }))
    it.addEventListener('click', () => {
      ui.closeModal()
      openChat(s.jid)
    })
    out.appendChild(it)
  }
}

function openSettingsModal() {
  withModal('tpl-settings', () => {
    const s = Store.settings || {}
    const user = Store.user || {}
    const $id = (id) => document.getElementById(id)

    const sections = [...document.querySelectorAll('.settings-section')]
    const tabs = [...document.querySelectorAll('.settings-tab')]
    const selectSection = (name) => {
      tabs.forEach(t => t.classList.toggle('active', t.dataset.section === name))
      sections.forEach(panel => panel.classList.toggle('active', panel.dataset.sectionPanel === name))
    }
    tabs.forEach(tab => tab.addEventListener('click', () => selectSection(tab.dataset.section)))

    $id('settings-name').textContent = user.name || 'Me'
    $id('settings-number').textContent = user.number ? '+' + user.number : 'Connected account'
    $id('settings-avatar').textContent = (user.name || 'M').trim().charAt(0).toUpperCase()

    $id('set-notif').checked = s.notifications !== false
    $id('set-typing').checked = s.typingIndicator !== false
    $id('set-sound').checked = s.soundNotifications !== false
    $id('set-preview').checked = s.showPreviews !== false
    $id('set-theme').value = s.theme || 'system'
    $id('set-reduce-motion').checked = !!s.reduceMotion
    $id('set-backup').checked = s.backupEnabled !== false
    document.documentElement.dataset.theme = s.theme || 'system'

    const ai = s.ai || {}
    $id('ai-provider').value = ai.provider || 'openai'
    $id('ai-model').value = ai.model || ''
    $id('ai-key').value = ai.key || ''

    const privacyMap = {
      'pr-lastseen': 'lastseen', 'pr-online': 'online', 'pr-read': 'read',
      'pr-pic': 'pic', 'pr-status': 'status', 'pr-groups': 'groups'
    }
    for (const [id, key] of Object.entries(privacyMap)) {
      const el = $id(id)
      if (!el) continue
      el.value = (s.privacy && s.privacy[key]) || 'all'
      el.addEventListener('change', async () => {
        try { await window.liquid.setPrivacy(key, el.value); ui.toast(`${key} privacy updated`) } catch (e) { ui.toast(e.message || 'Could not update privacy') }
      })
    }

    $id('set-theme').addEventListener('change', () => {
      document.documentElement.dataset.theme = $id('set-theme').value
    })

    window.liquid.localInfo().then((info) => {
      $id('local-db-info').textContent = `${info.messages.toLocaleString()} messages · ${info.chats.toLocaleString()} chats · schema ${info.schema}`
    }).catch(() => {})

    $id('backup-export').addEventListener('click', async () => {
      const r = await window.liquid.exportLocal()
      if (r?.ok) ui.toast('Backup exported successfully')
    })

    $id('settings-save').addEventListener('click', async () => {
      await window.liquid.setSettings({
        notifications: $id('set-notif').checked,
        typingIndicator: $id('set-typing').checked,
        soundNotifications: $id('set-sound').checked,
        showPreviews: $id('set-preview').checked,
        theme: $id('set-theme').value,
        reduceMotion: $id('set-reduce-motion').checked,
        backupEnabled: $id('set-backup').checked,
        ai: { provider: $id('ai-provider').value, model: $id('ai-model').value.trim(), key: $id('ai-key').value.trim() }
      })
      document.documentElement.dataset.theme = $id('set-theme').value
      ui.toast('Settings saved')
    })

    $id('ai-save').addEventListener('click', async () => {
      await window.liquid.setSettings({
        ai: { provider: $id('ai-provider').value, model: $id('ai-model').value.trim(), key: $id('ai-key').value.trim() }
      })
      ui.toast('AI settings saved')
    })

    $id('settings-logout').addEventListener('click', async () => {
      if (!confirm('Log out of this WhatsApp session on this Mac?')) return
      await window.liquid.logout()
      ui.closeModal()
    })
  })
}

function openAiModal() {
  withModal('tpl-ai', () => {
    const out = $('ai-out')
    const setBusy = (b) => { out.className = 'ai-out'; out.innerHTML = b ? '<span class="spinner">Thinking…</span>' : '' }
    const show = (html, sendText) => {
      out.className = 'ai-out'; out.innerHTML = html
      if (sendText) {
        const row = ui.el('div', { class: 'ai-actions' })
        const btn = ui.el('button', { class: 'btn primary', text: 'Send to chat' })
        btn.addEventListener('click', async () => { await window.liquid.sendText(Store.activeJid, sendText); ui.closeModal() })
        row.appendChild(btn)
        out.appendChild(row)
      }
    }
    const showErr = (e) => { out.className = 'ai-out err'; out.textContent = String(e.message || e) }

    $('ai-ask').addEventListener('click', async () => {
      const p = $('ai-prompt').value.trim()
      if (!p) return
      setBusy(true)
      try { const r = await aiCall([{ role: 'user', content: p }]); show(ui.esc(r.text), r.text) } catch (e) { showErr(e) }
    })
    $('ai-summarize').addEventListener('click', async () => {
      setBusy(true)
      const msgs = Store.messagesOf(Store.activeJid).slice(-50)
      const transcript = msgs.filter((m) => m.kind === 'text').map((m) => (m.fromMe ? 'Me' : 'Them') + ': ' + m.text).join('\n')
      try {
        const r = await aiCall([{ role: 'user', content: 'Summarize this WhatsApp conversation concisely:\n\n' + transcript }])
        show(ui.esc(r.text), r.text)
      } catch (e) { showErr(e) }
    })
    $('ai-image').addEventListener('click', async () => {
      const p = $('ai-prompt').value.trim()
      if (!p) return
      setBusy(true)
      try {
        const url = await aiImage(p)
        show('<img src="' + url + '">', p)
      } catch (e) { showErr(e) }
    })
  })
}

// Completed core asynchronous fetch controller endpoints parsing pipelines 
async function aiCall(messages) {
  const ai = Store.settings.ai || {}
  const provider = ai.provider || 'openai'
  const key = ai.key
  const model = ai.model || (provider === 'openai' ? 'gpt-4o-mini' : provider === 'anthropic' ? 'claude-3-5-sonnet' : 'gemini-1.5-flash')
  
  if (!key) throw new Error('Set your API key in Settings → AI first')
  
  let endpoint = '', headers = {}, body = {}
  
  if (provider === 'openai') {
    endpoint = 'https://api.openai.com/v1/chat/completions'
    headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` }
    body = { model, messages }
  } else if (provider === 'anthropic') {
    endpoint = 'https://api.anthropic.com/v1/messages'
    headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' }
    body = { model, max_tokens: 1024, messages }
  } else if (provider === 'gemini') {
    endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`
    headers = { 'Content-Type': 'application/json' }
    body = { contents: messages.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })) }
  }

  const res = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`API Error: ${res.statusText}`)
  const data = await res.json()
  
  let outText = ''
  if (provider === 'openai') outText = data.choices[0].message.content
  else if (provider === 'anthropic') outText = data.content[0].text
  else if (provider === 'gemini') outText = data.candidates[0].content.parts[0].text
  
  return { text: outText }
}

async function aiImage(prompt) {
  const ai = Store.settings.ai || {}
  if (ai.provider !== 'openai' || !ai.key) {
    throw new Error('Image generation requires an OpenAI API key with the OpenAI provider selected')
  }
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${ai.key}`
    },
    body: JSON.stringify({ prompt, n: 1, size: '512x512' })
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Image API error (${res.status})${text ? ': ' + text.slice(0, 180) : ''}`)
  }
  const data = await res.json()
  return data.data?.[0]?.url || ''
}

window.onload = init
