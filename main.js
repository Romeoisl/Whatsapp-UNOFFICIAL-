const { app, BrowserWindow, ipcMain, dialog, Notification, Menu, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const WhatsAppCore = require('./backend/core')

app.setName('Liquid WhatsApp')

const DATA_DIR = path.join(app.getPath('userData'), 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const core = new WhatsAppCore(DATA_DIR)
let win = null
let backupTimer = null

function forward(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send('ev:' + channel, data)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 620,
    title: 'Liquid WhatsApp',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f241b',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      sandbox: false
    }
  })

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'))
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => { win = null })
}

function buildMenu() {
  const template = [
    { label: app.name, submenu: [
      { role: 'about' }, { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' }
    ]},
    { label: 'Edit', submenu: [
      { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
      { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }
    ]},
    { label: 'View', submenu: [
      { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
      { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
      { type: 'separator' }, { role: 'togglefullscreen' }
    ]},
    { label: 'Window', submenu: [
      { role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }
    ]}
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function safeHandler(fn) {
  return async (...args) => {
    try {
      return await fn(...args)
    } catch (e) {
      const message = e?.message || String(e)
      console.error('[IPC]', message)
      throw new Error(message)
    }
  }
}

async function chooseFile(title, filters) {
  const res = await dialog.showOpenDialog(win, {
    title,
    properties: ['openFile'],
    filters
  })
  return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
}

function registerIpc() {
  ipcMain.handle('app:init', () => ({
    hasSession: core.hasSession(),
    user: core.userInfo(),
    settings: core.getSettings(),
    schedules: core.getSchedules(),
    starred: core.getStarred()
  }))

  ipcMain.handle('core:pair', safeHandler((_e, number) => core.pairWithPhone(number)))
  ipcMain.handle('core:logout', safeHandler(() => core.logout()))
  ipcMain.handle('chat:set-active', (_e, jid) => core.setActiveJid(jid))

  ipcMain.handle('call:action', safeHandler(async (_e, action, callId, targetJid) => {
    if (action === 'reject' || action === 'hangup') {
      await core.rejectCall(callId, targetJid)
      return { ok: true }
    }
    throw new Error('Real WhatsApp voice/video media calls are not supported by the Baileys protocol layer used by this app. Incoming call signaling can be detected, but accepting/starting a real media call requires the official WhatsApp call stack.')
  }))

  ipcMain.handle('chat:send-text', safeHandler((_e, jid, text, quoted) => core.sendText(jid, text, quoted)))

  ipcMain.handle('chat:send-image', safeHandler(async (_e, jid, caption, quoted) => {
    const file = await chooseFile('Choose an image', [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic'] }
    ])
    if (!file) return { ok: false, reason: 'canceled' }
    await core.sendImage(jid, file, caption || '', quoted)
    return { ok: true }
  }))

  ipcMain.handle('chat:send-dropped-media', safeHandler((_e, jid, filePath, caption, quoted) => core.sendMedia(jid, filePath, caption || '', quoted)))

  ipcMain.handle('chat:send-media', safeHandler(async (_e, jid, caption, quoted) => {
    const file = await chooseFile('Choose a file', [
      { name: 'Media and documents', extensions: [
        'jpg','jpeg','png','gif','webp','heic','mp4','mov','m4v',
        'mp3','m4a','ogg','opus','pdf','doc','docx','xls','xlsx','ppt','pptx','txt','zip'
      ]},
      { name: 'All files', extensions: ['*'] }
    ])
    if (!file) return { ok: false, reason: 'canceled' }
    await core.sendMedia(jid, file, caption || '', quoted)
    return { ok: true }
  }))

  ipcMain.handle('chat:send-voice-note', safeHandler(async (_e, jid, dataUrl, durationMs, quoted) => {
    if (!jid || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:audio/')) throw new Error('Invalid voice note')
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/)
    if (!match) throw new Error('Invalid voice note data')
    const ext = match[1].includes('ogg') ? '.ogg' : '.webm'
    const dir = path.join(DATA_DIR, 'voice-notes')
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, `voice-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`)
    fs.writeFileSync(file, Buffer.from(match[2], 'base64'))
    try {
      await core.sendVoiceNote(jid, file, quoted)
      return { ok: true, durationMs: Number(durationMs) || 0 }
    } finally {
      try { fs.unlinkSync(file) } catch (_) {}
    }
  }))

  ipcMain.handle('chat:typing', (_e, jid, on) => core.sendTyping(jid, on))
  ipcMain.handle('chat:load', safeHandler((_e, jid) => core.loadMessages(jid, 80)))
  ipcMain.handle('chat:search', safeHandler((_e, q, jid) => core.searchMessages(q, jid)))
  ipcMain.handle('chat:meta', safeHandler((_e, jid, patch) => core.setChatMeta(jid, patch)))
  ipcMain.handle('chat:archive', safeHandler((_e, jid, value) => core.archiveChat(jid, value)))
  ipcMain.handle('chat:pin', safeHandler((_e, jid, value) => core.pinChat(jid, value)))
  ipcMain.handle('chat:mute', safeHandler((_e, jid, value) => core.muteChat(jid, value)))
  ipcMain.handle('group:action', safeHandler((_e, jid, action, participants) => core.groupAction(jid, action, participants)))
  ipcMain.handle('group:subject', safeHandler((_e, jid, subject) => core.groupUpdateSubject(jid, subject)))
  ipcMain.handle('group:leave', safeHandler((_e, jid) => core.groupLeave(jid)))
  ipcMain.handle('chat:read', safeHandler((_e, jid, ids) => core.readMessages(jid, ids)))
  ipcMain.handle('chat:edit', safeHandler((_e, jid, id, text) => core.editMessage(jid, id, text)))
  ipcMain.handle('chat:delete', safeHandler((_e, jid, id) => core.deleteMessage(jid, id)))
  ipcMain.handle('chat:react', safeHandler((_e, jid, msg, reaction) => core.reactMessage(jid, msg, reaction)))
  ipcMain.handle('chat:forward', safeHandler((_e, msg, targetJid) => core.forwardMessage(msg.jid, msg, targetJid)))
  ipcMain.handle('chat:poll', safeHandler((_e, jid, name, options) => core.sendPoll(jid, name, options)))
  ipcMain.handle('chat:viewonce', safeHandler((_e, jid, text) => core.sendViewOnce(jid, text)))
  ipcMain.handle('chat:broadcast', safeHandler((_e, jids, text) => core.sendBroadcast(jids, text)))
  ipcMain.handle('chat:mention-all', safeHandler((_e, jid, text) => core.sendMentionAll(jid, text)))
  ipcMain.handle('chat:disappear', safeHandler((_e, jid, sec) => core.setDisappearing(jid, sec)))
  ipcMain.handle('chat:sticker', safeHandler(async (_e, jid) => {
    const file = await chooseFile('Choose a WebP sticker', [
      { name: 'WebP stickers', extensions: ['webp'] }
    ])
    if (!file) return { ok: false, reason: 'canceled' }
    await core.sendSticker(jid, file)
    return { ok: true }
  }))

  ipcMain.handle('chat:star', safeHandler((_e, m) => core.toggleStarred(m)))
  ipcMain.handle('chat:starred', () => core.getStarred())
  ipcMain.handle('media:download', safeHandler((_e, dto) => core.downloadMedia(dto)))
  ipcMain.handle('contacts:list', () => core.contactList())
  ipcMain.handle('group:participants', safeHandler((_e, jid) => core.groupParticipants(jid)))

  ipcMain.handle('status:post', safeHandler((_e, text) => core.postStatus(text)))
  ipcMain.handle('status:post-image', safeHandler(async (_e, caption) => {
    const file = await chooseFile('Choose a status image', [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] }
    ])
    if (!file) return { ok: false, reason: 'canceled' }
    await core.postStatusImage(file, caption || '')
    return { ok: true }
  }))

  ipcMain.handle('privacy:set', safeHandler((_e, key, value) => core.setPrivacy(key, value)))
  ipcMain.handle('settings:get', () => core.getSettings())
  ipcMain.handle('settings:set', safeHandler((_e, patch) => core.setSettings(patch)))
  ipcMain.handle('local:info', () => core.localDatabaseInfo())
  ipcMain.handle('local:export', safeHandler(async () => {
    const res = await dialog.showSaveDialog(win, {
      title: 'Export Liquid WhatsApp data',
      defaultPath: path.join(app.getPath('documents'), `Liquid-WhatsApp-backup-${new Date().toISOString().slice(0,10)}.json`),
      filters: [{ name: 'JSON backup', extensions: ['json'] }]
    })
    if (res.canceled || !res.filePath) return { ok: false, reason: 'canceled' }
    fs.writeFileSync(res.filePath, JSON.stringify(core.exportLocalData(), null, 2), 'utf8')
    return { ok: true, path: res.filePath }
  }))
  ipcMain.handle('autoreply:add', safeHandler((_e, rule) => core.addAutoReply(rule)))
  ipcMain.handle('autoreply:remove', safeHandler((_e, id) => core.removeAutoReply(id)))
  ipcMain.handle('schedule:list', () => core.getSchedules())
  ipcMain.handle('schedule:add', safeHandler((_e, s) => core.addSchedule(s)))
  ipcMain.handle('schedule:remove', safeHandler((_e, id) => core.removeSchedule(id)))

  ipcMain.handle('external:open', safeHandler((_e, url) => {
    if (!/^https?:\/\//i.test(String(url))) throw new Error('Only http(s) links can be opened')
    return shell.openExternal(String(url))
  }))
}

core.on('connection', (u) => forward('connection', u))
core.on('chats', (c) => {
  forward('chats', c)
  if (app.dock) {
    const n = c.reduce((a, x) => a + (x.unread || 0), 0)
    app.dock.setBadge(n ? (n > 99 ? '99+' : String(n)) : '')
  }
})
core.on('messages', (p) => forward('messages', p))
core.on('presence', (p) => forward('presence', p))
core.on('settings', (s) => forward('settings', s))
core.on('schedules', (s) => forward('schedules', s))
core.on('call:incoming', (callData) => forward('call:ring', callData))

core.on('notify', (items) => {
  if (core.getSettings().notifications === false || !Notification.isSupported()) return
  for (const it of items) {
    const n = new Notification({
      title: it.name || 'Message',
      body: core.getSettings().showPreviews === false ? 'New message' : (it.text || 'New message'),
      silent: !core.getSettings().soundNotifications,
      soundName: 'default'
    })
    n.on('click', () => {
      if (!win || win.isDestroyed()) return
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('ev:open-chat', it.jid)
    })
    n.show()
  }
})

app.whenReady().then(() => {
  buildMenu()
  registerIpc()
  createWindow()
  core.start().catch((e) => console.error('[core] start failed:', e.message))
  backupTimer = setInterval(() => {
    const settings = core.getSettings()
    if (settings.backupEnabled === false) return
    try {
      const dir = path.join(DATA_DIR, 'backups')
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, 'latest.json')
      const intervalMs = Math.max(1, Number(settings.backupIntervalHours) || 24) * 60 * 60 * 1000
      const stale = !fs.existsSync(file) || (Date.now() - fs.statSync(file).mtimeMs > intervalMs)
      if (stale) fs.writeFileSync(file, JSON.stringify(core.exportLocalData(), null, 2), 'utf8')
    } catch (e) { console.warn('[backup]', e.message) }
  }, 60 * 60 * 1000)
  setTimeout(() => {
    try {
      const dir = path.join(DATA_DIR, 'backups')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(core.exportLocalData(), null, 2), 'utf8')
    } catch (_) {}
  }, 5000)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.on('before-quit', () => {
  if (backupTimer) clearInterval(backupTimer)
  try { core.dispose() } catch (_) {}
})
